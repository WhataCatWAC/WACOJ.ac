import http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { Context as CordisContext, Service } from '@cordisjs/core';
import type { Files } from 'formidable';
import fs from 'fs-extra';
import Koa from 'koa';
import Body from 'koa-body';
import Compress from 'koa-compress';
import { Shorty } from 'shorty.js';
import { WebSocket, WebSocketServer } from 'ws';
import {
    Counter, errorMessage, isClass, Logger, parseMemoryMB,
} from '@hydrooj/utils/lib/utils';
import base from './base';
import * as decorators from './decorators';
import {
    CsrfTokenError, HydroError, InvalidOperationError,
    MethodNotAllowedError, NotFoundError, UserFacingError,
} from './error';
import { Router } from './router';
import serializer from './serializer';

export { WebSocket, WebSocketServer } from 'ws';

export const kHandler = Symbol.for('hydro.handler');

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
export function encodeRFC5987ValueChars(str: string) {
    return (
        encodeURIComponent(str)
            // Note that although RFC3986 reserves "!", RFC5987 does not,
            // so we do not need to escape it
            .replace(/['()]/g, escape) // i.e., %27 %28 %29
            .replace(/\*/g, '%2A')
            // The following are not required for percent-encoding per RFC5987,
            // so we can allow for a little better readability over the wire: |`^
            .replace(/%(?:7C|60|5E)/g, unescape)
    );
}

export interface HydroRequest {
    method: string;
    host: string;
    hostname: string;
    ip: string;
    headers: Koa.Request['headers'];
    cookies: any;
    body: any;
    files: Record<string, import('formidable').File>;
    query: any;
    querystring: string;
    path: string;
    originalPath: string;
    params: any;
    referer: string;
    json: boolean;
    websocket: boolean;
}
export interface HydroResponse {
    body: any;
    type: string;
    status: number;
    template?: string;
    /** If set, and pjax content was request from client,
     *  The template will be used for rendering.
     */
    pjax?: string;
    redirect?: string;
    disposition?: string;
    etag?: string;
    attachment: (name: string, stream?: any) => void;
    addHeader: (name: string, value: string) => void;
}
type HydroContext = {
    request: HydroRequest;
    response: HydroResponse;
    args: Record<string, any>;
    UiContext: Record<string, any>;
    domain: { _id: string };
    user: { _id: number };
};
export type KoaContext = Koa.Context & {
    HydroContext: HydroContext;
    handler: any;
    request: Koa.Request & { body: any, files: Files };
    session: Record<string, any>;
    holdFiles: (string | File)[];
};

export type TextRenderer = {
    output: 'html' | 'json' | 'text';
    render: (name: string, args: Record<string, any>, context: Record<string, any>) => string | Promise<string>;
};
export type BinaryRenderer = {
    output: 'binary';
    render: (name: string, args: Record<string, any>, context: Record<string, any>) => Buffer | Promise<Buffer>;
};
export type Renderer = (BinaryRenderer | TextRenderer) & {
    name: string;
    accept: readonly string[];
    priority: number;
    asFallback: boolean;
};

const logger = new Logger('server');
/** @deprecated */
export const koa = new Koa<Koa.DefaultState, KoaContext>({
    keys: [Math.random().toString(16).substring(2)],
});
export const router = new Router();
export const httpServer = http.createServer(koa.callback());
export const wsServer = new WebSocketServer({ server: httpServer });
koa.on('error', (error) => {
    if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET' && !error.message.includes('Parse Error')) {
        logger.error('Koa app-level error', { error });
    }
});
wsServer.on('error', (error) => {
    console.log('Websocket server error:', error);
});

export interface UserModel {
    _id: number;
}

export interface HandlerCommon<C> { } // eslint-disable-line @typescript-eslint/no-unused-vars
export class HandlerCommon<C> {
    static [kHandler]: string | boolean = true;
    session: Record<string, any>;
    args: Record<string, any>;
    request: HydroRequest;
    response: HydroResponse;
    UiContext: Record<string, any>;
    user: UserModel;

    constructor(public context: KoaContext, public ctx: C) {
        this.renderHTML = this.renderHTML.bind(this);
        this.url = this.url.bind(this);
        this.session = context.session;
        this.args = context.HydroContext.args;
        this.request = context.HydroContext.request;
        this.response = context.HydroContext.response;
        this.UiContext = context.HydroContext.UiContext;
        this.ctx = (ctx as any).extend({});
    }

    checkPerm(..._: bigint[]) {
        throw new Error('checkPerm was not implemented');
    }

    checkPriv(..._: number[]) {
        throw new Error('checkPriv was not implemented');
    }

    url(name: string, ...kwargsList: Record<string, any>[]) {
        if (name === '#') return '#';
        let res = '#';
        const args: any = Object.create(null);
        const query: any = Object.create(null);
        for (const kwargs of kwargsList) {
            for (const key in kwargs) {
                args[key] = kwargs[key].toString().replace(/\//g, '%2F');
            }
            for (const key in kwargs.query || {}) {
                query[key] = kwargs.query[key].toString();
            }
        }
        try {
            const { anchor } = args;
            res = router.url(name, args, { query }).toString();
            if (anchor) res = `${res}#${anchor}`;
        } catch (e) {
            logger.warn(e.message);
            logger.info('%s %o', name, args);
            if (!e.message.includes('Expected') || !e.message.includes('to match')) logger.info('%s', e.stack);
        }
        return res;
    }

    translate(str: string) {
        return str;
    }

    renderHTML(templateName: string, args: Record<string, any>) {
        const renderers = Object.values((this.ctx as any).server.renderers as Record<string, Renderer>)
            .filter((r) => r.accept.includes(templateName) || r.asFallback);
        const topPrio = renderers.sort((a, b) => b.priority - a.priority)[0];
        const engine = topPrio?.render || (() => JSON.stringify(args, serializer(false, this)));
        return engine(templateName, args, {
            handler: this,
            UserContext: this.user,
            url: this.url,
            _: this.translate,
        });
    }
}

export class Handler<C = CordisContext> extends HandlerCommon<C> {
    loginMethods: any;
    noCheckPermView = false;
    notUsage = false;
    allowCors = false;
    __param: Record<string, decorators.ParamOption<any>[]>;

    back(body?: any) {
        this.response.body = body || this.response.body || {};
        this.response.redirect = this.request.headers.referer || '/';
    }

    binary(data: any, name?: string) {
        this.response.body = data;
        this.response.template = null;
        this.response.type = 'application/octet-stream';
        if (name) this.response.disposition = `attachment; filename="${encodeRFC5987ValueChars(name)}"`;
    }

    holdFile(name: string | File) {
        this.context.holdFiles.push(name);
    }

    async init() {
        if (this.request.method === 'post' && this.request.headers.referer && !this.context.cors && !this.allowCors) {
            try {
                const host = new URL(this.request.headers.referer).host;
                if (host !== this.request.host) throw new CsrfTokenError(host);
            } catch (e) {
                throw e instanceof CsrfTokenError ? e : new CsrfTokenError();
            }
        }
    }

    async onerror(error: HydroError) {
        error.msg ||= () => error.message;
        if (error instanceof UserFacingError && !process.env.DEV) error.stack = '';
        this.response.status = error instanceof UserFacingError ? error.code : 500;
        this.response.template = error instanceof UserFacingError ? 'error.html' : 'bsod.html';
        this.response.body = {
            UserFacingError,
            error: { message: error.msg(), params: error.params, stack: errorMessage(error.stack || '') },
        };
    }
}

export class ConnectionHandler<C> extends HandlerCommon<C> {
    conn: WebSocket;
    compression: Shorty;
    counter = 0;

    resetCompression() {
        this.counter = 0;
        this.compression = new Shorty();
        this.conn.send('shorty');
    }

    send(data: any) {
        let payload = JSON.stringify(data, serializer(false, this));
        if (this.compression) {
            if (this.counter > 1000) this.resetCompression();
            payload = this.compression.deflate(payload);
            this.counter++;
        }
        this.conn.send(payload);
    }

    close(code: number, reason: string) {
        this.conn.close(code, reason);
    }

    onerror(err: HydroError) {
        if (err instanceof UserFacingError) err.stack = this.request.path;
        this.send({
            error: {
                name: err.name,
                params: err.params || [],
            },
        });
        this.close(4000, err.toString());
    }
}

export class NotFoundHandler extends Handler<CordisContext> {
    prepare() { throw new NotFoundError(this.request.path); }
    all() { }
}

function executeMiddlewareStack(context: any, middlewares: { name: string, func: Function }[]) {
    let index = -1;
    context.__timers ||= {};
    function dispatch(i) {
        if (i <= index) return Promise.reject(new Error('next() called multiple times'));
        index = i;
        if (!middlewares[i]) return Promise.resolve();
        const name = middlewares[i].name;
        const fn = middlewares[i].func;
        context.__timers[`${name}.start`] = Date.now();
        try {
            return Promise.resolve(fn(context, dispatch.bind(null, i + 1))).finally(() => {
                context.__timers[`${name}.end`] = Date.now();
            });
        } catch (e) {
            return Promise.reject(e);
        } finally {
            context.__timers[`${name}.end`] = Date.now();
        }
    }
    return dispatch(0);
}

export interface WebServiceConfig {
    keys: string[];
    proxy: boolean;
    cors?: string;
    upload?: string;
    port: number;
    host?: string;
    xff?: string;
    xhost?: string;
}

export class WebService<C extends CordisContext = CordisContext> extends Service<C> {
    private registry: Record<string, any> = Object.create(null);
    private registrationCount = Counter();
    private serverLayers = [];
    private handlerLayers = [];
    private wsLayers = [];
    private captureAllRoutes = Object.create(null);

    renderers: Record<string, Renderer> = Object.create(null);
    server = koa;
    router = router;
    HandlerCommon = HandlerCommon;
    Handler = Handler;
    ConnectionHandler = ConnectionHandler;

    constructor(ctx: C, public config: WebServiceConfig) {
        super(ctx, 'server');
        ctx.mixin('server', ['Route', 'Connection', 'withHandlerClass']);
        this.server.keys = this.config.keys;
        this.server.proxy = this.config.proxy;
        const corsAllowHeaders = 'x-requested-with, accept, origin, content-type, upgrade-insecure-requests';
        this.server.use(Compress());
        this.server.use(async (c, next) => {
            if (c.request.headers.origin && this.config.cors) {
                try {
                    const host = new URL(c.request.headers.origin).host;
                    if (host !== c.request.headers.host && `,${this.config.cors},`.includes(`,${host},`)) {
                        c.set('Access-Control-Allow-Credentials', 'true');
                        c.set('Access-Control-Allow-Origin', c.request.headers.origin);
                        c.set('Access-Control-Allow-Headers', corsAllowHeaders);
                        c.set('Vary', 'Origin');
                        c.cors = true;
                    }
                } catch (e) {
                    // invalid origin header, ignore
                }
            }
            if (c.request.method.toLowerCase() === 'options') {
                c.body = 'ok';
                return null;
            }
            for (const key in this.captureAllRoutes) {
                if (c.path.startsWith(key)) return this.captureAllRoutes[key](c, next);
            }
            return await next();
        });
        if (process.env.DEV) {
            this.server.use(async (c: Koa.Context, next: Function) => {
                const startTime = Date.now();
                try {
                    await next();
                } finally {
                    const endTime = Date.now();
                    if (!c.nolog && !c.response.headers.nolog) {
                        logger.debug(`${c.request.method} /${c.domainId || 'system'}${c.request.path} \
${c.response.status} ${endTime - startTime}ms ${c.response.length}`);
                    }
                }
            });
        }
        if (this.config.upload) {
            const uploadDir = join(tmpdir(), 'hydro', 'upload', process.env.NODE_APP_INSTANCE || '0');
            fs.ensureDirSync(uploadDir);
            logger.debug('Using upload dir: %s', uploadDir);
            this.server.use(Body({
                multipart: true,
                jsonLimit: '8mb',
                formLimit: '8mb',
                formidable: {
                    uploadDir,
                    maxFileSize: parseMemoryMB(this.config.upload) * 1024 * 1024,
                    keepExtensions: true,
                },
            }));
            this.server.use(async (c, next) => {
                c.holdFiles = [];
                try {
                    await next();
                } finally {
                    if (Object.keys(c.request.files || {}).length) {
                        for (const k in c.request.files) {
                            if (c.holdFiles.includes(k)) continue;
                            const files = Array.isArray(c.request.files[k]) ? c.request.files[k] : [c.request.files[k]];
                            for (const f of files) if (!c.holdFiles.includes(f as any)) fs.rmSync(f.filepath);
                        }
                    }
                }
            });
            this.ctx.on('dispose', () => {
                fs.emptyDirSync(uploadDir);
            });
            // if killed by ctrl-c, on('dispose') will not be called
            process.on('exit', () => {
                fs.emptyDirSync(uploadDir);
            });
        } else {
            this.server.use(Body({
                multipart: true,
                jsonLimit: '8mb',
                formLimit: '8mb',
            }));
        }
        this.router.use((c, next) => executeMiddlewareStack(c, [
            ...this.handlerLayers,
            { name: 'logic', func: next },
        ]).catch(console.error));
        this.server.use((c) => executeMiddlewareStack(c, [
            ...this.serverLayers,
            { name: 'routes', func: router.routes() },
            { name: 'methods', func: router.allowedMethods() },
            ...this.handlerLayers,
            {
                name: '404',
                func: (t) => this.handleHttp(t, NotFoundHandler, () => true),
            },
        ]));
        this.addLayer('base', base(logger, this.config.xff, this.config.xhost));
        wsServer.on('connection', async (socket, request) => {
            socket.on('error', (err) => {
                logger.warn('Websocket Error: %s', err.message);
                try {
                    socket.close(1003, 'Websocket Error');
                } catch (e) { }
            });
            socket.pause();
            const c: any = koa.createContext(request, {} as any);
            await executeMiddlewareStack(c, this.wsLayers);
            for (const manager of router.wsStack) {
                if (manager.accept(socket, request, c)) return;
            }
            socket.close();
        });
    }

    async listen() {
        this.ctx.on('dispose', () => {
            httpServer.close();
            wsServer.close();
        });
        await new Promise((r) => {
            httpServer.listen(this.config.port, this.config.host || '127.0.0.1', () => {
                logger.success('Server listening at: %d', this.config.port);
                r(true);
            });
        });
    }

    private async handleHttp(ctx: KoaContext, HandlerClass, checker) {
        const { args } = ctx.HydroContext;
        Object.assign(args, ctx.params);
        const h = new HandlerClass(ctx, this.ctx);
        ctx.handler = h;
        const method = ctx.method.toLowerCase();
        const name = (typeof HandlerClass[kHandler] === 'string' ? HandlerClass[kHandler] : HandlerClass.name).replace(/Handler$/, '');
        try {
            const operation = (method === 'post' && ctx.request.body?.operation)
                ? `_${ctx.request.body.operation}`.replace(/_([a-z])/gm, (s) => s[1].toUpperCase())
                : '';

            // FIXME: should pass type check
            await (this.ctx.parallel as any)('handler/create', h, 'http');
            await (this.ctx.parallel as any)('handler/create/http', h);

            if (checker) checker.call(h);
            if (method === 'post') {
                if (operation) {
                    if (typeof h[`post${operation}`] !== 'function') {
                        throw new InvalidOperationError(operation);
                    }
                } else if (typeof h.post !== 'function') {
                    throw new MethodNotAllowedError(method);
                }
            } else if (typeof h[method] !== 'function' && typeof h.all !== 'function') {
                throw new MethodNotAllowedError(method);
            }

            const steps = [
                'log/__init', 'init', 'handler/init',
                `handler/before-prepare/${name}#${method}`, `handler/before-prepare/${name}`, 'handler/before-prepare',
                'log/__prepare', '__prepare', '_prepare', 'prepare', 'log/__prepareDone',
                `handler/before/${name}#${method}`, `handler/before/${name}`, 'handler/before',
                'log/__method', 'all', method, 'log/__methodDone',
                ...operation ? [
                    `handler/before-operation/${name}`, 'handler/before-operation',
                    `post${operation}`, 'log/__operationDone',
                ] : [], 'after',
                `handler/after/${name}#${method}`, `handler/after/${name}`, 'handler/after',
                'cleanup',
                `handler/finish/${name}#${method}`, `handler/finish/${name}`, 'handler/finish',
                'log/__finish',
            ];

            let current = 0;
            while (current < steps.length) {
                const step = steps[current];
                let control;
                if (step.startsWith('log/')) h.args[step.slice(4)] = Date.now();
                // @ts-ignore
                else if (step.startsWith('handler/')) control = await this.ctx.serial(step, h); // eslint-disable-line no-await-in-loop
                // eslint-disable-next-line no-await-in-loop
                else if (typeof h[step] === 'function') control = await h[step](args);
                if (control) {
                    const index = steps.findIndex((i) => control === i);
                    if (index === -1) throw new Error(`Invalid control: ${control}`);
                    if (index <= current) {
                        logger.warn('Returning to previous step is not recommended:', step, '->', control);
                    }
                    current = index;
                } else current++;
            }
        } catch (e) {
            try {
                // FIXME: should pass type check
                await (this.ctx.serial as any)(`handler/error/${name}`, h, e);
                await (this.ctx.serial as any)('handler/error', h, e);
                await h.onerror(e);
            } catch (err) {
                logger.error(err);
                h.response.status = 500;
                h.response.type = 'text/plain';
                h.response.body = `${err.message}\n${err.stack}`;
            }
        }
    }

    private async handleWS(ctx: KoaContext, HandlerClass, checker, conn, layer?) {
        const { args } = ctx.HydroContext;
        const h = new HandlerClass(ctx, this.ctx);
        // FIXME: should pass type check
        await (this.ctx.parallel as any)('connection/create', h);
        const stream = new PassThrough();
        if (!conn) {
            // By HTTP
            ctx.request.socket.setTimeout(0);
            ctx.req.socket.setNoDelay(true);
            ctx.req.socket.setKeepAlive(true);
            ctx.set({
                'X-Accel-Buffering': 'no',
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            ctx.HydroContext.request.websocket = true;
            ctx.compress = false;
            conn = {
                close() {
                    stream.end();
                },
                send(data: any) {
                    stream.write(`${args.sse ? 'data: ' : ''}${data}\n${args.sse ? '\n' : ''}`);
                },
            };
        }
        ctx.handler = h;
        h.conn = conn;
        const disposables = [];
        try {
            // FIXME: should pass type check
            await (this.ctx.parallel as any)('handler/create', h, 'ws');
            await (this.ctx.parallel as any)('handler/create/ws', h);
            checker.call(h);
            if (args.shorty) h.resetCompression();
            if (h._prepare) await h._prepare(args);
            if (h.prepare) await h.prepare(args);
            // eslint-disable-next-line @typescript-eslint/no-shadow
            for (const { name, target } of h.__subscribe || []) disposables.push(this.ctx.on(name, target.bind(h)));
            let closed = false;
            let interval: NodeJS.Timeout;
            const clean = () => {
                if (closed) return;
                closed = true;
                // FIXME: should pass type check
                (this.ctx.emit as any)('connection/close', h);
                if (layer) layer.clients.delete(conn);
                if (interval) clearInterval(interval);
                for (const d of disposables) d();
                h.cleanup?.(args);
            };
            if (layer) {
                let lastHeartbeat = Date.now();
                interval = setInterval(() => {
                    if (Date.now() - lastHeartbeat > 80000) {
                        clean();
                        conn.terminate();
                    }
                    if (Date.now() - lastHeartbeat > 30000) conn.send('ping');
                }, 40000);
                conn.on('pong', () => {
                    lastHeartbeat = Date.now();
                });
                conn.onmessage = (e) => {
                    lastHeartbeat = Date.now();
                    if (e.data === 'pong') return;
                    if (e.data === 'ping') {
                        conn.send('pong');
                        return;
                    }
                    let payload;
                    try {
                        payload = JSON.parse(e.data.toString());
                    } catch {
                        conn.close();
                    }
                    try {
                        h.message?.(payload);
                    } catch (err) {
                        logger.error(e);
                    }
                };
            } else ctx.body = stream;
            // FIXME: should pass type check
            await (this.ctx.parallel as any)('connection/active', h as any);
            if (layer) {
                if (conn.readyState === conn.OPEN) {
                    conn.on('close', clean);
                    conn.resume();
                } else clean();
            } else stream.on('close', clean);
        } catch (e) {
            await h.onerror(e);
            if (!layer) ctx.status = 500;
        }
    }

    private register(type: 'route' | 'conn', routeName: string, path: string, HandlerClass: any, ...permPrivChecker) {
        if (!HandlerClass?.[kHandler] || !isClass(HandlerClass)) throw new Error('Invalid registration.');
        const name = typeof HandlerClass[kHandler] === 'string' ? HandlerClass[kHandler] : HandlerClass.name;
        if (this.registrationCount[name] && this.registry[name] !== HandlerClass) {
            logger.warn('Route with name %s already exists.', name);
        }
        this.registry[name] = HandlerClass;
        this.registrationCount[name]++;

        const Checker = (args) => {
            let perm: bigint;
            let priv: number;
            let checker = () => { };
            for (const item of args) {
                if (typeof item === 'object') {
                    if (typeof item.call !== 'undefined') {
                        checker = item;
                    } else if (typeof item[0] === 'number') {
                        priv = item;
                    } else if (typeof item[0] === 'bigint') {
                        perm = item;
                    }
                } else if (typeof item === 'number') {
                    priv = item;
                } else if (typeof item === 'bigint') {
                    perm = item;
                }
            }
            return function check(this: Handler<C>) {
                checker();
                if (perm) this.checkPerm(perm);
                if (priv) this.checkPriv(priv);
            };
        };

        if (type === 'route') {
            router.all(routeName, path, (ctx) => this.handleHttp(ctx as any, HandlerClass, Checker(permPrivChecker)));
        } else {
            const checker = Checker(permPrivChecker);
            const layer = router.ws(path, async (conn, _req, ctx) => {
                await this.handleWS(ctx as any, HandlerClass, checker, conn, layer);
            });
            router.get(path, (ctx) => this.handleWS(ctx as any, HandlerClass, checker, null, null));
        }
        const dispose = router.disposeLastOp;
        // @ts-ignore
        this.ctx.parallel(`handler/register/${name}`, HandlerClass);
        this.ctx.on('dispose', () => {
            this.registrationCount[name]--;
            if (!this.registrationCount[name]) delete this.registry[name];
            dispose();
        });
    }

    public withHandlerClass<T extends string>(
        name: T, callback: (HandlerClass: T extends `${string}ConnectionHandler` ? typeof ConnectionHandler<C> : typeof Handler<C>) => any,
    ) {
        if (this.registry[name]) callback(this.registry[name]);
        // FIXME: should pass type check
        this.ctx.on(`handler/register/${name}`, callback as any);
    }

    // FIXME: should be typeof Handler<Context> instead of any
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public Route(name: string, path: string, RouteHandler: any, ...permPrivChecker) {
        return this.register('route', name, path, RouteHandler, ...permPrivChecker);
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    public Connection(name: string, path: string, RouteHandler: any, ...permPrivChecker) {
        return this.register('conn', name, path, RouteHandler, ...permPrivChecker);
    }

    private registerLayer(name: 'serverLayers' | 'handlerLayers' | 'wsLayers', layer: any) {
        this.ctx.effect(() => {
            this[name].push(layer);
            return () => {
                this[name] = this[name].filter((i) => i !== layer);
            };
        });
    }

    public addServerLayer(name: string, func: any) {
        return this.registerLayer('serverLayers', { name, func });
    }

    public addHandlerLayer(name: string, func: any) {
        return this.registerLayer('handlerLayers', { name, func });
    }

    public addWSLayer(name: string, func: any) {
        return this.registerLayer('wsLayers', { name, func });
    }

    public addLayer(name: string, layer: any) {
        this.addHandlerLayer(name, layer);
        this.addWSLayer(name, layer);
    }

    public addCaptureRoute(prefix: string, cb: any) {
        this.captureAllRoutes[prefix] = cb;
    }

    public handlerMixin(MixinClass: Partial<HandlerCommon<C>>) {
        this.ctx.effect(() => {
            for (const val of Object.getOwnPropertyNames(MixinClass)) {
                if (HandlerCommon.prototype[val]) {
                    logger.warn('HandlerCommon.prototype[%s] already exists.', val);
                }
                HandlerCommon.prototype[val] = MixinClass[val];
            }
            return () => {
                for (const val of Object.getOwnPropertyNames(MixinClass)) {
                    delete HandlerCommon.prototype[val];
                }
            };
        });
    }

    public httpHandlerMixin(MixinClass: Partial<Handler<C>>) {
        this.ctx.effect(() => {
            for (const val of Object.getOwnPropertyNames(MixinClass)) {
                if (Handler.prototype[val]) {
                    logger.warn('Handler.prototype[%s] already exists.', val);
                }
                Handler.prototype[val] = MixinClass[val];
            }
            return () => {
                for (const val of Object.getOwnPropertyNames(MixinClass)) {
                    delete Handler.prototype[val];
                }
            };
        });
    }

    public wsHandlerMixin(MixinClass: Partial<ConnectionHandler<C>>) {
        this.ctx.effect(() => {
            for (const val of Object.getOwnPropertyNames(MixinClass)) {
                if (ConnectionHandler.prototype[val]) {
                    logger.warn('ConnectionHandler.prototype[%s] already exists.', val);
                }
            }
            return () => {
                for (const val of Object.getOwnPropertyNames(MixinClass)) {
                    delete ConnectionHandler.prototype[val];
                }
            };
        });
    }

    public registerRenderer(name: string, func: Renderer) {
        if (this.renderers[name]) logger.warn('Renderer %s already exists.', name);
        this.ctx.effect(() => {
            this.renderers[name] = func;
            return () => {
                delete this.renderers[name];
            };
        });
    }
}

declare module '@cordisjs/core' {
    interface Context {
        server: WebService<this>;
        Route: WebService<this>['Route'];
        Connection: WebService<this>['Connection'];
        withHandlerClass: WebService<this>['withHandlerClass'];
    }
}
