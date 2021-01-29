import React from 'react';
import PropTypes from 'prop-types';
import AceEditor from 'react-ace';
import 'ace-builds/src-noconflict/mode-markdown';
import 'ace-builds/src-noconflict/mode-html';
import 'ace-builds/src-noconflict/mode-css';
import 'ace-builds/src-noconflict/theme-github';

const RenderCodeEditor = ({
    id,
    input,
    mode,
    placeholder,
    readOnly,
    style = {
        backgroundColor: '#fff',
        borderRadius: '4px',
        boxShadow:
            '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
    },
    wrapEnabled = false,
    height,
    width,
    onLoad = () => {},
    onBlur = () => {},
}) => (
    <AceEditor
        id={id}
        name={id}
        mode={mode}
        theme="github"
        value={input.value}
        editorProps={{
            $blockScrolling: true,
        }}
        highlightActiveLine={false}
        setOptions={{
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            showGutter: false,
        }}
        readOnly={readOnly || false}
        wrapEnabled={wrapEnabled}
        onLoad={() => onLoad(input)}
        onBlur={() => onBlur(input)}
        onChange={input.onChange}
        style={style}
        placeholder={placeholder}
        height={height}
        width={width}
        fontSize="14px"
    />
);

RenderCodeEditor.displayName = 'RenderCodeEditor';
RenderCodeEditor.propTypes = {
    id: PropTypes.string,
    input: PropTypes.object.isRequired,
    style: PropTypes.object,
    mode: PropTypes.string.isRequired,
    placeholder: PropTypes.string,
    height: PropTypes.string.isRequired,
    width: PropTypes.string.isRequired,
    onLoad: PropTypes.func,
    onBlur: PropTypes.func,
    wrapEnabled: PropTypes.bool,
    readOnly: PropTypes.bool,
};

export default RenderCodeEditor;
