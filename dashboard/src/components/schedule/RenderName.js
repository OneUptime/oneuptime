import React, { useState } from 'react';
import PropTypes from 'prop-types'
import { Field } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import TimezoneSelector from '../basic/TimezoneSelector';
import TeamSelector from '../basic/TeamSelector';
import TimeSelector from '../basic/TimeSelector';

let RenderName = ({
    memberValue, inputarray, subProjectId,
    policyIndex, teamIndex, nameIndex,
    fields
  }) => {
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

    const memberHasCallTimes = !!(memberValue.startTime && memberValue.endTime);
    const showTimes = memberHasCallTimes ? (!forcedTimeHide) : timeVisible;
    return (
        <li key={nameIndex}>
            
            <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label">Team Member {nameIndex + 1}</label>
                <div className="bs-Fieldset-fields">
                    <Field
                        className="db-BusinessSettings-input TextInput bs-TextInput"
                        type="text"
                        name={`${inputarray}.member`}
                        component={TeamSelector}
                        placeholder="Nawaz"
                        subProjectId={subProjectId}
                        policyIndex={policyIndex}
                        teamIndex={teamIndex}
                    />                    
                </div>
            </div>                            

            <div className="bs-Fieldset-row">
                
                {!showTimes ? (
                    <>
                      <label className="bs-Fieldset-label"></label>
                      <text
                          className="Text-color--blue Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base"
                          style={{ marginTop: '5px', cursor: 'pointer' }}
                          onClick={(() => manageVisibility(true, memberHasCallTimes))}
                      >Add on-call duty times</text>
                    </>
                ) : (
                  <>
                    <label className="bs-Fieldset-label">Time : </label>
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
                </>
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
                            onClick={() => fields.remove(nameIndex)}
                        >
                            Remove Member
                        </button>
                    </div>
                </div>
            </div>
            </ShouldRender>
        </li>
    );
}

RenderName.displayName = 'RenderName';

RenderName.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
    policyIndex: PropTypes.number.isRequired,
    teamIndex: PropTypes.number.isRequired,
    nameIndex: PropTypes.number.isRequired,
    memberValue: PropTypes.object.isRequired,
    inputarray: PropTypes.string.isRequired,
}

export { RenderName }
