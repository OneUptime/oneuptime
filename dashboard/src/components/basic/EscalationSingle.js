import React from 'react';
import PropTypes from 'prop-types';
import { RenderAlertOptions } from './RenderAlertOptions';
import { RenderActiveTeamMembers } from './RenderActiveTeamMembers'

const EscalationSingle = ({ escalation, policyIndex, subProjectId }) => {
  return (
    <div style={{ marginLeft: '5%'}}>
      <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
        <span>Escalation Policy {policyIndex + 1}</span>
        <RenderAlertOptions
          call={escalation.call}
          sms={escalation.sms}
          email={escalation.email}
        />
        {escalation.activeTeam ? (
          <div style={{ display: 'flex', marginTop: 10 }}>
            <div style={{ marginLeft: '2%', width: '45%' }}>
              <h4>Active Team:</h4>
              <RenderActiveTeamMembers
                team={escalation.activeTeam}
                subProjectId={subProjectId}
                rotationFrequency={escalation.rotationFrequency}
              />
            </div>
            {escalation.nextActiveTeam && (
              <div style={{ width: '45%' }}>
                <h4>Next Active Team:</h4>
                <RenderActiveTeamMembers
                  team={escalation.nextActiveTeam}
                  subProjectId={subProjectId}
                  rotationFrequency={escalation.rotationFrequency}
                />
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', marginTop: 10 }}>
            <div style={{ marginLeft: '2%', width: '45%' }}>
              <h4>Team:</h4>
              <RenderActiveTeamMembers
                team={escalation.team[0]}
                subProjectId={subProjectId}
              />
            </div>
          </div>
        )}
      </span>
    </div>
  )
}

EscalationSingle.displayName = 'EscalationSingle';
EscalationSingle.propTypes = {
  escalation: PropTypes.object.isRequired,
  policyIndex: PropTypes.number.isRequired,
  subProjectId: PropTypes.string.isRequired,
};

export { EscalationSingle }
