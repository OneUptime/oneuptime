import React, { Component } from 'react';
import AceEditor from 'react-ace';
import 'ace-builds/src-noconflict/mode-markdown';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/mode-java';
import 'ace-builds/src-noconflict/mode-xml';
import 'ace-builds/src-noconflict/theme-monokai';
import 'ace-builds/src-noconflict/theme-github';
import PropTypes from 'prop-types';

export interface ComponentProps {
    value?: string;
    mode?: string;
    name?: string;
    height?: string;
    markers?: object;
    theme?: string;
}

class AceCodeEditor extends Component<ComponentProps> {
    override render() {

        const { value, mode, name, height, markers, theme } = this.props;
        return (
            <AceEditor
                name={name}
                mode={mode}
                theme={`${theme ? theme : 'monokai'}`}
                value={value}
                readOnly={true}
                width={'100%'}
                height={height}
                setOptions={{
                    showLineNumbers: false,
                }}
                fontSize="14px"
                markers={markers}
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
    markers: PropTypes.object,
    theme: PropTypes.string,
};
export default AceCodeEditor;
