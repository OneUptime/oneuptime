import React, { Component } from 'react';
// import Editor from 'react-simple-code-editor';

import Prism from 'prismjs';
import 'prismjs/components/prism-markdown';
import 'prismjs/themes/prism.css';
import PropTypes from 'prop-types';

interface CodeEditorProps {
    code?: string;
    onCodeChange?: Function;
    style?: object;
}

class CodeEditor extends Component<CodeEditorProps> {
    override render() {
        return (<></>
            // <Editor
            //     {...this.props}
            //     
            //     value={this.props.code}
            //     
            //     onValueChange={this.props.onCodeChange}
            //     highlight={() =>
            //         
            //         Prism.highlight(this.props.code, Prism.languages.markdown)
            //     }
            //     padding={10}
            //     style={{
            //         fontFamily: '"Fira code", "Fira Mono", monospace',
            //         fontSize: 12,
            //         width: '300px',
            //         backgroundColor: 'white',
            //         border: 'solid 1px #cccccc',
            //         borderRadius: '4px',
            //         height: '100px',
            //         overflow: 'auto',
            //         
            //         ...this.props.style,
            //     }}
            // />
        );
    }
}


CodeEditor.displayName = 'CodeEditor';

CodeEditor.propTypes = {
    code: PropTypes.string,
    onCodeChange: PropTypes.func,
    style: PropTypes.object,
};
export default CodeEditor;
