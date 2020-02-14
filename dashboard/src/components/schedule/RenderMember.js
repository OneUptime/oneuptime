import React, { useState } from 'react';
import PropTypes from 'prop-types'
import { Field } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import TimezoneSelector from '../basic/TimezoneSelector';
import TeamMemberSelector from '../basic/TeamMemberSelector';
import TimeSelector from '../basic/TimeSelector';
import Tooltip from '../basic/Tooltip';

let RenderMember = ({
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
                <label className="bs-Fieldset-label">Team Member {fields.length > 1 ? nameIndex + 1 : ''}</label>
                <div className="bs-Fieldset-fields">
                    <span className="flex">
                        <Field
                            className="db-BusinessSettings-input TextInput bs-TextInput"
                            type="text"
                            name={`${inputarray}.userId`}
                            component={TeamMemberSelector}
                            placeholder="Nawaz"
                            subProjectId={subProjectId}
                            policyIndex={policyIndex}
                            teamIndex={teamIndex}
                        />
                        <Tooltip title="Call Reminders" >
                            <div>
                                <p> Team member who will be on-call duty. </p>
                            </div>
                        </Tooltip>
                    </span>
                </div>
            </div>



            {!showTimes && (
                <>
                    <div className="bs-Fieldset-row">
                        <label className="bs-Fieldset-label"></label>
                        <div className="bs-Fieldset-fields">
                            <button className="button-as-anchor"
                                onClick={(() => manageVisibility(true, memberHasCallTimes))}
                            >Advanced: Add on-call duty times</button>
                        </div>
                    </div>
                </>
            )}

            {showTimes && (
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">On-Call Start Time</label>
                    <div className="bs-Fieldset-fields">
                        <span className="flex">
                            <Field
                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                type="text"
                                name={`${inputarray}.startTime`}
                                component={TimeSelector}
                                placeholder="10pm"
                                style={{ width: '250px' }}
                            />
                            <Tooltip title="Start Time" >
                                <div>
                                    <p> Here&#39;s an example,  <br/><br/>You add two team members to your on-call team - one of them is in US and the other is in India.  <br/><br/>You can set US team member to be on call from 9:00 AM EST to 9:00 PM EST and India team member to be on call from 9:00 PM EST to 9:00 AM EST.  <br/><br/>This helps you distribute on-call duty based on geographical locations of team members.  <br/><br/>On-Call start time is start of the on-call duty time. </p>
                                </div>
                            </Tooltip>
                        </span>
                    </div>
                </div>)}

            {showTimes && (
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">On-Call End Time</label>
                    <div className="bs-Fieldset-fields">
                        <span className="flex">
                            <Field
                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                type="text"
                                name={`${inputarray}.endTime`}
                                component={TimeSelector}
                                placeholder="11pm"
                                style={{ width: '250px' }}
                            />
                            <Tooltip title="End Time" >
                                <div>
                                    <p> Here&#39;s an example, <br/><br/>You add two team members to your on-call team - one of them is in US and the other is in India.  <br/><br/>You can set US team member to be on call from 9:00 AM EST to 9:00 PM EST and India team member to be on call from 9:00 PM EST to 9:00 AM EST.  <br/><br/> This helps you distribute on-call duty based on geographical locations of team members.  <br/><br/>On-Call end time is end of the on-call duty time. </p>
                                </div>
                            </Tooltip>
                        </span>
                    </div>
                </div>)}
            {showTimes && (
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">Timezone</label>
                    <div className="bs-Fieldset-fields">
                        <span className="flex">
                            <Field
                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                type="text"
                                name={`${inputarray}.timezone`}
                                component={TimezoneSelector}
                                style={{ width: '250px' }}
                                placeholder="Select Timezone"
                            />
                            <Tooltip title="On-Call Timezone" >
                                <div>
                                    <p> Timezone of on-call start call time and on-call end time. </p>
                                </div>
                            </Tooltip>
                        </span>
                    </div>
                </div>)}

            {showTimes && (
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <button className="button-as-anchor"
                            onClick={() => {
                                memberValue.startTime = null;
                                memberValue.endTime = null;
                                memberValue.timezone = null;
                                manageVisibility(false, memberHasCallTimes)
                            }}
                        >Remove on-call duty times</button>
                    </div>
                </div>
            )}

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
        </li >
    );
}

RenderMember.displayName = 'RenderMember';

RenderMember.propTypes = {
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

export { RenderMember }
