import assert from 'assert';
import { statSync } from 'fs-extra';
import { pick } from 'lodash';
import { FilterQuery, ObjectID } from 'mongodb';
import { sortFiles } from '@hydrooj/utils/lib/utils';
import {
    FileLimitExceededError, FileUploadError, ProblemNotFoundError, ValidationError,
} from '../error';
import { Tdoc, TrainingDoc } from '../interface';
import paginate from '../lib/paginate';
import { PERM, PRIV, STATUS } from '../model/builtin';
import * as oplog from '../model/oplog';
import problem from '../model/problem';
import storage from '../model/storage';
import * as system from '../model/system';
import * as training from '../model/training';
import user from '../model/user';
import * as bus from '../service/bus';
import {
    Handler, param, post, Types,
} from '../service/server';

async function _parseDagJson(domainId: string, _dag: string): Promise<Tdoc['dag']> {
    const parsed = [];
    try {
        const dag = JSON.parse(_dag);
        assert(dag instanceof Array, 'dag must be an array');
        const ids = new Set(dag.map((s) => s._id));
        assert(dag.length, 'must have at least one node');
        assert(dag.length === ids.size, '_id must be unique');
        for (const node of dag) {
            assert(node._id, 'each node should have a _id');
            assert(node.title, 'each node shoule have a title');
            assert(node.requireNids instanceof Array);
            assert(node.pids instanceof Array);
            assert(node.pids.length, 'each node must contain at lease one problem');
            for (const nid of node.requireNids) {
                assert(ids.has(nid), `required nid ${nid} not found`);
            }
            const tasks = [];
            for (const i in node.pids) {
                tasks.push(problem.get(domainId, node.pids[i]).then((pdoc) => {
                    if (!pdoc) throw new ProblemNotFoundError(domainId, node.pids[i]);
                    node.pids[i] = pdoc.docId;
                }));
            }
            // eslint-disable-next-line no-await-in-loop
            await Promise.all(tasks);
            const newNode = {
                _id: +node._id,
                title: node.title,
                requireNids: Array.from(new Set(node.requireNids)),
                pids: Array.from(new Set(node.pids)),
            };
            parsed.push(newNode);
        }
    } catch (e) {
        throw new ValidationError('dag', null, e instanceof ProblemNotFoundError ? e : e.message);
    }
    return parsed;
}

class TrainingMainHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    async get(domainId: string, page = 1) {
        const query: FilterQuery<TrainingDoc> = {};
        await bus.parallel('training/list', query, this);
        const [tdocs, tpcount] = await paginate(
            training.getMulti(domainId),
            page,
            system.get('pagination.training'),
        );
        const tids: Set<ObjectID> = new Set();
        for (const tdoc of tdocs) tids.add(tdoc.docId);
        const tsdict = {};
        let tdict = {};
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            const enrolledTids: Set<ObjectID> = new Set();
            const tsdocs = await training.getMultiStatus(domainId, {
                uid: this.user._id,
                $or: [{ docId: { $in: Array.from(tids) } }, { enroll: 1 }],
            }).toArray();
            for (const tsdoc of tsdocs) {
                tsdict[tsdoc.docId] = tsdoc;
                enrolledTids.add(tsdoc.docId);
            }
            for (const tid of tids) enrolledTids.delete(tid);
            if (enrolledTids.size) {
                tdict = await training.getList(domainId, Array.from(enrolledTids));
            }
        }
        for (const tdoc of tdocs) tdict[tdoc.docId.toHexString()] = tdoc;
        this.response.template = 'training_main.html';
        this.response.body = {
            tdocs, page, tpcount, tsdict, tdict,
        };
    }
}

class TrainingDetailHandler extends Handler {
    @param('tid', Types.ObjectID)
    @param('uid', Types.PositiveInt, true)
    async get(domainId: string, tid: ObjectID, uid: number) {
        const tdoc = await training.get(domainId, tid);
        await bus.parallel('training/get', tdoc, this);
        let targetUser = this.user._id;
        let enrollUsers: number[] = [];
        let shouldCompare = false;
        const pids = training.getPids(tdoc.dag);
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            enrollUsers = (await training.getMultiStatus(domainId, { docId: tid, uid: { $gt: 1 } })
                .project({ uid: 1 }).limit(500).toArray()).map((x) => +x.uid);
            if (uid) {
                targetUser = uid;
                shouldCompare = targetUser !== this.user._id;
            }
        }
        const canViewHidden = this.user.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN) || this.user._id;
        const [udoc, udict, pdict, psdict, selfPsdict] = await Promise.all([
            user.getById(domainId, tdoc.owner),
            user.getListForRender(domainId, enrollUsers),
            problem.getList(domainId, pids, canViewHidden, true),
            problem.getListStatus(domainId, targetUser, pids),
            shouldCompare ? problem.getListStatus(domainId, this.user._id, pids) : {},
        ]);
        const donePids = new Set<number>();
        const progPids = new Set<number>();
        for (const pid in psdict) {
            if (!+pid) continue;
            const psdoc = psdict[pid];
            if (psdoc.status) {
                if (psdoc.status === STATUS.STATUS_ACCEPTED) donePids.add(+pid);
                else progPids.add(+pid);
            }
        }
        const nsdict = {};
        const ndict = {};
        const doneNids = new Set<number>();
        for (const node of tdoc.dag) {
            ndict[node._id] = node;
            const totalCount = node.pids.length;
            const doneCount = Set.intersection(node.pids, donePids).size;
            const nsdoc = {
                progress: totalCount ? Math.floor(100 * (doneCount / totalCount)) : 100,
                isDone: training.isDone(node, doneNids, donePids),
                isProgress: training.isProgress(node, doneNids, donePids, progPids),
                isOpen: training.isOpen(node, doneNids, donePids, progPids),
                isInvalid: training.isInvalid(node, doneNids),
            };
            if (nsdoc.isDone) doneNids.add(node._id);
            nsdict[node._id] = nsdoc;
        }
        const tsdoc = await training.setStatus(domainId, tdoc.docId, this.user._id, {
            doneNids: Array.from(doneNids),
            donePids: Array.from(donePids),
            done: doneNids.size === tdoc.dag.length,
        });
        this.response.body = {
            tdoc, tsdoc, pids, pdict, psdict, ndict, nsdict, udoc, udict, selfPsdict,
        };
        this.response.body.tdoc.description = this.response.body.tdoc.description
            .replace(/\(file:\/\//g, `(./${tdoc.docId}/file/`)
            .replace(/="file:\/\//g, `="./${tdoc.docId}/file/`);
        this.response.pjax = 'partials/training_detail.html';
        this.response.template = 'training_detail.html';
    }

    @param('tid', Types.ObjectID)
    async postEnroll(domainId: string, tid: ObjectID) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const tdoc = await training.get(domainId, tid);
        await training.enroll(domainId, tdoc.docId, this.user._id);
        this.back();
    }

    @param('tid', Types.ObjectID)
    async postDelete(domainId: string, tid: ObjectID) {
        const tdoc = await training.get(domainId, tid);
        if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
        await training.del(domainId, tid);
        this.response.redirect = this.url('training_main');
    }
}

class TrainingEditHandler extends Handler {
    tdoc: TrainingDoc;

    @param('tid', Types.ObjectID, true)
    async prepare(domainId: string, tid: ObjectID) {
        if (tid) {
            this.tdoc = await training.get(domainId, tid);
            if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
            else this.checkPerm(PERM.PERM_EDIT_TRAINING_SELF);
        } else this.checkPerm(PERM.PERM_CREATE_TRAINING);
    }

    async get() {
        this.response.template = 'training_edit.html';
        this.response.body = { page_name: this.tdoc ? 'training_edit' : 'training_create' };
        if (this.tdoc) {
            this.response.body.tdoc = this.tdoc;
            this.response.body.dag = JSON.stringify(this.tdoc.dag, null, 2);
        }
    }

    @param('tid', Types.ObjectID, true)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('dag', Types.Content)
    @param('pin', Types.Boolean)
    @param('description', Types.Content)
    async post(
        domainId: string, tid: ObjectID,
        title: string, content: string,
        _dag: string, pin = false, description: string,
    ) {
        if ((!!this.tdoc?.pin) !== pin) this.checkPerm(PERM.PERM_PIN_TRAINING);
        const dag = await _parseDagJson(domainId, _dag);
        const pids = training.getPids(dag);
        assert(pids.length, new ValidationError('dag', null, 'Please specify at least one problem'));
        if (!tid) {
            tid = await training.add(domainId, title, content, this.user._id, dag, description);
            if (pin) await training.edit(domainId, tid, { pin });
        } else {
            await training.edit(domainId, tid, {
                title, content, dag, description, pin,
            });
        }
        this.response.body = { tid };
        this.response.redirect = this.url('training_detail', { tid });
    }
}

export class TrainingFilesHandler extends Handler {
    tdoc: TrainingDoc;

    @param('tid', Types.ObjectID)
    async prepare(domainId: string, tid: ObjectID) {
        this.tdoc = await training.get(domainId, tid);
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
        else this.checkPerm(PERM.PERM_EDIT_TRAINING_SELF);
    }

    @param('tid', Types.ObjectID)
    async get(domainId: string, tid: ObjectID) {
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: await training.getStatus(domainId, this.tdoc.docId, this.user._id),
            udoc: await user.getById(domainId, this.tdoc.owner),
            files: sortFiles(this.tdoc.files || []),
            urlForFile: (filename: string) => this.url('training_file_download', { tid, filename }),
        };
        this.response.pjax = 'partials/files.html';
        this.response.template = 'training_files.html';
    }

    @param('tid', Types.ObjectID)
    @post('filename', Types.Name, true)
    async postUploadFile(domainId: string, tid: ObjectID, filename: string) {
        if ((this.tdoc.files?.length || 0) >= system.get('limit.contest_files')) {
            throw new FileLimitExceededError('count');
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        const f = statSync(file.filepath);
        const size = Math.sum((this.tdoc.files || []).map((i) => i.size)) + f.size;
        if (size >= system.get('limit.contest_files_size')) {
            throw new FileLimitExceededError('size');
        }
        if (!filename) filename = file.originalFilename || String.random(16);
        if (filename.includes('/') || filename.includes('..')) throw new ValidationError('filename', null, 'Bad filename');
        await storage.put(`training/${domainId}/${tid}/${filename}`, file.filepath, this.user._id);
        const meta = await storage.getMeta(`training/${domainId}/${tid}/${filename}`);
        const payload = { _id: filename, name: filename, ...pick(meta, ['size', 'lastModified', 'etag']) };
        if (!meta) throw new FileUploadError();
        await training.edit(domainId, tid, { files: [...(this.tdoc.files || []), payload] });
        this.back();
    }

    @param('tid', Types.ObjectID)
    @post('files', Types.Array)
    async postDeleteFiles(domainId: string, tid: ObjectID, files: string[]) {
        await Promise.all([
            storage.del(files.map((t) => `contest/${domainId}/${tid}/${t}`), this.user._id),
            training.edit(domainId, tid, { files: this.tdoc.files.filter((i) => !files.includes(i.name)) }),
        ]);
        this.back();
    }
}
export class TrainingFileDownloadHandler extends Handler {
    @param('tid', Types.ObjectID)
    @param('filename', Types.Name)
    @param('noDisposition', Types.Boolean)
    async get(domainId: string, tid: ObjectID, filename: string, noDisposition = false) {
        this.response.addHeader('Cache-Control', 'public');
        const target = `training/${domainId}/${tid}/${filename}`;
        const file = await storage.getMeta(target);
        await oplog.log(this, 'download.file.training', {
            target,
            size: file?.size || 0,
        });
        this.response.redirect = await storage.signDownloadLink(
            target, noDisposition ? undefined : filename, false, 'user',
        );
    }
}

export async function apply(ctx) {
    ctx.Route('training_main', '/training', TrainingMainHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('training_create', '/training/create', TrainingEditHandler);
    ctx.Route('training_detail', '/training/:tid', TrainingDetailHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('training_edit', '/training/:tid/edit', TrainingEditHandler);
    ctx.Route('training_files', '/training/:tid/file', TrainingFilesHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('training_file_download', '/training/:tid/file/:filename', TrainingFileDownloadHandler, PERM.PERM_VIEW_TRAINING);
}
