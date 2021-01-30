import React, { Component } from 'react';
import AceEditor from 'react-ace';
import 'ace-builds/src-noconflict/mode-markdown';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/mode-java';
import 'ace-builds/src-noconflict/mode-xml';
import 'ace-builds/src-noconflict/theme-monokai';
import PropTypes from 'prop-types';

class AceCodeEditor extends Component {
    render() {
        const { value, mode, name, height } = this.props;
        return (
            <AceEditor
                name={name}
                mode={mode}
                theme="monokai"
                value={value}
                readOnly={true}
                width={'100%'}
                height={height}
                setOptions={{
                    showLineNumbers: false,
                }}
                fontSize="14px"
            />
        );
    }
}

AceCodeEditor.displayName = 'AceCodeEditor';
AceCodeEditor.propTypes = {
    value: PropTypes.string,
    mode: PropTypes.string,
    name: PropTypes.string,
    height: PropTypes.string,
};
export default AceCodeEditor;
