import React from 'react';
import PropTypes from 'prop-types'
import ShouldRender from '../basic/ShouldRender';
import { Field } from 'redux-form';

const AdminNote = ({ fields, meta: { error, submitFailed } }) => {

    return (
        <ul>
            {
                fields.map((val, i) => {
                    return (
                        <li key={i}>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label">Admin Note</label>
                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                        <Field
                                            id={`txtAdminNote${i}`}
                                            rows="5" 
                                            cols="100"
                                            className="bs-TextArea"
                                            type="text"
                                            name={`${val}.note`}
                                            component="textarea"
                                        />
                                    </div>
                                </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"></label>
                                    <div className="bs-Fieldset-fields">
                                        <div className="Box-root Flex-flex Flex-alignItems--center">
                                            <button
                                                id={`btnRemoveAdminNote${i}`}
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
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <div>

                                    <button
                                        id="btnAddAdminNotes"
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() => fields.push({note: ''})}
                                    >
                                        Add Notes
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>

                            </div>
                        </div>
                        <p className="bs-Fieldset-explanation">
                            <span>
                                You can add any number of notes.
                            </span>
                        </p>
                    </div>
                </div>
            </li>
        </ul>
    )
}

AdminNote.displayName = 'AdminNote'

AdminNote.propTypes = {
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
}

export {AdminNote}