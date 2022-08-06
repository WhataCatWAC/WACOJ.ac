/* eslint-disable no-unreachable */
/* eslint-disable consistent-return */
/* eslint-disable no-undef */
/// <reference types="./jssh" />

const locales = {
    zh: {
        'install.start': '开始运行 Hydro 安装工具',
        'info.mirror': '将首选 %s 镜像。可以使用 MIRROR=tsinghua|tencent|official 更改。',
        'warn.avx2': '检测到您的 CPU 不支持 avx2 指令集，将使用 mongodb@v4.4',
        'error.rootRequired': '请先使用 sudo su 切换到 root 用户后再运行该工具。',
        'error.unsupportedArch': '不支持的架构 %s ,请尝试手动安装。',
        'error.osreleaseNotFound': '无法获取系统版本信息（/etc/os-release 文件未找到），请尝试手动安装。',
        'error.unsupportedOS': '不支持的操作系统 %s ，请尝试手动安装，',
        'install.preparing': '正在初始化安装...',
        'install.mongodb': '正在安装 mongodb...',
        'install.nvm': '正在安装 NVM...',
        'error.nodeWithoutNVMDetected': '检测到您的系统中安装了 Node，但未使用 NVM，请尝试手动安装或卸载当前 Node 后再试。',
        'install.nodejs': '正在安装 NodeJS...',
        'error.nodeVersionPraseFail': '无法解析 Node 版本号，请尝试手动安装。',
        'install.pm2': '正在安装 PM2...',
        'install.createDatabaseUser': '正在创建数据库用户...',
        'install.minio': '正在安装 MinIO...',
        'install.compiler': '正在安装编译器...',
        'install.hydro': '正在安装 Hydro...',
        'install.done': 'Hydro 安装成功！',
        'extra.restartTerm': '请重启终端（或重新连接ssh）并切换到 root 用户执行剩下的操作。',
        'extra.dbUser': '数据库用户名： hydro',
        'extra.dbPassword': '数据库密码： %s',
        'info.skip': '步骤已跳过。',
    },
    en: {
        'install.start': 'Starting Hydro installation tool',
        'info.mirror': 'Using preferred %s mirror. You can use MIRROR=tsinghua|tencent|official to change.',
        'warn.avx2': 'Your CPU does not support avx2, will use mongodb@v4.4',
        'error.rootRequired': 'Please run this tool as root user.',
        'error.unsupportedArch': 'Unsupported architecture %s, please try to install manually.',
        'error.osreleaseNotFound': 'Unable to get system version information (/etc/os-release file not found), please try to install manually.',
        'error.unsupportedOS': 'Unsupported operating system %s, please try to install manually.',
        'install.preparing': 'Initializing installation...',
        'install.mongodb': 'Installing mongodb...',
        'install.nvm': 'Installing NVM...',
        'error.nodeWithoutNVMDetected': 'Detected Node installation without NVM, please try to install manually or uninstall current Node first.',
        'install.nodejs': 'Installing NodeJS...',
        'error.nodeVersionPraseFail': 'Unable to parse Node version, please try to install manually.',
        'install.pm2': 'Installing PM2...',
        'install.createDatabaseUser': 'Creating database user...',
        'install.minio': 'Installing MinIO...',
        'install.compiler': 'Installing compiler...',
        'install.hydro': 'Installing Hydro...',
        'install.done': 'Hydro installation completed!',
        'extra.restartTerm': 'Please restart your terminal (or reconnect ssh) and switch to root user to execute the remaining operations.',
        'extra.dbUser': 'Database username: hydro',
        'extra.dbPassword': 'Database password: %s',
        'info.skip': 'Step skipped.',
    },
};

if (__user !== 'root') log.fatal('error.rootRequired');
if (__arch !== 'amd64') log.fatal('error.unsupportedArch', __arch);
const dev = !!cli.get('dev');
if (!fs.exist('/etc/os-release')) log.fatal('error.osreleaseNotFound');
const osinfoFile = fs.readfile('/etc/os-release');
const lines = osinfoFile.split('\n');
const values = {};
for (const line of lines) {
    if (!line.trim()) continue;
    const d = line.split('=');
    if (d[1].startsWith('"')) values[d[0].toLowerCase()] = d[1].substr(1, d[1].length - 2);
    else values[d[0].toLowerCase()] = d[1];
}
if (!['ubuntu', 'arch', 'debian'].includes(values.id)) log.fatal('error.unsupportedOS', values.id);
const Arch = values.id === 'arch';
const cpuInfoFile = fs.readfile('/proc/cpuinfo');
let mongodbVersion = __env.MONGODB_VERSION || '5.0';
if (!cpuInfoFile.includes('avx2')) {
    log.warn('warn.avx2');
    mongodbVersion = '4.4';
}
let migration;
const preferredMirror = __env.MIRROR || 'tsinghua';
const mirrors = {
    node: {
        tsinghua: 'https://mirrors.tuna.tsinghua.edu.cn/nodejs-release',
        tencent: 'https://mirrors.cloud.tencent.com/nodejs-release',
        official: 'https://nodejs.org/dist',
    },
    mongodb: {
        tsinghua: `https://mirrors.tuna.tsinghua.edu.cn/mongodb/apt/${values.id}`,
        tencent: `https://mirrors.cloud.tencent.com/mongodb/apt/${values.id}`,
        official: `https://repo.mongodb.org/apt/${values.id}`,
    },
    minio: {
        hydro: 'https://kr.hydro.ac/download/minio',
        // xiaoheiban: 'https://pro-file.xiaoheiban.cn/minio', // UNSAFE
        undefined: 'https://s3.undefined.moe/public/minio',
        official: 'https://dl.min.io/server/minio/release/linux-amd64/minio',
    },
    sandbox: {
        hydro: 'https://kr.hydro.ac/download/sandbox',
        undefined: 'https://s3.undefined.moe/file/executor-amd64',
        official: 'https://github.com/criyle/go-judge/releases/download/v1.4.0/executorserver-amd64',
    },
};
let retry = 0;
/** @argument {keyof typeof mirrors} target */
function getMirror(target) {
    if (!mirrors[target]) log.fatal('Unknown resource:', target);
    const res = [];
    if (mirrors[target][preferredMirror]) res.push(mirrors[target][preferredMirror]);
    res.push(...Object.keys(mirrors[target]).map((i) => mirrors[target][i]));
    return res[retry % res.length];
}
let locale = __env.LANG?.includes('zh') ? 'zh' : 'en';
if (__env.TERM === 'linux') locale = 'en';
log.info = ((orig) => (str, ...args) => orig(locales[locale][str] || str, ...args) && 0)(log.info);
log.warn = ((orig) => (str, ...args) => orig(locales[locale][str] || str, ...args) && 0)(log.warn);
log.fatal = ((orig) => (str, ...args) => orig(locales[locale][str] || str, ...args) && 0)(log.fatal);

log.info('install.start');
const MINIO_ACCESS_KEY = randomstring(32);
const MINIO_SECRET_KEY = randomstring(32);
let DATABASE_PASSWORD = randomstring(32);

const source_nvm = `
# load nvm env (by hydro installer)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
`;

const steps = [
    {
        init: 'install.preparing',
        operations: [
            () => log.info('info.mirror', preferredMirror),
            'mkdir -p /data/db /data/file ~/.hydro',
            Arch ? 'pacman --needed --quiet --noconfirm -Sy' : 'apt-get -qq update',
            Arch
                ? 'pacman --needed --quiet --noconfirm -S gnupg curl qrencode'
                : 'apt-get install -qy unzip zip curl wget gnupg qrencode ca-certificates',
            () => {
                if (locale === 'zh') {
                    log.info('扫码加入QQ群：');
                    exec('echo https://qm.qq.com/cgi-bin/qm/qr\\?k\\=0aTZfDKURRhPBZVpTYBohYG6P6sxABTw | qrencode -o - -m 2 -t UTF8', {}, 0);
                }
            },
            () => {
                return; // Not implemented yet
                if (fs.exist('/home/judge/src')) {
                    const res = cli.prompt('migrate.hustojFound');
                    if (res.toLowerCase().trim() === 'y') migration = 'hustoj';
                }

                const docker = !exec1('docker -v').code;
                if (!docker) return;
                // TODO check more places
                if (fs.exist('/root/OnlineJudgeDeploy/docker-compose.yml')) {
                    const res = cli.prompt('migrate.qduojFound');
                    if (res.toLowerCase().trim() === 'y') migration = 'qduoj';
                }
            },
        ],
    },
    {
        init: 'install.mongodb',
        skip: () => fs.exist('/usr/bin/mongo'),
        operations: Arch
            ? [
                ['curl -fSLO https://s3.undefined.moe/hydro/arch/libcurl-openssl-1.0-7.76.0-1-x86_64.pkg.tar.zst', { retry: true }],
                ['curl -fSLO https://s3.undefined.moe/hydro/arch/mongodb-bin-4.4.5-1-x86_64.pkg.tar.zst', { retry: true }],
                ['curl -fSLO https://s3.undefined.moe/hydro/arch/mongodb-tools-bin-100.3.1-1-x86_64.pkg.tar.zst', { retry: true }],
                'pacman --noconfirm -U libcurl-openssl-1.0-7.76.0-1-x86_64.pkg.tar.zst'
                + 'mongodb-bin-4.4.5-1-x86_64.pkg.tar.zst mongodb-tools-bin-100.3.1-1-x86_64.pkg.tar.zst',
            ]
            : [
                // https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/
                ['apt-get upgrade openssl ca-certificates -y', { retry: true }],
                [`wget -qO - https://www.mongodb.org/static/pgp/server-${mongodbVersion}.asc | apt-key add -`, { retry: true }],
                [`echo "deb ${getMirror('mongodb')} ${values.ubuntu_codename}\
/mongodb-org/${mongodbVersion} multiverse" >/etc/apt/sources.list.d/mongodb-org-${mongodbVersion}.list && \
apt-get -qq update && apt-get -q install -y mongodb-org`, { retry: true }],
            ],
    },
    {
        init: 'install.nvm',
        skip: () => {
            const nvm = fs.exist('/root/.nvm');
            const node = !exec('node -v').code;
            if (node && !nvm) log.warn('error.nodeWithoutNVMDetected');
            return nvm;
        },
        operations: [
            () => {
                const resp = http.request('GET', 'https://hydro.ac/nvm.sh');
                const script = resp.body
                    .replace(/raw\.githubusercontent\.com/g, 'raw.fastgit.org')
                    .replace(/github\.com\/nvm-sh\/nvm\.git/g, 'gitee.com/imirror/nvm');
                fs.writefile('/tmp/install-nvm.sh', script);
            },
            ['bash /tmp/install-nvm.sh', { retry: true }],
        ],
    },
    {
        init: 'install.nodejs',
        operations: [
            () => {
                const res = exec1('bash -c "source /root/.nvm/nvm.sh && nvm install 14"', {
                    NVM_NODEJS_ORG_MIRROR: getMirror('node'),
                });
                let ver;
                try {
                    ver = res.output.split('Now using node v')[1].split(' ')[0];
                } catch (e) {
                    log.error('error.nodeVersionParseFail');
                    return 'retry';
                }
                setenv('PATH', `/root/.nvm/versions/node/v${ver}/bin:${__env.PATH}`);
                const shell = __env.SHELL ? __env.SHELL.split('/') : ['bash'];
                const rc = `/root/.${shell[shell.length - 1]}rc`;
                if (!fs.exist(rc)) fs.writefile(rc, source_nvm);
                else {
                    const file = fs.readfile(rc);
                    if (!file.includes(source_nvm)) fs.appendfile(rc, source_nvm);
                }
            },
            ['npm i yarn -g', { retry: true }],
        ],
    },
    {
        init: 'install.pm2',
        skip: () => fs.exist('/usr/local/bin/pm2'),
        operations: ['yarn global add pm2'],
    },
    {
        init: 'install.createDatabaseUser',
        skip: () => fs.exist('/root/.hydro/config.json'),
        operations: [
            'pm2 start mongod',
            () => sleep(5000),
            () => fs.writefile('/tmp/createUser.js', `\
            db.createUser({
              user: 'hydro',
              pwd: '${DATABASE_PASSWORD}',
              roles: [{ role: 'readWrite', db: 'hydro' }]
            })`),
            'mongo 127.0.0.1:27017/hydro /tmp/createUser.js',
            () => fs.writefile('/root/.hydro/config.json', JSON.stringify({
                host: '127.0.0.1',
                port: 27017,
                name: 'hydro',
                username: 'hydro',
                password: DATABASE_PASSWORD,
            })),
            'pm2 stop mongod',
            'pm2 del mongod',
        ],
    },
    {
        init: 'install.minio',
        skip: () => __env.SKIP_MINIO || fs.exist('/root/.hydro/env'),
        operations: [
            [`curl -fSL ${getMirror('minio')} -o /usr/bin/minio`, { retry: true }],
            'chmod +x /usr/bin/minio',
        ],
    },
    {
        init: 'install.compiler',
        operations: [
            Arch ? 'pacman --needed --quiet --noconfirm -S gcc fpc' : 'apt-get install -y g++ fp-compiler >/dev/null',
        ],
    },
    {
        init: 'install.sandbox',
        operations: [
            [`curl -fSL ${getMirror('sandbox')} -o /usr/bin/hydro-sandbox`, { retry: true }],
            'chmod +x /usr/bin/hydro-sandbox',
        ],
    },
    {
        init: 'install.hydro',
        operations: [
            ...(dev
                ? [
                    ['rm -rf /root/Hydro && git clone https://github.com/hydro-dev/Hydro.git /root/Hydro', { retry: true }],
                    ['cd /root/Hydro && yarn', { retry: true }],
                    'cd /root/Hydro && yarn build:ui',
                    ['yarn global add npx', { retry: true }],
                ]
                : [['yarn global add hydrooj @hydrooj/ui-default @hydrooj/hydrojudge', { retry: true }]]),
            () => fs.writefile('/root/.hydro/addon.json', '["@hydrooj/ui-default","@hydrooj/hydrojudge"]'),
        ],
    },
    {
        init: 'install.starting',
        operations: [
            `echo "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}\nMINIO_SECRET_KEY=${MINIO_SECRET_KEY}" >/root/.hydro/env`,
            `pm2 start "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY} MINIO_SECRET_KEY=${MINIO_SECRET_KEY} minio server /data/file" --name minio`,
            'pm2 start mongod --name mongodb -- --auth --bind_ip 0.0.0.0',
            () => sleep(1000),
            'pm2 start hydro-sandbox',
            'pm2 start hydrooj',
            'pm2 startup',
            'pm2 save',
        ],
    },
    {
        init: 'install.migrateHustoj',
        skip: () => migration !== 'hustoj',
        silent: true,
        operations: [
            ['yarn global add @hydrooj/migrate-hustoj', { retry: true }],
            'hydrooj addon add @hydrooj/migrate-hustoj',
            () => {
                const config = {
                    host: 'localhost',
                    port: 3306,
                    name: 'jol',
                    dataDir: '/home/judge/data',
                    // TODO: auto-read uname&passwd&contestType
                    username: 'debian-sys-maint',
                    password: '',
                    contestType: 'acm',
                };
                exec2(`hydrooj cli script migrateHustoj ${JSON.stringify(config)}`);
            },
            'pm2 restart hydrooj',
        ],
    },
    {
        init: 'install.done',
        operations: [
            () => {
                DATABASE_PASSWORD = loadconfig('/root/.hydro/config.json').password;
            },
            () => log.info('extra.restartTerm'),
            () => log.info('extra.dbUser'),
            () => log.info('extra.dbPassword', DATABASE_PASSWORD),
            () => log.info('MINIO_ACCESS_KEY=%s', MINIO_ACCESS_KEY),
            () => log.info('MINIO_SECRET_KEY=%s', MINIO_SECRET_KEY),
        ],
    },
];

for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.silent) log.info(step.init);
    if (!(step.skip && step.skip())) {
        for (let op of step.operations) {
            if (!(op instanceof Array)) op = [op, {}];
            if (typeof op[0] === 'string') {
                retry = 0;
                exec(op[0], op[1]);
                while (__code !== 0) {
                    if (op[1].retry && retry < 30) {
                        log.warn('Retry... (%s)', op[0]);
                        exec(op[0], op[1]);
                        retry++;
                    } else log.fatal('Error when running %s', op[0]);
                }
            } else {
                retry = 0;
                let res = op[0](op[1]);
                while (res === 'retry') {
                    if (retry < 30) {
                        log.warn('Retry...');
                        res = op[0](op[1]);
                        retry++;
                    } else log.fatal('Error installing');
                }
            }
        }
    } else if (!step.silent) log.info('info.skip');
}

exit(0);
