import React, { Component } from 'react';
// import Editor from 'react-simple-code-editor';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'pris... Remove this comment to see the full error message
import Prism from 'prismjs';
import 'prismjs/components/prism-markdown';
import 'prismjs/themes/prism.css';
import PropTypes from 'prop-types';

class CodeEditor extends Component {
    render() {
        return (<></>
            // <Editor
            //     {...this.props}
            //     // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            //     value={this.props.code}
            //     // @ts-expect-error ts-migrate(2339) FIXME: Property 'onCodeChange' does not exist on type 'Re... Remove this comment to see the full error message
            //     onValueChange={this.props.onCodeChange}
            //     highlight={() =>
            //         // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
            //         // @ts-expect-error ts-migrate(2339) FIXME: Property 'style' does not exist on type 'Readonly<... Remove this comment to see the full error message
            //         ...this.props.style,
            //     }}
            // />
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CodeEditor.displayName = 'CodeEditor';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CodeEditor.propTypes = {
    code: PropTypes.string,
    onCodeChange: PropTypes.func,
    style: PropTypes.object,
};
export default CodeEditor;
