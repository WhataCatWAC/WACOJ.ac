import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import _ from 'lodash';
import moment from 'moment-timezone';
import Schema from 'schemastery';
import superagent from 'superagent';
import { Context } from './context';
import db from './service/db';
export { ObjectID, ObjectId, FilterQuery } from 'mongodb';
export * from './utils';
export * from './interface';
export * from './pipelineUtils';
export * from './error';
export * from './settings';
export * from './typeutils';
export * as SystemModel from './model/system';
export * as TrainingModel from './model/training';
export * as OpcountModel from './model/opcount';
export * as OplogModel from './model/oplog';
export * as BlogModel from './model/blog';
export * as SettingModel from './model/setting';
export * as DiscussionModel from './model/discussion';
export * as DocumentModel from './model/document';
export * as BuiltinModel from './model/builtin';
export * as ContestModel from './model/contest';
export { default as TokenModel } from './model/token';
export { default as UserModel } from './model/user';
export { default as ProblemModel } from './model/problem';
export { default as RecordModel } from './model/record';
export { default as SolutionModel } from './model/solution';
export { default as MessageModel } from './model/message';
export { default as OauthModel } from './model/oauth';
export { default as BlackListModel } from './model/blacklist';
export { default as DomainModel } from './model/domain';
export { default as StorageModel } from './model/storage';
export { default as TaskModel } from './model/task';
export * from './model/builtin';
export * as JudgeHandler from './handler/judge';
export { postJudge } from './handler/judge';
export { Collections } from './service/db';
// export { Collections } from './interface';
export { Service, Context } from './context';
export { buildContent } from './lib/content';
export * as validator from './lib/validator';
export { default as rank } from './lib/rank';
export { default as paginate } from './lib/paginate';
export * from './service/decorators';
export {
    Handler, ConnectionHandler, captureAllRoutes,
    httpServer, wsServer, router,
} from './service/server';
export { UiContextBase } from './service/layers/base';
export * as StorageService from './service/storage';
export { EventMap } from './service/bus';
export {
    db, Schema, yaml, fs, AdmZip, superagent, _, moment,
};
export const definePlugin = <T = never>(args: {
    using?: keyof Context[];
    apply: (ctx: Context, config: T) => Promise<void> | void;
    schema?: Schema<T>;
    name?: string;
}) => args;
