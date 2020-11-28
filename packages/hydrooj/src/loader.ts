/* eslint-disable no-continue */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-eval */
import './interface';
import os from 'os';
import path from 'path';
import cluster from 'cluster';
import wtfnode from 'wtfnode';
import fs from 'fs-extra';
import { argv } from 'yargs';
import AdmZip from 'adm-zip';
import { } from './utils';

export * from './interface';

if (!global.Hydro) {
    global.Hydro = {
        stat: { reqCount: 0 },
        handler: {},
        // @ts-ignore
        service: {},
        // @ts-ignore
        model: {},
        script: {},
        // @ts-ignore
        lib: {},
        // @ts-ignore
        ui: {
            manifest: {},
            nodes: {
                nav: [],
                problem_add: [],
                user_dropdown: [],
            },
            template: {},
        },
        // @ts-ignore
        error: {},
        locales: {},
    };
    global.addons = [];
}

// eslint-disable-next-line import/first
import { Logger } from './logger';
// eslint-disable-next-line import/first
import * as bus from './service/bus';

const logger = new Logger('loader');
wtfnode.setLogger('error', logger.error.bind(logger));
wtfnode.setLogger('warn', logger.warn.bind(logger));
wtfnode.setLogger('info', logger.info.bind(logger));
logger.debug('%o', argv);

async function terminate() {
    wtfnode.dump();
    try {
        await bus.parallel('app/exit');
    } catch (e) {
        process.exit(1);
    }
    process.exit(0);
}

async function fork(args: string[] = []) {
    const _args = process.argv.slice(2);
    _args.push(...args, `--addons=${Buffer.from(JSON.stringify(global.addons)).toString('base64')}`);
    cluster.setupMaster({ args: _args });
    return cluster.fork();
}

interface EntryConfig {
    entry: string,
    newProcess?: boolean,
}

async function entry(config: EntryConfig) {
    if (config.entry) {
        if (config.newProcess) {
            const p = await fork([`--entry=${config.entry}`]);
            await new Promise((resolve, reject) => {
                p.on('exit', (code, signal) => {
                    if (code === 0) resolve();
                    else reject(signal);
                });
                p.on('error', (err: Error) => {
                    p.kill();
                    reject(err);
                });
            });
        } else {
            const loader = require(`./entry/${config.entry}`);
            return await loader.load(entry, global.addons);
        }
    }
    return null;
}

export type Entry = typeof entry;

async function stopWorker() {
    cluster.disconnect();
}

async function startWorker(cnt: number) {
    await fork(['--firstWorker']);
    for (let i = 1; i < cnt; i++) await fork();
}

async function executeCommand(input: string) {
    try {
        const t = eval(input.toString().trim());
        if (t instanceof Promise) console.log(await t);
        else console.log(t);
    } catch (e) {
        console.warn(e);
    }
}

async function reload(count = 1) {
    logger.info('Reloading');
    await stopWorker();
    logger.info('Worker stopped');
    await startWorker(count);
}

async function messageHandler(worker: cluster.Worker, msg: any) {
    if (!msg) msg = worker;
    if (msg.event) {
        if (msg.event === 'bus') {
            if (cluster.isMaster) {
                for (const i in cluster.workers) {
                    cluster.workers[i].send(msg);
                }
            } else {
                global.Hydro.service.bus.emit(msg.eventName, ...msg.payload);
            }
        } else if (msg.event === 'stat') {
            global.Hydro.stat.reqCount += msg.count;
        } else if (msg.event === 'restart') {
            await reload(msg.count);
        } else if (msg.event === 'run') {
            await executeCommand(msg.command);
        }
    }
}

const moduleTemp = path.resolve(os.tmpdir(), 'hydro', 'module');
const publicTemp = path.resolve(os.tmpdir(), 'hydro', 'public');
const tmp = path.resolve(os.tmpdir(), 'hydro', '__');

export function addon(addonPath: string) {
    let modulePath = path.resolve(process.cwd(), addonPath);
    if (!(fs.existsSync(addonPath) && fs.statSync(addonPath).isFile())) {
        try {
            // Is a npm package
            const packagejson = require.resolve(`${addonPath}/package.json`);
            modulePath = path.dirname(packagejson);
            const publicPath = path.resolve(modulePath, 'public');
            if (fs.existsSync(publicPath)) fs.copySync(publicPath, publicTemp);
            global.addons.push(modulePath);
        } catch (e) {
            logger.error(`Addon not found: ${addonPath}`);
        }
    } else if (modulePath.endsWith('.hydro')) {
        try {
            // Is *.hydro module
            const t = modulePath.split(path.sep);
            const name = t[t.length - 1].split('.')[0];
            const zip = new AdmZip(modulePath);
            const targetPath = path.resolve(moduleTemp, name);
            zip.extractAllTo(targetPath, true);
            const content = fs.readdirSync(targetPath);
            const ipath = path.join(targetPath, content[0]);
            if (content.length === 1 && fs.statSync(ipath).isDirectory()) {
                fs.moveSync(ipath, tmp);
                fs.rmdirSync(targetPath);
                fs.moveSync(tmp, targetPath);
            }
            const publicPath = path.resolve(targetPath, 'public');
            if (fs.existsSync(publicPath)) fs.copySync(publicPath, publicTemp);
            global.addons.push(targetPath);
        } catch (e) {
            logger.error('Addon load fail: ', e);
            throw e;
        }
    } else logger.error(`Addon not found: ${addonPath}`);
}

process.on('unhandledRejection', logger.error);
process.on('SIGINT', terminate);

export async function load() {
    addon(path.resolve(__dirname, '..'));
    Error.stackTraceLimit = 50;
    process.on('message', messageHandler);
    cluster.on('message', messageHandler);
    if (cluster.isMaster || argv.startAsMaster) {
        logger.info(`Master ${process.pid} Starting`);
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (buf) => {
            const input = buf.toString();
            if (input[0] === '@') {
                for (const i in cluster.workers) {
                    cluster.workers[i].send({ event: 'run', command: input.substr(1, input.length - 1) });
                    break;
                }
            } else {
                executeCommand(input);
            }
        });
        const cnt = await entry({ entry: 'master' });
        logger.info('Master started');
        cluster.on('exit', (worker, code, signal) => {
            logger.warn(`Worker ${worker.process.pid} ${worker.id} exit: ${code} ${signal}`);
        });
        cluster.on('disconnect', (worker) => {
            logger.info(`Worker ${worker.process.pid} ${worker.id} disconnected`);
        });
        cluster.on('listening', (worker, address) => {
            logger.success(`Worker ${worker.process.pid} ${worker.id} listening at `, address);
        });
        cluster.on('online', (worker) => {
            logger.success(`Worker ${worker.process.pid} ${worker.id} is online`);
        });
        await startWorker(cnt);
    } else {
        global.addons = JSON.parse(Buffer.from(argv.addons as string, 'base64').toString());
        logger.info('%o', global.addons);
        if (argv.entry) {
            logger.info(`Worker ${process.pid} Starting as ${argv.entry}`);
            await entry({ entry: argv.entry as string });
            logger.success(`Worker ${process.pid} Started as ${argv.entry}`);
        } else {
            if (argv.firstWorker) global.Hydro.isFirstWorker = true;
            else global.Hydro.isFirstWorker = false;
            logger.info(`Worker ${process.pid} Starting`);
            await entry({ entry: 'worker' });
            logger.success(`Worker ${process.pid} Started`);
        }
    }
    if (global.gc) global.gc();
}

export async function loadCli() {
    await entry({ entry: 'cli' });
    return terminate();
}

if (argv.pandora || !module.parent) {
    const func = argv._[0] === 'cli' ? load : loadCli;
    func().catch((e) => {
        logger.error(e);
        process.exit(1);
    });
}
