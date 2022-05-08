import React from 'react';
import type { editor } from 'monaco-editor';
import { connect } from 'react-redux';
import { load } from 'vj/components/monaco/loader';
import Editor from 'vj/components/editor';
import yaml from 'js-yaml';

const mapStateToProps = (state) => ({
  config: state.config,
});
const mapDispatchToProps = (dispatch) => ({
  handleUpdateCode: (code) => {
    dispatch({
      type: 'CONFIG_CODE_UPDATE',
      payload: code,
    });
  },
});

interface Props {
  config: object;
  handleUpdateCode: Function;
}

export default connect(mapStateToProps, mapDispatchToProps)(class MonacoEditor extends React.PureComponent<Props> {
  disposable = [];
  containerElement: HTMLElement;
  private __preventUpdate = false;

  editor: editor.IStandaloneCodeEditor;
  model: editor.ITextModel;
  vjEditor: Editor;

  async componentDidMount() {
    const { monaco } = await load(['yaml']);
    const uri = monaco.Uri.parse('hydro://problem/file/config.yaml');
    this.model = monaco.editor.createModel(yaml.dump(this.props.config), 'yaml', uri);
    this.vjEditor = Editor.getOrConstruct($(this.containerElement), {
      language: 'yaml',
      model: this.model,
      onChange: (value: string) => {
        this.__preventUpdate = true;
        this.props.handleUpdateCode(value);
        this.__preventUpdate = false;
      },
    }) as Editor;
    this.editor = this.vjEditor.editor;
  }

  componentDidUpdate(prevProps) {
    if (this.__preventUpdate) return;
    if (yaml.dump(prevProps.config) !== yaml.dump(this.props.config)) {
      this.model?.pushEditOperations(
        [],
        [{
          range: this.model.getFullModelRange(),
          text: yaml.dump(this.props.config),
        }],
        undefined,
      );
    }
  }

  componentWillUnmount() {
    if (this.vjEditor) this.vjEditor.destory();
    if (this.model) this.model.dispose();
    if (this.editor) this.editor.dispose();
    this.disposable.map((i) => i.dispose());
  }

  assignRef = (component) => {
    this.containerElement = component;
  };

  render() {
    return (
      <div
        ref={this.assignRef}
        style={{
          minHeight: '500px',
          height: '100%',
          width: '100%',
        }}
        className="ConfigMonacoEditor"
      >
      </div>
    );
  }
});
