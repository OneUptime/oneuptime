import React, { useState } from 'react';
import PropTypes from 'prop-types'
import { Field, FieldArray } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { RenderRotationFrequency } from './RenderRotationFrequency';
import { RenderInterval } from './RenderInterval';
import { RenderRotationSwitchTime } from './RenderRotationSwitchTime';
import TimezoneSelector  from './TimezoneSelector';
import { RenderTeams } from './RenderTeams';
import { RenderField } from './RenderField';

let RenderSingleEscalation = ({
  policy, email, sms, call,
  rotationFrequency, subProjectId,
  policyIndex, fields, rotationInterval
}) => {
  const [rotationFreqVisible, setRotationFreqVisibility] = useState(false);
  const [forcedRotationFreqHidden, forceRotationFreqHide] = useState(false)

  const manageVisibility = (visibilityVal) => {
    setRotationFreqVisibility(visibilityVal);
    if (rotationFreqVisible && visibilityVal) {
      forceRotationFreqHide(false);
    }
  }

  const showRotationFreq = rotationFrequency ? (!forcedRotationFreqHidden) : rotationFreqVisible;
  return (
    <li key={policyIndex} style={{ margin: '5px 0px' }}>
        <div className="Card-root" style={{ backgroundColor: policyIndex === 0 ? '#f6f9fc' : '#ffffff' }}>
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            <span>Escalation Policy {policyIndex + 1}</span>
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


                              <div className="bs-Fieldset-row">
                                {!showRotationFreq ? (
                                    <>
                                      <label className="bs-Fieldset-label"></label>
                                       <text
                                        className="Text-color--blue Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base"
                                        style={{ marginTop: '5px', cursor: 'pointer' }}
                                        onClick={(() => manageVisibility(true))}
                                      >Add Rotation Frequency</text>
                                    </>
                                ) : (
                                    <>
                                      <label className="bs-Fieldset-label">Rotation Frequency</label>
                                      <div className="bs-Fieldset-fields">
                                        <Field
                                            name={`${policy}.rotationFrequency`}
                                            className="db-select-nw"
                                            placeholder="Rotation Frequency"
                                            type="text"
                                            id="rotationFrequency"
                                            options={[
                                              { value: 'days', label: 'Day'},
                                              { value: 'weeks', label: 'Week'},
                                              { value: 'months', label: 'Month'}
                                            ]}
                                            component={RenderRotationFrequency}
                                        />
                                        {rotationFrequency && (
                                          <>
                                            <Field
                                              name={`${policy}.rotationInterval`}
                                              component={RenderInterval}
                                            />

                                            <RenderRotationSwitchTime
                                              policy={policy}
                                              rotationFrequency={rotationFrequency}
                                            />

                                            <Field
                                              className="db-BusinessSettings-input TextInput bs-TextInput"
                                              type="text"
                                              name={`${policy}.timezone`}
                                              component={TimezoneSelector}
                                              style={{width:'250px'}}
                                              placeholder="CXT - Christmas"
                                            />
                                          </>
                                        )}
                                      </div>

                                    </>
                                  )}
                                </div>

                                <div className="bs-Fieldset-rows">
                                  <FieldArray
                                      className="db-BusinessSettings-input TextInput bs-TextInput"
                                      name={`${policy}.team`}
                                      component={RenderTeams}
                                      subProjectId={subProjectId}
                                      policyIndex={policyIndex}
                                      rotationFrequency={rotationFrequency}
                                      rotationInterval={rotationInterval}
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
                                onClick={() => fields.remove(policyIndex)}
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
}

RenderSingleEscalation.displayName = 'RenderSingleEscalation';

RenderSingleEscalation.propTypes = {
  subProjectId: PropTypes.string.isRequired,
  call: PropTypes.bool.isRequired,
  sms: PropTypes.bool.isRequired,
  email: PropTypes.bool.isRequired,
  policy: PropTypes.string.isRequired,
  policyIndex: PropTypes.number.isRequired,
  rotationFrequency: PropTypes.string,
  rotationInterval: PropTypes.number,
  fields: PropTypes.oneOfType([
      PropTypes.array,
      PropTypes.object
  ]).isRequired,
}

export { RenderSingleEscalation }
