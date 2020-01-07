import React, { useState } from 'react';
import PropTypes from 'prop-types'
import { Field } from 'redux-form';
import { connect } from 'react-redux';
import { formValueSelector } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import TimezoneSelector from './TimezoneSelector';
import TeamSelector from './TeamSelector';
import TimeSelector from './TimeSelector';

let RenderNames = ({ fields, meta: { error, submitFailed }, subProjectId, policyIndex, rotationIndex, form }) => {
    const policyRotation = form[policyIndex].rotation[rotationIndex];
    const [timeVisible, setTimeVisible] = useState(false);
    const [forcedTimeHide, forceTimeHide] = useState(false);

    const manageVisibility = (timeVisible, memberHasCallTimes) => {
        setTimeVisible(timeVisible);
        if (memberHasCallTimes && !timeVisible) {
            forceTimeHide(true);
        }

        if (memberHasCallTimes && timeVisible) {
            forceTimeHide(false);
        }
    }

    return (
        <ul>
            {
                fields.map((inputarray, i) => {
                    const memberValue = policyRotation.teamMember[i];
                    const memberHasCallTimes = !!(memberValue.startTime && memberValue.endTime);
                    const showTimes = memberHasCallTimes ? (!forcedTimeHide) : timeVisible;
                    return (
                        <li key={i}>

                            <div className="bs-Fieldset-row">
                                <label className="bs-Fieldset-label">Team Member {i + 1}</label>
                                <div className="bs-Fieldset-fields">
                                    <Field
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        type="text"
                                        name={`${inputarray}.member`}
                                        component={TeamSelector}
                                        placeholder="Nawaz"
                                        subProjectId={subProjectId}
                                        policyIndex={policyIndex}
                                        rotationIndex={rotationIndex}
                                    />
                                </div>
                            </div>                            

                            <div className="bs-Fieldset-row">
                                <label className="bs-Fieldset-label">Time : </label>
                                {!showTimes ? (
                                    <text
                                        className="Text-color--blue Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base"
                                        style={{ marginTop: '5px', cursor: 'pointer' }}
                                        onClick={(() => manageVisibility(true, memberHasCallTimes))}
                                    >Add on-call duty times</text>
                                ) : (
                                  <div className="bs-Fieldset-fields">
                                    <div className="bs-Fieldset-row" style={{paddingLeft:'0px',paddingTop:'0px'}}>
                                        <label className="bs-Fieldset-label" style={{maxWidth:'40px'}}>From</label>
                                        <div className="bs-Fieldset-fields">
                                            <Field
                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                type="text"
                                                name={`${inputarray}.startTime`}
                                                component={TimeSelector}
                                                placeholder="10pm"
                                                style={{width:'250px'}}
                                            />
                                        </div>
                                    </div>
                                    <div className="bs-Fieldset-row" style={{paddingLeft:'0px'}}>
                                        <label className="bs-Fieldset-label" style={{maxWidth:'40px'}}>To</label>
                                        <div className="bs-Fieldset-fields">
                                            <Field
                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                type="text"
                                                name={`${inputarray}.endTime`}
                                                component={TimeSelector}
                                                placeholder="11pm"
                                                style={{width:'250px'}}
                                            />
                                        </div>
                                    </div>
                                    <div className="bs-Fieldset-row" style={{paddingLeft:'0px'}}>
                                      <label className="bs-Fieldset-label" style={{maxWidth:'40px'}}></label>
                                      <div className="bs-Fieldset-fields">
                                          <Field
                                              className="db-BusinessSettings-input TextInput bs-TextInput"
                                              type="text"
                                              name={`${inputarray}.timezone`}
                                              component={TimezoneSelector}
                                              style={{width:'250px'}}
                                              placeholder="CXT - Christmas"
                                          />
                                      </div>
                                  </div>
                                  <text
                                      className="Text-color--blue Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base"
                                      style={{ marginTop: '5px', cursor: 'pointer' }}
                                      onClick={(() => manageVisibility(false, memberHasCallTimes))}
                                  >Remove on-call duty times</text>
                                </div>
                                )}
                            </div>
                            <ShouldRender if={fields.length > 1}>
                            <div className="bs-Fieldset-row">
                                <label className="bs-Fieldset-label"></label>
                                <div className="bs-Fieldset-fields">
                                    <div className="Box-root Flex-flex Flex-alignItems--center">
                                        <button
                                            className="bs-Button bs-DeprecatedButton"
                                            type="button"
                                            onClick={() => fields.remove(i)}
                                        >
                                            Remove Member
                                        </button>
                                    </div>
                                </div>
                            </div>
                            </ShouldRender>
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
                                <ShouldRender if={fields.length < 10}>
                                    <button
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() => fields.push({ member: '', email: true, sms: true, call: true, timezone: '', startTime: '', endTime: '' })}
                                    >
                                        Add Member
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                        <p className="bs-Fieldset-explanation">
                            <span>
                                Add Names and respective alert medium and time to contact.
                            </span>
                        </p>
                    </div>
                </div>
            </li>
        </ul>
    )
}

RenderNames.displayName = 'RenderNames'

RenderNames.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
    policyIndex: PropTypes.number.isRequired,
    rotationIndex: PropTypes.number.isRequired,
    form: PropTypes.object.isRequired,
}

function mapStateToProps(state) {
    const selector = formValueSelector('OnCallAlertBox');
    const form = selector(state, 'OnCallAlertBox');

    return {
      form
    }
}

RenderNames = connect(mapStateToProps)(RenderNames);

export { RenderNames }