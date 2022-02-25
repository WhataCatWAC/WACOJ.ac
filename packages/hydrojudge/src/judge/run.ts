import path from 'path';
import fs from 'fs-extra';
import { STATUS } from '@hydrooj/utils/lib/status';
import compile from '../compile';
import { CompileError } from '../error';
import { run } from '../sandbox';
import signals from '../signals';
import { compilerText, parseMemoryMB, parseTimeMS } from '../utils';
import { Context } from './interface';

const failure = (status: number, message?: string) => ({
    status,
    score: 0,
    time_ms: 0,
    memory_kb: 0,
    message,
});

export const judge = async (ctx: Context) => {
    ctx.stat.judge = new Date();
    ctx.next({ status: STATUS.STATUS_COMPILING });
    try {
        ctx.execute = await compile(ctx.getLang(ctx.lang), ctx.code, {}, ctx.next);
    } catch (e) {
        if (e instanceof CompileError) {
            ctx.next({
                status: STATUS.STATUS_COMPILE_ERROR,
                case: failure(STATUS.STATUS_COMPILE_ERROR, compilerText(e.stdout, e.stderr)),
            });
            ctx.end(failure(STATUS.STATUS_COMPILE_ERROR));
        } else {
            ctx.next({
                status: STATUS.STATUS_SYSTEM_ERROR,
                case: failure(STATUS.STATUS_SYSTEM_ERROR, `${e.message}\n${JSON.stringify(e.params)}`),
            });
            ctx.end(failure(STATUS.STATUS_SYSTEM_ERROR));
        }
        return;
    }
    ctx.clean.push(ctx.execute.clean);
    ctx.next({ status: STATUS.STATUS_JUDGING, progress: 0 });
    const copyIn = { ...ctx.execute.copyIn };
    const { filename } = ctx.config;
    if (filename) copyIn[`${filename}.in`] = { content: ctx.input };
    const copyOut = filename ? [`${filename}.out?`] : [];
    const stdin = path.resolve(ctx.tmpdir, '0.in');
    await fs.writeFile(stdin, ctx.input || '');
    const stdout = path.resolve(ctx.tmpdir, '0.out');
    const stderr = path.resolve(ctx.tmpdir, '0.err');
    const res = await run(
        ctx.execute.execute,
        {
            stdin: filename ? null : stdin,
            stdout: filename ? null : stdout,
            stderr,
            copyIn,
            copyOut,
            time: parseTimeMS(ctx.config.time || '1s') * ctx.execute.time,
            memory: parseMemoryMB(ctx.config.memory || '128m'),
        },
    );
    const { code, time_usage_ms, memory_usage_kb } = res;
    let { status } = res;
    if (!fs.existsSync(stdout)) fs.writeFileSync(stdout, '');
    const message: string[] = [];
    if (status === STATUS.STATUS_ACCEPTED) {
        if (time_usage_ms > parseTimeMS(ctx.config.time || '1s') * ctx.execute.time) {
            status = STATUS.STATUS_TIME_LIMIT_EXCEEDED;
        } else if (memory_usage_kb > parseMemoryMB(ctx.config.memory || '128m') * 1024) {
            status = STATUS.STATUS_MEMORY_LIMIT_EXCEEDED;
        }
    } else if (code) {
        status = STATUS.STATUS_RUNTIME_ERROR;
        if (code < 32) message.push(`ExitCode: ${code} (${signals[code]})`);
        else message.push(`ExitCode: ${code}`);
    }
    message.push(fs.readFileSync(stdout).toString());
    message.push(fs.readFileSync(stderr).toString());
    ctx.next({
        status,
        case: {
            status,
            time_ms: time_usage_ms,
            memory_kb: memory_usage_kb,
            message: message.join('\n').substring(0, 102400),
        },
    });
    ctx.stat.done = new Date();
    if (process.env.DEV) ctx.next({ message: JSON.stringify(ctx.stat) });
    ctx.end({
        status,
        score: status === STATUS.STATUS_ACCEPTED ? 100 : 0,
        time_ms: Math.floor(time_usage_ms * 1000000) / 1000000,
        memory_kb: memory_usage_kb,
    });
};
