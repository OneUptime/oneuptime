import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

const PricingPlanModal = ({ closeThisDialog, propArr }) => {
    return (
        <div
            onKeyDown={e => e.key === 'Escape' && closeThisDialog()}
            className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            id="pricingPlanModal"
        >
            <div
                className="ModalLayer-contents"
                tabIndex={-1}
                style={{ marginTop: 40 }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <div className="bs-Modal-header">
                            <div className="bs-Modal-header-copy">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Upgrade Plan</span>
                                </span>
                            </div>
                        </div>
                        <div className="bs-Modal-content">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                This feature is available on {propArr[0].plan}{' '}
                                plan. Please upgrade your plan to access this
                                feature.
                            </span>
                        </div>
                        <div className="bs-Modal-footer">
                            <div className="bs-Modal-footer-actions">
                                <button
                                    id="cancelPricingModal"
                                    className={`bs-Button`}
                                    type="button"
                                    onClick={closeThisDialog}
                                >
                                    <span>Cancel</span>
                                </button>
                                <button
                                    id="confirmPricingActivate"
                                    className={`bs-Button bs-Button--blue`}
                                    onClick={closeThisDialog}
                                >
                                    <span>Activate</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = state => ({});

PricingPlanModal.displayName = 'Pricing Plan Modal';

PricingPlanModal.propTypes = {
    closeThisDialog: PropTypes.func,
    propArr: PropTypes.array,
    // confirmThisDialog: PropTypes.func,
};

export default connect(mapStateToProps)(PricingPlanModal);
