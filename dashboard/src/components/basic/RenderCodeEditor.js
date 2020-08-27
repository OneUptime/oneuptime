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
    style = {
        backgroundColor: '#fff',
        borderRadius: '4px',
        boxShadow:
            '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
    },
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
        highlightActiveLine={true}
        setOptions={{
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            showGutter: false,
        }}
        onLoad={() => onLoad(input)}
        onBlur={() => onBlur(input)}
        onChange={input.onChange}
        style={style}
        placeholder={placeholder}
        height={height}
        width={width}
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
};

export default RenderCodeEditor;
