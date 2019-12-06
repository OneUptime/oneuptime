import React from 'react';
import PropTypes from 'prop-types'
import { FieldArray } from 'redux-form';
import { Field, formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { RenderNames } from './RenderNames';
import { RenderField } from './RenderField';


let RenderEscalation = ({ fields, meta: { error, submitFailed }, subProjectId, form }) => {
 
    return (
        <ul>
            {
                fields.map((policy, i) => {
                    const { email, sms, call } = form[i];

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
                                            <div className="bs-Fieldset-row" style={{ marginBottom: '-20px'}}>
                                                <label className="bs-Fieldset-label"><span>Alert Via.</span></label>
                                                <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={`${policy}.email`}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>Email</span>
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                                <div className="Box-root Padding-left--24">
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <div className="Box-root">
                                                            <div className="Box-root">

                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={`${policy}.sms`}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>SMS</span>
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                                <div className="Box-root Padding-left--24">
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <div className="Box-root">
                                                            <div className="Box-root">

                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-fields" style={{ maxWidth: '100px' }}>
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={`${policy}.call`}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>Call</span>
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>

                                            </div>
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <fieldset className="bs-Fieldset">
                                                    {call && (
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">Call Frequency</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    type="text"
                                                                    name={`${policy}.callFrequency`}
                                                                    component={RenderField}
                                                                    style={{ width: '250px' }}
                                                                    defaultValue="10"
                                                                    subProjectId={subProjectId}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {sms && (
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">SMS Frequency</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    type="text"
                                                                    name={`${policy}.smsFrequency`}
                                                                    component={RenderField}
                                                                    style={{ width: '250px' }}
                                                                    defaultValue="10"
                                                                    subProjectId={subProjectId}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {email && (
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">Email Frequency</label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    type="text"
                                                                    name={`${policy}.emailFrequency`}
                                                                    component={RenderField}
                                                                    style={{ width: '250px' }}
                                                                    defaultValue="10"
                                                                    subProjectId={subProjectId}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
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
                                        onClick={() => fields.push(
                                            { 
                                                callFrequency: '10',
                                                smsFrequency: '10',
                                                emailFrequency: '10',
                                                email: true,
                                                sms: false,
                                                call: false,
                                                teamMember: [
                                                    { 
                                                        member: '',
                                                        timezone: '',
                                                        startTime: '',
                                                        endTime: ''
                                                    }
                                                ]
                                            }
                                        )}
                                    >
                                        Add Escalation Policy
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </div>
            </li>
        </ul>
    )
}

RenderEscalation.displayName = 'RenderEscalation';

const selector = formValueSelector('OnCallAlertBox');

RenderEscalation = connect(state => {
    const form = selector(state, 'OnCallAlertBox')
    return {
      form
    }
})(RenderEscalation)

RenderEscalation.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
    form: PropTypes.array.isRequired,
    // touched:PropTypes.bool,
    // error:PropTypes.string,
}

export { RenderEscalation }