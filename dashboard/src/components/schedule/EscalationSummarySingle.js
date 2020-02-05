import React from 'react';
import moment from 'moment';
import PropTypes from 'prop-types';
import {DateTime} from '../../config';

let EscalationSummarySingle = ({
    isActiveTeam,
    isNextActiveTeam,
    teamMemberList,
    escalation,
    hasNextEscalationPolicy,
    currentEscalationPolicyCount
}) => {

    var data = isActiveTeam ? escalation.activeTeam : escalation.nextActiveTeam;
    if (data)
        var teamMembers = data.teamMembers;
    return (
        <>
            {isActiveTeam && (<div className="bs-Fieldset-row">

                <div className="bs-Fieldset-fields">
                    <div className="team-header-label">
                        <h3 style={{
                            width: '250px',
                            marginLeft: '140px',
                            marginTop: '20px'
                        }}> <span className="greendot"></span> {'On Active Duty: Team 1'}</h3>
                    </div>
                </div>
            </div>)}

            {isNextActiveTeam && (<div className="bs-Fieldset-row">

                <div className="bs-Fieldset-fields">
                    <div className="team-header-label">
                        <h3 style={{
                            width: '250px',
                            marginLeft: '140px',
                            marginTop: '20px'
                        }}> <span className="yellowdot"></span> {'Next Team Scheduled: Team 2'}</h3>
                    </div>
                </div>
            </div>)}


            <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>Team Members</b></label>
                <div className="bs-Fieldset-fields labelfield" style={{ marginTop: '-1px' }}>
                    {teamMembers && teamMembers.length > 0 && teamMembers.map((member) => {

                        var membersFromList = teamMemberList.filter((memberFromList) => {
                            return memberFromList.userId === member.userId;
                        })

                        if (membersFromList.length > 0) {
                            membersFromList = membersFromList[0];
                        }

                        return (<div key={membersFromList.id} className="Box-root Margin-right--16 pointer">
                            <img src='/assets/img/profile-user.svg' key={membersFromList._id} className="userIcon" alt="" />
                            <span>{membersFromList.name}</span>
                        </div>)
                    })}

                </div>
            </div>

            {!isActiveTeam && data && data.rotationStartTime && <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>On-Call Duty Start Time</b></label>
                <div className="bs-Fieldset-fields labelfield">
                    {data && data.rotationStartTime ? DateTime.format(DateTime.convertToCurrentTimezone(DateTime.changeDateTimezone(data.rotationStartTime, data.rotationTimezone)), 'ddd, Do MMM: hh:mm a') : ''}
                </div>
            </div>}

            {data && data.rotationEndTime && <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>On-Call Duty End Time</b></label>
                <div className="bs-Fieldset-fields labelfield">
                    {data && data.rotationEndTime ? moment(data.rotationEndTime).tz(moment.tz.guess()).format('ddd, Do MMM: hh:mm a') : ''}
                </div>
            </div>}

            {data && !data.rotationEndTime && <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>On-Call Duty End Time</b></label>
                <div className="bs-Fieldset-fields labelfield">
                    {'This is the only team in this escalation policy.'} <br /> {'It\'ll always be active.'}
                </div>
            </div>}

            {<div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>Note:</b> </label>
                <div className="bs-Fieldset-fields labelfield">
                    {hasNextEscalationPolicy && isActiveTeam && <span>If the current active team does not respond, then the incident will be escalated to Escalation Policy {currentEscalationPolicyCount+1} <br /><br /></span>} 
                    {teamMembers && teamMembers.filter((member) => {
                        return member.startTime && member.startTime !== '' && member.endTime && member.endTime !== ''
                    }).length>0 && <span> Team Memmbers: <br/><br/> </span> }
                    {teamMembers && teamMembers.filter((member) => {
                        return member.startTime && member.startTime !== '' && member.endTime && member.endTime !== ''
                    }).map((member) => {
                        var membersFromList = teamMemberList.filter((memberFromList) => {
                            return memberFromList.userId === member.userId;
                        })

                        if (membersFromList.length > 0) {
                            membersFromList = membersFromList[0];
                        }

                        return (<div key={membersFromList._id} className="Box-root Margin-right--16 pointer">
                            <img src='/assets/img/profile-user.svg' className="userIcon" alt="" />
                            <span>{membersFromList.name}</span>
                            <span> <br/><br/> Will only be active from { moment.tz(member.startTime).tz(member.timezone).format('hh:mm A')} and {moment(member.endTime).tz(moment.tz.guess()).format('hh:mm A')} everyday. <br/><br/>If there&#39;s no team member on-duty when this member is not on-duty the incident is at the risk of being {hasNextEscalationPolicy ? 'escalated' : 'ignored'}. <br/> <br/></span>
                        </div>)

                    })}

                    {escalation.call && <span>{escalation.callFrequency}  Call reminders, </span>} {escalation.sms && <span>{escalation.smsFrequency}  SMS reminders, </span>} {escalation.email && <span>{escalation.emailFrequency}  Email reminders, </span>} <span>will be sent to each member of this team if they do not respond. <br/></span> 
                   
                    {hasNextEscalationPolicy && <span><br/>If they do not respond. The inident will be escalated to escalation policy {currentEscalationPolicyCount+1} <br/></span> }
                    {!hasNextEscalationPolicy && <span> <br/>If they do not respond. Then the incident is at the risk of being ignored. <br/></span>}

                </div>
            </div>}
        </>
    )
}

EscalationSummarySingle.displayName = 'EscalationSummarySingle';

EscalationSummarySingle.propTypes = {
    isActiveTeam: PropTypes.bool.isRequired,
    isNextActiveTeam: PropTypes.bool.isRequired,
    teamMemberList: PropTypes.array.isRequired,
    escalation: PropTypes.object.isRequired,
    hasNextEscalationPolicy: PropTypes.bool.isRequired,
    currentEscalationPolicyCount: PropTypes.number.isRequired
}

export default EscalationSummarySingle 
