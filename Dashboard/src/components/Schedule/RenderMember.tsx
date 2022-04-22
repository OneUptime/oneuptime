import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

import { Field } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import TeamMemberSelector from '../basic/TeamMemberSelector';
import TimeSelector from '../basic/TimeSelector';
import Tooltip from '../basic/Tooltip';
import PricingPlan from '../basic/PricingPlan';
import moment from 'moment-timezone';
import { RenderSelect } from '../basic/RenderSelect';

import { change } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { formValueSelector } from 'redux-form';

interface RenderMemberProps {
    subProjectId: string;
    fields: unknown[] | object;
    policyIndex: number;
    teamIndex: number;
    nameIndex: number;
    memberValue: object;
    inputarray: string;
    change?: Function;
    form?: object;
    projectGroups?: unknown[];
    formValues?: object;
}

let RenderMember = ({
    memberValue,
    inputarray,
    subProjectId,
    policyIndex,
    teamIndex,
    nameIndex,
    fields,
    change,
    form,
    projectGroups,
    formValues
}: RenderMemberProps) => {
    const [timeVisible, setTimeVisible]: $TSFixMe = useState(false);
    const [forcedTimeHide, forceTimeHide]: $TSFixMe = useState(false);
    const [type, setType]: $TSFixMe = useState({});

    const manageVisibility: Function = (timeVisible: $TSFixMe, memberHasCallTimes: $TSFixMe) => {
        setTimeVisible(timeVisible);
        if (memberHasCallTimes && !timeVisible) {
            forceTimeHide(true);
        }

        if (memberHasCallTimes && timeVisible) {
            forceTimeHide(false);
        }
    };
    const updateTypeOnMount: Function = () => {
        setType({
            ...type,
            [teamIndex.toString() + nameIndex.toString()]: form[policyIndex]
                .teams[teamIndex].teamMembers[nameIndex].groupId
                ? 'group'
                : 'team',
        });
    };

    useEffect(updateTypeOnMount, [inputarray, form]);

    const memberHasCallTimes: $TSFixMe = !!(memberValue.startTime && memberValue.endTime);
    const showTimes: $TSFixMe = memberHasCallTimes ? !forcedTimeHide : timeVisible;

    const getCurrentTimezone: Function = () => {
        const tz: $TSFixMe = moment.tz.guess();
        const result:string: $TSFixMe = `${tz} GMT${moment()
            .tz(tz)
            .format('Z')}`;
        return result;
    };

    const handleSwitch: Function = (val: $TSFixMe) => {
        setType({ [teamIndex.toString() + nameIndex.toString()]: val });
        if (val === 'team') {
            change('OnCallAlertBox', `${inputarray}.groupId`, '');
        }
        if (val === 'group') {
            change('OnCallAlertBox', `${inputarray}.userId`, '');
        }
    };
    const renderKey: $TSFixMe =
        'team-group' + teamIndex.toString() + nameIndex.toString();

    const renderType: $TSFixMe =
        formValues[renderKey] ||
        (form[policyIndex].teams[teamIndex].teamMembers[nameIndex].groupId
            ? 'group'
            : 'team');
    return (
        <li key={nameIndex}>
            <ShouldRender if={projectGroups && projectGroups.count > 0}>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">
                        Select Team Member or Groups
                    </label>
                    <div className="bs-Fieldset-fields">
                        <span>
                            <Field
                                id={`${inputarray}.${type[

                                    [
                                        teamIndex.toString() +
                                        nameIndex.toString(),
                                    ]
                                ] === 'group'
                                    ? 'groupId'
                                    : 'userId'
                                    }`}
                                className="db-select-nw"
                                type="text"
                                name={
                                    'team-group' +
                                    teamIndex.toString() +
                                    nameIndex.toString()
                                }
                                component={RenderSelect}
                                placeholder={
                                    type[

                                        [
                                            teamIndex.toString() +
                                            nameIndex.toString(),
                                        ]
                                    ] === 'group'
                                        ? 'Groups'
                                        : 'Team members'
                                }
                                options={[
                                    { label: 'Team members', value: 'team' },
                                    { label: 'Groups', value: 'group' },
                                ]}
                                onChange={(event: $TSFixMe, newValue: $TSFixMe) => {
                                    handleSwitch(newValue);
                                }}
                                subProjectId={subProjectId}
                                policyIndex={policyIndex}
                                teamIndex={teamIndex}
                            />
                        </span>
                    </div>
                </div>
            </ShouldRender>
            <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label">
                    {renderType === 'group' ? 'Group' : 'Team Member'}
                </label>
                <div className="bs-Fieldset-fields">
                    <span className="flex">
                        <Field
                            id={`${inputarray}.userId`}
                            className="db-BusinessSettings-input TextInput bs-TextInput"
                            type="text"
                            name={`${inputarray}.${renderType === 'group' ? 'groupId' : 'userId'
                                }`}
                            component={TeamMemberSelector}
                            placeholder="Nawaz"
                            subProjectId={subProjectId}
                            policyIndex={policyIndex}
                            teamIndex={teamIndex}
                            renderType={renderType}
                        />

                        <Tooltip title="Call Reminders">
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
                            <button
                                className="button-as-anchor"
                                onClick={() =>
                                    manageVisibility(true, memberHasCallTimes)
                                }
                                id="addOnCallDutyTimes"
                            >

                                <PricingPlan plan="Growth" hideChildren={false}>
                                    Advanced: Add on-call duty times
                                </PricingPlan>
                            </button>
                        </div>
                    </div>
                </>
            )}

            {showTimes && (
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">
                        On-Call Start Time
                    </label>
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

                            <Tooltip title="Start Time">
                                <div>
                                    <p>
                                        {' '}
                                        Here&#39;s an example, <br />
                                        <br />
                                        You add two team members to your on-call
                                        team - one of them is in US and the
                                        other is in India. <br />
                                        <br />
                                        You can set US team member to be on call
                                        from 9:00 AM EST to 9:00 PM EST and
                                        India team member to be on call from
                                        9:00 PM EST to 9:00 AM EST. <br />
                                        <br />
                                        This helps you distribute on-call duty
                                        based on geographical locations of team
                                        members. <br />
                                        <br />
                                        On-Call start time is start of the
                                        on-call duty time.{' '}
                                    </p>
                                </div>
                            </Tooltip>
                        </span>
                        <label className="bs-oncall-label">
                            {getCurrentTimezone()}
                        </label>
                    </div>
                </div>
            )}

            {showTimes && (
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label">
                        On-Call End Time
                    </label>
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

                            <Tooltip title="End Time">
                                <div>
                                    <p>
                                        {' '}
                                        Here&#39;s an example, <br />
                                        <br />
                                        You add two team members to your on-call
                                        team - one of them is in US and the
                                        other is in India. <br />
                                        <br />
                                        You can set US team member to be on call
                                        from 9:00 AM EST to 9:00 PM EST and
                                        India team member to be on call from
                                        9:00 PM EST to 9:00 AM EST. <br />
                                        <br /> This helps you distribute on-call
                                        duty based on geographical locations of
                                        team members. <br />
                                        <br />
                                        On-Call end time is end of the on-call
                                        duty time.{' '}
                                    </p>
                                </div>
                            </Tooltip>
                        </span>
                        <label className="bs-oncall-label">
                            {getCurrentTimezone()}
                        </label>
                    </div>
                </div>
            )}

            {showTimes && (
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <button
                            className="button-as-anchor"
                            onClick={() => {
                                memberValue.startTime = null;
                                memberValue.endTime = null;
                                memberValue.timezone = null;
                                manageVisibility(false, memberHasCallTimes);
                            }}
                        >
                            Remove on-call duty times
                        </button>
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
        </li>
    );
};


RenderMember.displayName = 'RenderMember';

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators({ change }, dispatch);
};

function mapStateToProps(state: RootState) {
    const selector: $TSFixMe = formValueSelector('OnCallAlertBox');
    const form: $TSFixMe = selector(state, 'OnCallAlertBox');
    const formValues: $TSFixMe = state.form.OnCallAlertBox?.values;

    return {
        form,
        projectGroups: state.groups.oncallDuty,
        formValues,
    };
}

RenderMember.propTypes = {
    subProjectId: PropTypes.string.isRequired,
    fields: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
    policyIndex: PropTypes.number.isRequired,
    teamIndex: PropTypes.number.isRequired,
    nameIndex: PropTypes.number.isRequired,
    memberValue: PropTypes.object.isRequired,
    inputarray: PropTypes.string.isRequired,
    change: PropTypes.func,
    form: PropTypes.object,
    projectGroups: PropTypes.array,
    formValues: PropTypes.object,
};


RenderMember = connect(mapStateToProps, mapDispatchToProps)(RenderMember);
export { RenderMember };
