import React from 'react';
import PropTypes from 'prop-types'
import { Field } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import {RenderField} from './RenderField';

const RenderLinks = ({ fields, meta: { error, submitFailed } }) => {
    return (
        <ul>
            {
                fields.map((link, i) => {
                    return (
                        <li key={i}>
                            <div className="bs-Fieldset-row">
                                <label className="bs-Fieldset-label">Link {i + 1} Name</label>
                                <div className="bs-Fieldset-fields">
                                    <Field
                                        id={`name_${i}`}
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        type="text"
                                        name={`${link}.name`}
                                        component={RenderField}
                                        placeholder="Home"
                                    />
                                </div>
                            </div>
                            <div className="bs-Fieldset-row">
                                <label className="bs-Fieldset-label">Link {i + 1} URL</label>
                                <div className="bs-Fieldset-fields">
                                    <Field
                                        id={`url_${i}`}
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        type="text"
                                        name={`${link}.url`}
                                        component={RenderField}
                                        placeholder="https://mycompany.com"
                                    />
                                </div>
                            </div>
                            <div className="bs-Fieldset-row">
                                <label className="bs-Fieldset-label"></label>
                                <div className="bs-Fieldset-fields">
                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                        <button
                                            className="bs-Button bs-DeprecatedButton"
                                            type="button"
                                            onClick={() => fields.remove(i)}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </li>
                    )
                })
            }

            <li>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center"></div>
                    </div>
                </div>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <div>
                                <ShouldRender if={fields.length < 5}>
                                    <button
                                        id="btnAddLink"
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() => fields.push({name: '', url: ''})}
                                    >
                                        Add Link
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                        <p className="bs-Fieldset-explanation">
                            <span>
                                You can add as many as five links that will show up on your status page.
                            </span>
                        </p>
                    </div>
                </div>
            </li>
        </ul>
    )
}

RenderLinks.displayName = 'RenderLinks'

RenderLinks.propTypes = {
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired
}

export {RenderLinks}