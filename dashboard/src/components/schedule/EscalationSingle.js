import React from 'react';
import PropTypes from 'prop-types';
import { RenderAlertOptions } from './RenderAlertOptions';
import { RenderActiveTeamMembers } from '../basic/RenderActiveTeamMembers'

const EscalationSingle = ({ escalation, policyIndex, subProjectId }) => {
  return (
    <li style={{ margin: '5px 0px' }}>
      <div className="Card-root" style={{ backgroundColor: policyIndex === 0 ? '#f6f9fc' : '#ffffff' }}>
        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
          <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
            <span>Escalation Policy {policyIndex + 1}</span>
          </span>
        </div>
        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2" style={{ backgroundColor: '#f6f9fc' }}>
          <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
            <fieldset className="bs-Fieldset Padding-horizontal--20">
              <RenderAlertOptions
                call={escalation.call}
                sms={escalation.sms}
                email={escalation.email}
              />
              {escalation.activeTeam ? (
                <div style={{ display: 'flex', marginTop: 10 }}>
                  <div style={{ width: '47%' }}>
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>Active Team:</span>
                    </span>
                    <RenderActiveTeamMembers
                      team={escalation.activeTeam}
                      subProjectId={subProjectId}
                      rotationFrequency={escalation.rotationFrequency}
                      rotationSwitchTime={escalation.rotationSwitchTime}
                      activeTeam
                      timezone={escalation.rotationTimezone}
                    />
                  </div>
                  {escalation.nextActiveTeam && (
                    <div style={{ width: '47%' }}>
                      <span className="Text-color--inherit Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                          <span>Next Active Team:</span>
                      </span>
                      <RenderActiveTeamMembers
                        team={escalation.nextActiveTeam}
                        subProjectId={subProjectId}
                        rotationFrequency={escalation.rotationFrequency}
                        rotationSwitchTime={escalation.rotationSwitchTime}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', marginTop: 10 }}>
                  <div style={{ width: '45%' }}>
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>Active Team:</span>
                    </span>
                    <RenderActiveTeamMembers
                      team={escalation.team[0]}
                      subProjectId={subProjectId}
                    />
                  </div>
                </div>
              )}
            </fieldset>
          </div>
        </div>
      </div>
    </li>
  )
}

EscalationSingle.displayName = 'EscalationSingle';
EscalationSingle.propTypes = {
  escalation: PropTypes.object.isRequired,
  policyIndex: PropTypes.number.isRequired,
  subProjectId: PropTypes.string.isRequired,
};

export { EscalationSingle }
