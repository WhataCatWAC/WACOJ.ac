import { extname } from 'path';
import { escapeRegExp } from 'lodash';
import { lookup } from 'mime-types';
import moment from 'moment';
import { nanoid } from 'nanoid';
import type { Readable } from 'stream';
import * as bus from '../service/bus';
import db from '../service/db';
import storage from '../service/storage';
import * as system from './system';
import TaskModel from './task';

export class StorageModel {
    static coll = db.collection('storage');

    static async put(path: string, file: string | Buffer | Readable, owner?: number) {
        const meta = {};
        await StorageModel.del([path]);
        meta['Content-Type'] = (path.endsWith('.ans') || path.endsWith('.out'))
            ? 'text/plain'
            : lookup(path) || 'application/octet-stream';
        let _id = `${nanoid(3)}/${nanoid()}${extname(path)}`;
        // Make sure id is not used
        // eslint-disable-next-line no-await-in-loop
        while (await StorageModel.coll.findOne({ _id })) _id = `${nanoid(3)}/${nanoid()}${extname(path)}`;
        await storage.put(_id, file, meta);
        const { metaData, size, etag } = await storage.getMeta(_id);
        await StorageModel.coll.insertOne({
            _id, meta: metaData, path, size, etag, lastModified: new Date(), owner,
        });
        return path;
    }

    static async get(path: string, savePath?: string) {
        const { value } = await StorageModel.coll.findOneAndUpdate(
            { path, autoDelete: null },
            { $set: { lastUsage: new Date() } },
            { returnDocument: 'after' },
        );
        return await storage.get(value?._id || path, savePath);
    }

    static async rename(path: string, newPath: string, operator = 1) {
        return await StorageModel.coll.updateOne(
            { path, autoDelete: null },
            { $set: { path: newPath }, $push: { operator } },
        );
    }

    static async del(path: string[], operator = 1) {
        if (!path.length) return;
        const autoDelete = moment().add(7, 'day').toDate();
        await StorageModel.coll.updateMany(
            { path: { $in: path }, autoDelete: null },
            { $set: { autoDelete }, $push: { operator } },
        );
    }

    static async list(target: string, recursive = true) {
        if (target.includes('..') || target.includes('//')) throw new Error('Invalid path');
        if (target.length && !target.endsWith('/')) target += '/';
        const results = await StorageModel.coll.find({
            path: { $regex: new RegExp(`^${escapeRegExp(target)}${recursive ? '' : '[^/]+$'}`, 'i') },
            autoDelete: null,
        }).toArray();
        return results.map((i) => ({
            ...i, name: i.path.split(target)[1], prefix: target,
        }));
    }

    static async getMeta(path: string) {
        const { value } = await StorageModel.coll.findOneAndUpdate(
            { path, autoDelete: null },
            { $set: { lastUsage: new Date() } },
            { returnDocument: 'after' },
        );
        if (!value) return null;
        return {
            ...value.meta,
            size: value.size,
            lastModified: value.lastModified,
            etag: value.etag,
        };
    }

    static async signDownloadLink(target: string, filename?: string, noExpire = false, useAlternativeEndpointFor?: 'user' | 'judge') {
        const res = await StorageModel.coll.findOneAndUpdate(
            { path: target, autoDelete: null },
            { $set: { lastUsage: new Date() } },
        );
        return await storage.signDownloadLink(res.value?._id || target, filename, noExpire, useAlternativeEndpointFor);
    }

    static async copy(src: string, dst: string) {
        const { value } = await StorageModel.coll.findOneAndUpdate(
            { path: src, autoDelete: null },
            { $set: { lastUsage: new Date() } },
            { returnDocument: 'after' },
        );
        const meta = {};
        await StorageModel.del([dst]);
        meta['Content-Type'] = (dst.endsWith('.ans') || dst.endsWith('.out'))
            ? 'text/plain'
            : lookup(dst) || 'application/octet-stream';
        let _id = `${nanoid(3)}/${nanoid()}${extname(dst)}`;
        // Make sure id is not used
        // eslint-disable-next-line no-await-in-loop
        while (await StorageModel.coll.findOne({ _id })) _id = `${nanoid(3)}/${nanoid()}${extname(dst)}`;
        const result = await storage.copy(value._id, dst);
        const { metaData, size, etag } = await storage.getMeta(_id);
        await StorageModel.coll.insertOne({
            _id, meta: metaData, path: dst, size, etag, lastModified: new Date(), owner: value.owner || 1,
        });
        return result;
    }
}

async function cleanFiles() {
    const submissionKeepDate = system.get('submission.saveDays');
    if (submissionKeepDate) {
        const shouldDelete = moment().subtract(submissionKeepDate, 'day').toDate();
        const res = await StorageModel.coll.find({
            path: /^submission\//g,
            lastModified: { $lt: shouldDelete },
        }).toArray();
        const paths = res.map((i) => i.path);
        await StorageModel.del(paths);
    }
    if (system.get('server.keepFiles')) return;
    let res = await StorageModel.coll.findOneAndDelete({ autoDelete: { $lte: new Date() } });
    while (res.value) {
        // eslint-disable-next-line no-await-in-loop
        await storage.del(res.value._id);
        // eslint-disable-next-line no-await-in-loop
        res = await StorageModel.coll.findOneAndDelete({ autoDelete: { $lte: new Date() } });
    }
}
TaskModel.Worker.addHandler('storage.prune', cleanFiles);
bus.on('ready', async () => {
    if (process.env.NODE_APP_INSTANCE !== '0') return;
    await db.ensureIndexes(
        StorageModel.coll,
        { key: { path: 1, autoDelete: 1 }, sparse: true, name: 'autoDelete' },
    );
    if (!await TaskModel.count({ type: 'schedule', subType: 'storage.prune' })) {
        await TaskModel.add({
            type: 'schedule',
            subType: 'storage.prune',
            executeAfter: moment().startOf('hour').toDate(),
            interval: [1, 'hour'],
        });
    }
});
bus.on('domain/delete', async (domainId) => {
    const files = await StorageModel.list(`problem/${domainId}`);
    await StorageModel.del(files.map((i) => i.path));
});

global.Hydro.model.storage = StorageModel;
export default StorageModel;
