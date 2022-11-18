const versionNum = +process.version.replace(/v/gim, '').split('.')[0];
if (versionNum < 14) throw new Error('NodeJS >=14 required');

console.log('Process', process.pid, 'running as', process.env.NODE_APP_INSTANCE === '0' ? 'master' : 'worker');
if (!global.Hydro) {
    global.Hydro = {
        version: {
            node: process.version.split('v')[1],
            hydrooj: require('hydrooj/package.json').version,
        },
        handler: {},
        // @ts-ignore
        service: {},
        // @ts-ignore
        model: {},
        script: {},
        // @ts-ignore
        lib: {},
        module: new Proxy({} as any, {
            get(self, key) {
                if (!self[key]) self[key] = {};
                return self[key];
            },
        }),
        // @ts-ignore
        ui: {
            template: {},
        },
        // @ts-ignore
        error: {},
        locales: {},
    };
    global.addons = [];
}
global.app = new (require('./context').Context)();
