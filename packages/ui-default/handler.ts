/* eslint-disable no-return-await */
/* eslint-disable camelcase */
import crypto from 'crypto';
import esbuild from 'esbuild';
import { PERM, PRIV } from 'hydrooj/src/model/builtin';
import * as contest from 'hydrooj/src/model/contest';
import problem from 'hydrooj/src/model/problem';
import * as setting from 'hydrooj/src/model/setting';
import * as system from 'hydrooj/src/model/system';
import user from 'hydrooj/src/model/user';
import * as bus from 'hydrooj/src/service/bus';
import { UiContextBase } from 'hydrooj/src/service/layers/base';
import { Handler, Route } from 'hydrooj/src/service/server';
import { SystemSettings } from 'hydrooj/src/settings';
import { ObjectID } from 'mongodb';
import { tmpdir } from 'os';
import { join } from 'path';
import Schema from 'schemastery';
import convert from 'schemastery-jsonschema';
import markdown from './backendlib/markdown';

declare module 'hydrooj/src/interface' {
  interface UI {
    esbuildPlugins?: esbuild.Plugin[]
  }
  interface SystemKeys {
    'ui-default.nav_logo_dark': string;
    'ui-default.nav_logo_dark_2x': string;
  }
}
declare module 'hydrooj/src/service/layers/base' {
  interface UiContextBase {
    nav_logo_dark: string;
    nav_logo_dark_2x: string;
    constantVersion: string;
  }
}

let constant = '';
let hash = '';

async function buildUI() {
  const pageFiles = Object.keys(global.Hydro.ui.manifest).filter((i) => /\.page\.[jt]sx?$/.test(i));
  const build = await esbuild.build({
    format: 'iife',
    entryPoints: pageFiles.map((i) => join(global.Hydro.ui.manifest[i], i)),
    bundle: true,
    outdir: tmpdir(),
    splitting: false,
    write: false,
    target: [
      'chrome60',
    ],
    plugins: global.Hydro.ui.esbuildPlugins || [],
    minify: !process.env.DEV,
  });
  if (build.errors.length) console.error(build.errors);
  if (build.warnings.length) console.warn(build.warnings);
  const pages = build.outputFiles.map((i) => i.text);
  const payload = [`window.LANGS=${JSON.stringify(setting.langs)};`, ...pages];

  const c = crypto.createHash('sha1');
  c.update(JSON.stringify(payload));
  const version = c.digest('hex');
  constant = JSON.stringify(payload);
  UiContextBase.constantVersion = hash = version;
}
function updateLogo() {
  [UiContextBase.nav_logo_dark, UiContextBase.nav_logo_dark_2x] = system.getMany([
    'ui-default.nav_logo_dark', 'ui-default.nav_logo_dark_2x',
  ]);
}
bus.on('app/started', buildUI);
bus.on('app/started', updateLogo);
bus.on('system/setting', updateLogo);

class WikiHelpHandler extends Handler {
  noCheckPermView = true;

  async get({ domainId }) {
    const LANGS = setting.langs;
    const languages = {};
    for (const key in LANGS) {
      if (LANGS[key].domain && !LANGS[key].domain.includes(domainId)) continue;
      if (LANGS[key].hidden) continue;
      languages[`${LANGS[key].display}(${key})`] = LANGS[key].compile || LANGS[key].execute;
    }
    this.response.body = { languages };
    this.response.template = 'wiki_help.html';
  }
}

class WikiAboutHandler extends Handler {
  noCheckPermView = true;

  async get() {
    let raw = system.get('ui-default.about') || '';
    // TODO template engine
    raw = raw.replace(/{{ name }}/g, this.domain.ui?.name || system.get('server.name')).trim();
    const lines = raw.split('\n');
    const sections = [];
    for (const line of lines) {
      if (line.startsWith('# ')) {
        const id = line.split(' ')[1];
        sections.push({
          id,
          title: line.split(id)[1].trim(),
          content: '',
        });
      } else sections[sections.length - 1].content += `${line}\n`;
    }
    this.response.template = 'about.html';
    this.response.body = { sections };
  }
}

class SetThemeHandler extends Handler {
  noCheckPermView = true;

  async get({ theme }) {
    this.checkPriv(PRIV.PRIV_USER_PROFILE);
    await user.setById(this.user._id, { theme });
    this.back();
  }
}

class MarkdownHandler extends Handler {
  noCheckPermView = true;

  async post({ text, html = false, inline = false }) {
    this.response.body = inline
      ? markdown.renderInline(text, html)
      : markdown.render(text, html);
    this.response.type = 'text/html';
    this.response.status = 200;
  }
}

class ResourceHandler extends Handler {
  noCheckPermView = true;

  async prepare() {
    this.response.addHeader('Cache-Control', 'public, max-age=86400');
  }
}

class UiConstantsHandler extends ResourceHandler {
  async all() {
    this.response.addHeader('ETag', hash);
    this.response.body = constant;
    this.response.type = 'application/json';
  }
}

class LanguageHandler extends ResourceHandler {
  async all({ lang }) {
    if (!global.Hydro.locales[lang]) lang = system.get('server.language');
    this.response.body = `window.LOCALES=${JSON.stringify(global.Hydro.locales[lang])};`;
    this.response.type = 'application/javascript';
  }
}

class SystemConfigSchemaHandler extends Handler {
  async get() {
    const schema = convert(Schema.intersect(SystemSettings) as any, true);
    this.response.body = schema;
  }
}

class RichMediaHandler extends Handler {
  async renderUser(domainId, payload) {
    let d = payload.domainId || domainId;
    const cur = payload.domainId ? await user.getById(payload.domainId, this.user._id) : this.user;
    if (!cur.hasPerm(PERM.PERM_VIEW)) d = domainId;
    const udoc = Number.isNaN(+payload.id) ? await user.getByUname(d, payload.id) : await user.getById(d, +payload.id);
    return await this.renderHTML('partials/user.html', { udoc });
  }

  async renderProblem(domainId, payload) {
    const cur = payload.domainId ? await user.getById(payload.domainId, this.user._id) : this.user;
    let pdoc = cur.hasPerm(PERM.PERM_VIEW | PERM.PERM_VIEW_PROBLEM)
      ? await problem.get(payload.domainId || domainId, payload.id) || problem.default
      : problem.default;
    if (pdoc.hidden && !cur.own(pdoc) && !cur.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN)) pdoc = problem.default;
    return await this.renderHTML('partials/problem.html', { pdoc });
  }

  async renderContest(domainId, payload) {
    const cur = payload.domainId ? await user.getById(payload.domainId, this.user._id) : this.user;
    const tdoc = cur.hasPerm(PERM.PERM_VIEW | PERM.PERM_VIEW_CONTEST)
      ? await contest.get(payload.domainId || domainId, new ObjectID(payload.id))
      : null;
    if (tdoc) return await this.renderHTML('partials/contest.html', { tdoc });
    return '';
  }

  async renderHomework(domainId, payload) {
    const cur = payload.domainId ? await user.getById(payload.domainId, this.user._id) : this.user;
    const tdoc = cur.hasPerm(PERM.PERM_VIEW | PERM.PERM_VIEW_HOMEWORK)
      ? await contest.get(payload.domainId || domainId, new ObjectID(payload.id))
      : null;
    if (tdoc) return await this.renderHTML('partials/homework.html', { tdoc });
    return '';
  }

  async post({ domainId, items }) {
    const res = [];
    for (const item of items) {
      if (item.domainId && item.domainId === domainId) delete item.domainId;
      if (item.type === 'user') res.push(this.renderUser(domainId, item).catch(() => ''));
      else if (item.type === 'problem') res.push(this.renderProblem(domainId, item).catch(() => ''));
      else if (item.type === 'contest') res.push(this.renderContest(domainId, item).catch(() => ''));
      else if (item.type === 'homework') res.push(this.renderHomework(domainId, item).catch(() => ''));
      else res.push('');
    }
    this.response.body = await Promise.all(res);
  }
}

global.Hydro.handler.ui = async () => {
  Route('wiki_help', '/wiki/help', WikiHelpHandler);
  Route('wiki_about', '/wiki/about', WikiAboutHandler);
  Route('set_theme', '/set_theme/:theme', SetThemeHandler);
  Route('constant', '/constant/:version', UiConstantsHandler);
  Route('markdown', '/markdown', MarkdownHandler);
  Route('config_schema', '/manage/config/schema.json', SystemConfigSchemaHandler, PRIV.PRIV_EDIT_SYSTEM);
  Route('lang', '/l/:lang', LanguageHandler);
  Route('media', '/media', RichMediaHandler);
};
