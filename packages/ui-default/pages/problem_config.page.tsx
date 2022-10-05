import { normalizeSubtasks, readSubtasksFromFiles, size } from '@hydrooj/utils/lib/common';
import type { SubtaskType } from 'hydrooj/src/interface';
import $ from 'jquery';
import yaml from 'js-yaml';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmDialog } from 'vj/components/dialog/index';
import Notification from 'vj/components/notification';
import { configYamlFormat } from 'vj/components/problemconfig/ProblemConfigEditor';
import uploadFiles from 'vj/components/upload';
import download from 'vj/components/zipDownloader';
import { NamedPage } from 'vj/misc/Page';
import i18n from 'vj/utils/i18n';
import loadReactRedux from 'vj/utils/loadReactRedux';
import request from 'vj/utils/request';
import tpl from 'vj/utils/tpl';

const page = new NamedPage('problem_config', () => {
  let reduxStore;

  async function handleClickUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.click();
    await new Promise((resolve) => { input.onchange = resolve; });
    await uploadFiles('./files', input.files, {
      type: 'testdata',
      singleFileUploadCallback: (file) => {
        reduxStore.dispatch({
          type: 'CONFIG_ADD_TESTDATA',
          value: {
            _id: file.name,
            name: file.name,
            size: file.size,
          },
        });
        $('.testdata-table tbody').append(
          $(tpl`<tr data-filename="${file.name}" data-size="${file.size.toString()}">
            <td class="col--name" title="${file.name}"><a href="./file/${file.name}?type=testdata">${file.name}</a></td>
            <td class="col--size">${size(file.size)}</td>
            <td class="col--operation"><a href="javascript:;" name="testdata__delete"><span class="icon icon-delete"></span></a></td>
          </tr>`),
        );
      },
    });
  }

  async function handleClickRemove(ev: JQuery.ClickEvent<Document, undefined, any, any>) {
    const file = [$(ev.currentTarget).parent().parent().attr('data-filename')];
    const action = await new ConfirmDialog({
      $body: tpl.typoMsg(i18n('Confirm to delete the file?')),
    }).open();
    if (action !== 'yes') return;
    try {
      await request.post('./files', {
        operation: 'delete_files',
        files: file,
        type: 'testdata',
      });
      Notification.success(i18n('File have been deleted.'));
      reduxStore.dispatch({
        type: 'CONFIG_DELETE_TESTDATA',
        value: file,
      });
      $(ev.currentTarget).parent().parent().remove();
    } catch (error) {
      Notification.error(error.message);
    }
  }

  async function handleClickDownloadAll() {
    const files = reduxStore.getState().testdata.map((i) => i.name);
    const { links, pdoc } = await request.post('./files', { operation: 'get_links', files, type: 'testdata' });
    const targets = [];
    for (const filename of Object.keys(links)) targets.push({ filename, url: links[filename] });
    await download(`${pdoc.docId} ${pdoc.title}.zip`, targets);
  }

  async function uploadConfig(config: object) {
    const configYaml = yaml.dump(configYamlFormat(config));
    Notification.info(i18n('Saving file...'));
    const data = new FormData();
    data.append('filename', 'config.yaml');
    data.append('file', new Blob([configYaml], { type: 'text/plain' }));
    data.append('type', 'testdata');
    data.append('operation', 'upload_file');
    await request.postFile('./files', data);
    Notification.success(i18n('File saved.'));
    window.location.reload();
  }

  async function mountComponent() {
    const [{ default: ProblemConfigEditor }, { default: ProblemConfigForm }, { default: ProblemConfigReducer }] = await Promise.all([
      import('vj/components/problemconfig/ProblemConfigEditor'),
      import('vj/components/problemconfig/ProblemConfigForm'),
      import('vj/components/problemconfig/reducer'),
    ]);

    const { Provider, store } = await loadReactRedux(ProblemConfigReducer);

    reduxStore = store;

    store.dispatch({
      type: 'CONFIG_LOAD',
      payload: request.get(),
    });
    const unsubscribe = store.subscribe(() => {
      // TODO set yaml schema
      const state = store.getState();
      if (!state.config.__loaded) return;
      if (state.config.cases) {
        const score = state.config.score * state.config.cases.length;
        state.config.subtasks = [{ type: 'sum' as SubtaskType, score: score && score < 100 ? score : 100, cases: state.config.cases }];
        delete state.config.cases;
        delete state.config.score;
      }
      if (state.config.subtasks) return;
      const testdata = (state.testdata || []).map((i) => i.name);
      unsubscribe();
      const subtasks = readSubtasksFromFiles(testdata, state.config);
      store.dispatch({
        type: 'CONFIG_AUTOCASES_UPDATE',
        subtasks: normalizeSubtasks(subtasks, (i) => i, state.config.time, state.config.memory, true),
      });
    });
    createRoot($('#ProblemConfig').get(0)).render(
      <Provider store={store}>
        <div className="row">
          <div className="medium-5 columns">
            <ProblemConfigEditor />
          </div>
          <div className="medium-7 columns">
            <ProblemConfigForm />
          </div>
        </div>
        <button className="rounded primary button" onClick={() => uploadConfig(store.getState().config)}>{i18n('Submit')}</button>
      </Provider>,
    );
  }

  mountComponent();

  $(document).on('click', '[name="testdata__upload"]', () => handleClickUpload());
  $(document).on('click', '[name="testdata__delete"]', (ev) => handleClickRemove(ev));
  $(document).on('click', '[name="testdata__download__all"]', () => handleClickDownloadAll());
});

export default page;
