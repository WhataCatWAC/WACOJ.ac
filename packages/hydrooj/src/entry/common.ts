/* eslint-disable no-await-in-loop */
/* eslint-disable no-eval */
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { Logger } from '../logger';
import * as bus from '../service/bus';

const logger = new Logger('common', true);

export const builtinLib = [
    'jwt', 'download', 'i18n', 'mail', 'useragent',
    'crypto', 'misc', 'paginate', 'hash.hydro', 'rank',
    'validator', 'ui', 'sysinfo', 'testdata.convert.ini', 'testdataConfig',
    'content',
];

export const builtinModel = [
    'builtin', 'document', 'domain', 'blacklist', 'opcount',
    'setting', 'token', 'user', 'problem', 'record',
    'contest', 'message', 'solution', 'training', 'oplog',
    'discussion', 'system',
];

export const builtinHandler = [
    'home', 'problem', 'record', 'judge', 'user',
    'contest', 'training', 'discussion', 'manage', 'import.syzoj',
    'misc', 'homework', 'domain',
];

export const builtinScript = [
    'rating', 'difficulty', 'problemStat', 'blacklist', 'deleteUser',
];

function getFiles(folder: string, base = ''): string[] {
    const files = [];
    const f = fs.readdirSync(folder);
    for (const i of f) {
        if (fs.statSync(path.join(folder, i)).isDirectory()) {
            files.push(...getFiles(path.join(folder, i), path.join(base, i)));
        } else files.push(path.join(base, i));
    }
    return files.map((item) => item.replace(/\\/gmi, '/'));
}

export async function handler(pending: string[], fail: string[]) {
    for (const i of pending) {
        const p = path.resolve(i, 'handler.js');
        if (fs.existsSync(p) && !fail.includes(i)) {
            try {
                logger.info('Handler init: %s', i);
                eval('require')(p);
            } catch (e) {
                fail.push(i);
                logger.error('Handler Load Fail: %s', i);
                logger.error(e);
            }
        }
    }
    await bus.serial('app/load/handler');
}

export async function locale(pending: string[], fail: string[]) {
    for (const i of pending) {
        let p = path.resolve(i, 'locales');
        if (!fs.existsSync(p)) p = path.resolve(i, 'locale');
        if (fs.existsSync(p) && fs.statSync(p).isDirectory() && !fail.includes(i)) {
            try {
                const files = fs.readdirSync(p);
                const locales = {};
                for (const file of files) {
                    const content = fs.readFileSync(path.resolve(p, file)).toString();
                    locales[file.split('.')[0]] = yaml.load(content);
                }
                global.Hydro.lib.i18n(locales);
                logger.info('Locale init: %s', i);
            } catch (e) {
                fail.push(i);
                logger.error('Locale Load Fail: %s', i);
                logger.error(e);
            }
        }
    }
    await bus.serial('app/load/locale');
}

export async function setting(pending: string[], fail: string[], modelSetting: typeof import('../model/setting')) {
    const map = {
        system: modelSetting.SystemSetting,
        account: modelSetting.AccountSetting,
        preference: modelSetting.PreferenceSetting,
    };
    for (const i of pending) {
        let p = path.resolve(i, 'setting.yaml');
        const t = i.split(path.sep);
        const name = t[t.length - 1];
        if (!fs.existsSync(p)) p = path.resolve(i, 'settings.yaml');
        if (fs.existsSync(p) && !fail.includes(i)) {
            try {
                const cfg: any = yaml.load(fs.readFileSync(p).toString());
                for (const key in cfg) {
                    let val = cfg[key].default;
                    if (typeof val === 'string') {
                        val = val
                            .replace(/\$TEMP/g, os.tmpdir())
                            .replace(/\$HOME/g, os.homedir());
                    }
                    map[cfg[key].category || 'system'](
                        modelSetting.Setting(
                            name, `${name}.${key}`, cfg[key].range, val,
                            cfg[key].type || 'text', cfg[key].name || key, cfg[key].desc || '',
                        ),
                    );
                }
            } catch (e) {
                logger.error('Config Load Fail: %s', i);
                logger.error(e);
            }
        }
    }
    await bus.serial('app/load/setting');
}

export async function template(pending: string[], fail: string[]) {
    for (const i of pending) {
        let p = path.resolve(i, 'templates');
        if (!fs.existsSync(p)) p = path.resolve(i, 'template');
        if (fs.existsSync(p) && fs.statSync(p).isDirectory() && !fail.includes(i)) {
            try {
                const files = getFiles(p);
                for (const file of files) {
                    global.Hydro.ui.template[file] = fs.readFileSync(
                        path.resolve(p, file),
                    ).toString();
                }
                logger.info('Template init: %s', i);
            } catch (e) {
                fail.push(i);
                logger.error('Template Load Fail: %s', i);
                logger.error(e);
            }
        }
    }
    await bus.serial('app/load/template');
}

export async function uistatic(pending: string[], fail: string[]) {
    for (const i of pending) {
        const p = path.resolve(i, 'public', 'static-manifest.json');
        if (fs.existsSync(p) && fs.statSync(p).isFile() && !fail.includes(i)) {
            try {
                Object.assign(global.Hydro.ui.manifest, eval('require')(p));
            } catch (e) {
                fail.push(i);
            }
        }
    }
}

export async function model(pending: string[], fail: string[]) {
    for (const i of pending) {
        const p = path.resolve(i, 'model.js');
        if (fs.existsSync(p) && !fail.includes(i)) {
            try {
                logger.info('Model init: %s', i);
                eval('require')(p);
            } catch (e) {
                fail.push(i);
                logger.error('Model Load Fail: %s', i);
                logger.error(e);
            }
        }
    }
    await bus.serial('app/load/model');
}

export async function lib(pending: string[], fail: string[]) {
    for (const i of pending) {
        const p = path.resolve(i, 'lib.js');
        if (fs.existsSync(p) && !fail.includes(i)) {
            try {
                logger.info('Lib init: %s', i);
                eval('require')(p);
            } catch (e) {
                fail.push(i);
                logger.error('Lib Load Fail: %s', i);
                logger.error(e);
            }
        }
    }
    await bus.serial('app/load/lib');
}

export async function service(pending: string[], fail: string[]) {
    for (const i of pending) {
        const p = path.resolve(i, 'service.js');
        if (fs.existsSync(p) && !fail.includes(i)) {
            try {
                logger.info('Service init: %s', i);
                eval('require')(p);
            } catch (e) {
                fail.push(i);
                logger.error('Service Load Fail: %s', i);
                logger.error(e);
            }
        }
    }
    await bus.serial('app/load/service');
}

export async function script(pending: string[], fail: string[], active: string[]) {
    for (const i of pending) {
        const p = path.resolve(i, 'script.js');
        if (fs.existsSync(p) && !fail.includes(i)) {
            try {
                logger.info('Script init: %s', i);
                eval('require')(p);
            } catch (e) {
                fail.push(i);
                logger.error('Script Load Fail: %s', i);
                logger.error(e);
            }
        }
        active.push(i);
    }
    await bus.serial('app/load/script');
}
