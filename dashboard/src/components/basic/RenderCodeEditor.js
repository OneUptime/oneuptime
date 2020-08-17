import React from 'react';
import PropTypes from 'prop-types';
import AceEditor from 'react-ace';
import 'brace/mode/markdown';
import 'brace/mode/html';
import 'brace/theme/github';

const RenderCodeEditor = ({
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
}) => (
    <AceEditor
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
        onChange={input.onChange}
        style={style}
        placeholder={placeholder}
        height={height}
        width={width}
    />
);

RenderCodeEditor.displayName = 'RenderCodeEditor';
RenderCodeEditor.propTypes = {
    input: PropTypes.object.isRequired,
    style: PropTypes.object,
    mode: PropTypes.string.isRequired,
    placeholder: PropTypes.string,
    height: PropTypes.string.isRequired,
    width: PropTypes.string.isRequired,
};

export default RenderCodeEditor;
