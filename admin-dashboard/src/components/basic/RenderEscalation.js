import React from 'react';
import PropTypes from 'prop-types'
import { FieldArray } from 'redux-form';
import { Field } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { RenderNames } from './RenderNames';
import { RenderField } from './RenderField';


const RenderEscalation = ({ fields, meta: { error, submitFailed }, subProjectId }) => {
 
    return (
        <ul>
            {
                fields.map((policy, i) => {
                    return (
                        <li key={i} style={{ margin: '5px 0px' }}>
                            <div className="Card-root" style={{ backgroundColor: i === 0 ? '#f6f9fc' : '#ffffff' }}>
                                <div className="Box-root">
                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                <span>Escalation Policy {i + 1}</span>
                                            </span>
                                            <p>
                                                <span>

                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2" style={{ backgroundColor: '#f6f9fc' }}>
                                        <div>
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <fieldset className="bs-Fieldset">
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">Call Frequency</label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                type="text"
                                                                name={`${policy}.callFrequency`}
                                                                component={RenderField}
                                                                style={{ width: '320px' }}
                                                                defaultValue="10"
                                                                subProjectId={subProjectId}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-rows">

                                                        <FieldArray
                                                            name={`${policy}.teamMember`}
                                                            component={RenderNames}
                                                            subProjectId={subProjectId}
                                                        />
                                                    </div>
                                                </fieldset>
                                            </div>
                                        </div>
                                    </div>
                                    <ShouldRender if={fields.length > 1}>
                                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12" style={{ backgroundColor: '#f6f9fc' }}>

                                            <div>
                                                <button
                                                    className="bs-Button bs-DeprecatedButton"
                                                    onClick={() => fields.remove(i)}
                                                    type="button"
                                                >
                                                    Remove Policy
                                            </button>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                        </li>
                    )
                })
            }

            <li>

                <div className="bs-Fieldset-row" style={{ padding: '0px 15px' }}>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <div>
                                <ShouldRender if={fields.length < 10}>
                                    <button
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() => fields.push({ callFrequency: '10',teamMember: [{ member: '', email: true, sms: true, call: true, timezone: '', startTime: '', endTime: '' }] })}
                                    >
                                        Add Policy
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                        <p className="bs-Fieldset-explanation">
                            <span>
                                You can add Escalation Policy here.
                            </span>
                        </p>
                    </div>
                </div>
            </li>
        </ul>
    )
}

RenderEscalation.displayName = 'RenderEscalation'

RenderEscalation.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
    // touched:PropTypes.bool,
    // error:PropTypes.string,
}

export { RenderEscalation }