import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { EscalationSingle } from './EscalationSingle';

const EscalationsList = ({ escalationData, subProjectId }) => {
  return (
    escalationData.length >0 ? (
      <div className="Box-root Margin-bottom--12">
        <div className="bs-ContentSection Card-root Card-shadow--medium">
          <div className="Box-root">
            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
              <div className="Box-root">
                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                    <span>Escalation Active Teams</span>
                </span>
                <p>
                    <span>
                        View current active team and the next team on rotation for each escalation policy.
                    </span>
                </p>
              </div>
            </div>
          </div>
          {escalationData.map((escalation, i) => (
            <EscalationSingle
              escalation={escalation}
              key={i}
              policyIndex={i}
              subProjectId={subProjectId}
            />
          ))}
        </div>
      </div>
       
    ) : (
      <></>
    )
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
