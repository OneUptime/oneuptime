import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { EscalationSingle } from '../basic/EscalationSingle';

const EscalationsList = ({ escalationData, subProjectId }) => {
  return (
    <div className="Box-root Margin-bottom--12">
      <div className="bs-ContentSection Card-root Card-shadow--medium">
        <div className="Box-root">
          <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
            <div className="Box-root">
              <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                  <span>Escalation Active Teams</span>
              </span>
            </div>
          </div>
          <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
              <fieldset data-test="RetrySettings-failedAndExpiring" className="bs-Fieldset">
                <div className="bs-Fieldset-rows">
                  {escalationData && escalationData.length ? (
                    <div style={{ padding: '10px' }}>
                      {escalationData.map((escalation, i) => (
                        <>
                          <EscalationSingle
                            escalation={escalation}
                            key={i}
                            policyIndex={i}
                            subProjectId={subProjectId}
                          />
                          {escalationData.length > 1 && (
                            <hr style={{ marginLeft: '5%', marginRight: '15%', marginTop: 15, marginBottom: 5}}/>
                          )}
                        </>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '10px' }}>
                      <h3>You have not created any escalation policies.</h3>
                      <span>Please create at least one to view active teams.</span>
                    </div>
                  )}
                </div>
              </fieldset>
              </div>
          </div>
        </div>
      </div>
    </div>
  )
}

EscalationsList.displayName = 'EscalationsList';

EscalationsList.propTypes = {
  escalationData: PropTypes.array.isRequired,
  subProjectId: PropTypes.string.isRequired,
}

const mapStateToProps = state => {
  const { escalationData } = state.schedule;
  return { escalationData }
}

export default connect(mapStateToProps)(EscalationsList);
