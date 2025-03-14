/* eslint-disable import/no-dynamic-require */
/* eslint-disable consistent-return */
/* eslint-disable simple-import-sort/imports */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-eval */
import './init';
import './interface';
import path from 'path';
import child from 'child_process';
// eslint-disable-next-line import/no-duplicates
import './utils';
import cac from 'cac';
import './ui';
import * as I18n from './lib/i18n';

import { Logger } from './logger';
import { Context, Service, ScopeStatus } from './context';
// eslint-disable-next-line import/no-duplicates
import { sleep, unwrapExports } from './utils';
import { PRIV } from './model/builtin';
import { getAddons } from './options';

const argv = cac().parse();
const logger = new Logger('loader');
logger.debug('%o', argv);

process.on('unhandledRejection', logger.error);
process.on('uncaughtException', logger.error);

const HYDROPATH = [];

if (process.env.NIX_PROFILES) {
    try {
        const result = JSON.parse(child.execSync('nix profile list --json').toString()) as any;
        for (const [name, derivation] of Object.entries(result.elements) as any) {
            if (!derivation.active) continue;
            if (name.startsWith('hydro-plugin-') && derivation.storePaths) {
                HYDROPATH.push(...derivation.storePaths);
            }
        }
    } catch (e) {
        logger.error('Nix detected, but failed to list installed derivations.');
    }
}

export function resolveConfig(plugin: any, config: any) {
    if (config === false) return;
    if (config === true) config = undefined;
    config ??= {};
    const schema = plugin['Config'] || plugin['schema'];
    if (schema && plugin['schema'] !== false) config = schema(config);
    return config;
}

export class Loader extends Service {
    public state: Record<string, any> = Object.create(null);
    public config: {};
    public suspend = false;
    public cache: Record<string, string> = Object.create(null);
    // public warnings: Record<string, string> = Object.create(null);

    constructor(ctx: Context) {
        super(ctx, 'loader');
    }

    [Service.setup]() {
        this.ctx.on('app/started', () => {
            this.ctx.setInterval(async () => {
                const pending = Object.entries(this.state).filter((v) => v[1].status === ScopeStatus.PENDING);
                if (pending.length) {
                    logger.warn('Plugins are still pending: %s', pending.map((v) => v[0]).join(', '));
                    for (const [key, value] of pending) {
                        logger.warn('Plugin %s is still pending', key);
                        console.log(value);
                    }
                }
                const loading = Object.entries(this.state).filter((v) => v[1].status === ScopeStatus.LOADING);
                if (loading.length) {
                    logger.warn('Plugins are still loading: %s', loading.map((v) => v[0]).join(', '));
                    for (const [key, value] of loading) {
                        logger.warn('Plugin %s is still loading', key);
                        console.log(value);
                    }
                }
                const failed = Object.entries(this.state).filter((v) => v[1].status === ScopeStatus.FAILED);
                if (failed.length) {
                    logger.warn('Plugins failed to load: %s', failed.map((v) => v[0]).join(', '));
                    for (const [key, value] of failed) {
                        logger.warn('Plugin %s failed to load', key);
                        console.log(value);
                    }
                }
            }, 10000);
        });
    }

    unloadPlugin(key: string) {
        const fork = this.state[key];
        if (fork) {
            fork.dispose();
            delete this.state[key];
            logger.info('unload plugin %c', key);
        }
    }

    async reloadPlugin(key: string, config: any, asName = '') {
        let fork = this.state[key];
        if (fork) {
            logger.info('reload plugin %c', key.split('node_modules').pop());
            fork.update(config);
        } else {
            logger.info('apply plugin %c', key.split('node_modules').pop());
            const plugin = await this.resolvePlugin(key);
            if (!plugin) return;
            resolveConfig(plugin, config);
            if (asName) plugin.name = asName;
            // fork = parent.plugin(plugin, this.interpolate(config));
            fork = this.ctx.plugin(plugin, config);
            if (!fork) return;
            this.state[key] = fork;
        }
        return fork;
    }

    async resolvePlugin(name: string) {
        try {
            this.cache[name] ||= require.resolve(name);
        } catch (err) {
            try {
                this.cache[name] ||= require.resolve(name, { paths: HYDROPATH });
            } catch (e) {
                logger.error(err.message);
                return;
            }
        }
        return unwrapExports(require(this.cache[name]));
    }
}

app.plugin(I18n);

async function preload() {
    global.app = await new Promise((resolve) => {
        app.inject(['timer', 'i18n', 'logger'], (c) => {
            c.plugin(Loader);
            c.inject(['loader'], (ctx) => {
                resolve(ctx);
            });
        });
    });
    for (const a of [path.resolve(__dirname, '..'), ...getAddons()]) {
        try {
            // Is a npm package
            const packagejson = require.resolve(`${a}/package.json`);
            // eslint-disable-next-line import/no-dynamic-require
            const payload = require(packagejson);
            const name = payload.name.startsWith('@hydrooj/') ? payload.name.split('@hydrooj/')[1] : payload.name;
            global.Hydro.version[name] = payload.version;
            const modulePath = path.dirname(packagejson);
            global.addons.push(modulePath);
        } catch (e) {
            logger.error(`Addon not found: ${a}`);
            logger.error(e);
            app.injectUI('Notification', 'Addon not found: {0}', { args: [a], type: 'warn' }, PRIV.PRIV_VIEW_SYSTEM_NOTIFICATION);
        }
    }
}

export async function load() {
    await preload();
    Error.stackTraceLimit = 50;
    try {
        const { simpleGit } = require('simple-git') as typeof import('simple-git');
        const { all } = await simpleGit().log();
        if (all.length > 0) Hydro.version.hydrooj += `-${all[0].hash.substring(0, 7)}`;
        const { isClean } = await simpleGit().status();
        if (!isClean()) Hydro.version.hydrooj += '-dirty';
        if (process.env.DEV) {
            const q = await simpleGit().listRemote(['--get-url']);
            if (!q.includes('hydro-dev/Hydro')) {
                console.warn('\x1b[93m');
                console.warn('DISCLAIMER:');
                console.warn(' You are under development mode.');
                console.warn(' The Hydro project is licensed under AGPL3,');
                console.warn(' which means you have to open source all your modifications');
                console.warn(' and keep all copyright notice');
                console.warn(' unless you have got another license from the original author.');
                console.warn('');
                console.warn('声明：');
                console.warn(' 你正在运行开发者模式。');
                console.warn(' Hydro 项目基于 AGPL3 协议开源，');
                console.warn(' 这意味着除非你获得了原作者的其他授权，');
                console.warn(' 你需要同样以 AGPL3 协议开源所有的修改，');
                console.warn(' 并保留所有的版权声明。');
                console.warn('\x1b[39m');
                console.log('');
                console.log('Hydro will start in 5s.');
                console.log('Hydro 将在五秒后继续启动。');
                await sleep(5000);
            }
        }
    } catch (e) { }
    await require('./entry/worker').apply(app);
    global.gc?.();
}

export async function loadCli() {
    process.env.HYDRO_CLI = 'true';
    await preload();
    await require('./entry/cli').load(app);
    setTimeout(() => process.exit(0), 300);
}
