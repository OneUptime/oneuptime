import React, { useState } from 'react';
// import ShouldRender from '../basic/ShouldRender';
import AceEditor from 'react-ace';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import PropTypes from 'prop-types';

const NewScriptEditor = props => {
    // const [script, setScript] = useState('');
    const [filterOption, setFilterOption] = useState('javascript');

    const scriptTextChange = newValue => {
        // setScript(newValue);
        props.setAutomatedScript(newValue);
    };

    return (
        <div>
            <div className="bs-Fieldset-rows">
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">Script Type</label>
                    <div className="bs-Fieldset-fields">
                        <Dropdown>
                            <Dropdown.Toggle
                                id="filterToggle"
                                title={filterOption}
                                className="bs-Button bs-DeprecatedButton"
                                style={{ textTransform: 'capitalize' }}
                            />
                            <Dropdown.Menu>
                                <MenuItem
                                    title="javascript"
                                    onClick={() => {
                                        setFilterOption('javascript');
                                    }}
                                >
                                    JavaScript
                                </MenuItem>
                                <MenuItem
                                    title="bash"
                                    onClick={() => {
                                        setFilterOption('bash');
                                    }}
                                >
                                    Bash
                                </MenuItem>
                            </Dropdown.Menu>
                        </Dropdown>
                    </div>
                </div>
            </div>
            <div className="bs-Fieldset-rows">
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">Script</label>
                    <div className="bs-Fieldset-fields">
                        <AceEditor
                            placeholder="Enter script here"
                            mode={filterOption}
                            theme="github"
                            value={props.value}
                            style={{
                                backgroundColor: '#fff',
                                marginTop: '10px',
                                marginLeft: '-4px',
                                borderRadius: '4px',
                                boxShadow:
                                    '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
                            }}
                            name={`automated-script`}
                            id="automatedScript"
                            editorProps={{
                                $blockScrolling: true,
                            }}
                            setOptions={{
                                enableBasicAutocompletion: true,
                                enableLiveAutocompletion: true,
                                enableSnippets: true,
                                showGutter: false,
                            }}
                            height="150px"
                            highlightActiveLine={true}
                            onChange={scriptTextChange}
                            fontSize="14px"
                        />
                    </div>
                </div>
            </div>
            {/* <ShouldRender if={true}>
                <div className="bs-Fieldset-fields">
                    <span>
                        <span>
                            <AceEditor
                                placeholder="Enter script here"
                                mode={filterOption}
                                theme="github"
                                value={props.value}
                                style={{
                                    backgroundColor: '#fff',
                                    marginTop: '10px',
                                    marginLeft: '-4px',
                                    borderRadius: '4px',
                                    boxShadow:
                                        '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
                                }}
                                name={`automated-script`}
                                id="automatedScript"
                                editorProps={{
                                    $blockScrolling: true,
                                }}
                                setOptions={{
                                    enableBasicAutocompletion: true,
                                    enableLiveAutocompletion: true,
                                    enableSnippets: true,
                                    showGutter: false,
                                }}
                                height="150px"
                                highlightActiveLine={true}
                                onChange={scriptTextChange}
                                fontSize="14px"
                            />
                        </span>
                    </span>
                </div>
            </ShouldRender> */}
        </div>
    );
};

NewScriptEditor.propTypes = {
    setAutomatedScript: PropTypes.func.isRequired,
    value: PropTypes.string.isRequired,
};

export default NewScriptEditor;
