import React, { useState } from 'react';
import ShouldRender from '../basic/ShouldRender';
import AceEditor from 'react-ace';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';

const NewScriptEditor = () => {
    const [script, setScript] = useState('');
    const [filterOption, setFilterOption] = useState('javascript');

    const scriptTextChange = newValue => {
        setScript(newValue);
    };

    return (
        <div>
            <ShouldRender if={true}>
                <Dropdown>
                    <Dropdown.Toggle
                        id="filterToggle"
                        title={filterOption}
                        className="bs-Button bs-DeprecatedButton"
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

                <div className="bs-Fieldset-fields">
                    <span>
                        <span>
                            <AceEditor
                                placeholder="Enter script here"
                                mode={filterOption}
                                theme="github"
                                value={script}
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
            </ShouldRender>
        </div>
    );
};

export default NewScriptEditor;
