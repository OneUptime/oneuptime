import React, { useState } from 'react';
import PropTypes from 'prop-types'
import ShouldRender from '../basic/ShouldRender';

let EscalationSummarySingle = ({
    isActiveTeam,
    isNextActiveTeam,
    teamMemberList,
    escalation
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
                            return memberFromList.userId === member.member;
                        })

                        if (membersFromList.length > 0) {
                            var membersFromList = membersFromList[0];
                        }

                        return (<div className="Box-root Margin-right--16 pointer">
                            <img src='/assets/img/profile-user.svg' className="userIcon" alt="" />
                            <span>{membersFromList.name}</span>
                        </div>)
                    })}

                </div>
            </div>

            {!isActiveTeam && <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>On-Call Duty Start Time</b></label>
                <div className="bs-Fieldset-fields labelfield">
                    {data && data.rotationStartTime ? data.rotationStartTime : ''}
                </div>
            </div>}
            <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>On-Call Duty End Time</b></label>
                <div className="bs-Fieldset-fields labelfield">
                    {data && data.rotationEndTime ? data.rotationEndTime : ''}
                </div>
            </div>

            {isActiveTeam && <div className="bs-Fieldset-row">
                <label className="bs-Fieldset-label"><b>Note:</b> </label>
                <div className="bs-Fieldset-fields labelfield">
                    If the current active team does not respond, then the incident will be escalated to Escalation Policy 2 <br />
                </div>
            </div>}
        </>
    )
}

EscalationSummarySingle.displayName = 'EscalationSummarySingle';

EscalationSummarySingle.propTypes = {

}

export default EscalationSummarySingle 
