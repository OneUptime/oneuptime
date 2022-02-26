import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module './EscalationSingle' or its cor... Remove this comment to see the full error message
import { EscalationSingle } from './EscalationSingle';

const EscalationsList = ({
    escalations,
    subProjectId
}: $TSFixMe) => {
    return escalations.length > 0 ? (
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
                                    View current active team and the next team
                                    on rotation for each escalation policy.
                                </span>
                            </p>
                        </div>
                    </div>
                </div>
                {escalations.map((escalation: $TSFixMe, i: $TSFixMe) => (
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
    );
};

EscalationsList.displayName = 'EscalationsList';

EscalationsList.propTypes = {
    escalations: PropTypes.array.isRequired,
    subProjectId: PropTypes.string.isRequired,
};

const mapStateToProps = (state: $TSFixMe) => {
    const { escalations } = state.schedule;
    return { escalations };
};

export default connect(mapStateToProps)(EscalationsList);
