import PropTypes from 'prop-types';
import React from 'react';
import { connect } from 'react-redux';
import { closeModal } from 'common-ui/actions/modal';
import { bindActionCreators, Dispatch } from 'redux';

interface ExtraChargeProps {
    closeModal?: Function;
    modalId?: string;
}

class ExtraCharge extends React.Component<ExtraChargeProps> {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({

                    id: this.props.modalId,
                });
            default:
                return false;
        }
    };
    render() {
        return (
            <div>
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Why we charge your cards at sign up?
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <div>
                                    We&apos;ve had few issues with toll fraud in
                                    the past and we want to make sure our
                                    customers who sign up to OneUptime are 100%
                                    genuine. This is one of the steps we take to
                                    filter out fraud. To learn about toll fraud,{' '}
                                    <span
                                        style={{
                                            cursor: 'pointer',
                                            textDecoration: 'underline',
                                        }}
                                    >
                                        <a
                                            style={{ color: 'green' }}
                                            href="https://www.twilio.com/learn/voice-and-video/toll-fraud"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            please click here
                                        </a>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={() =>

                                            this.props.closeModal({

                                                id: this.props.modalId,
                                            })
                                        }
                                    >
                                        <span className="cancel-btn__keycode">
                                            {'Close'}
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


ExtraCharge.propTypes = {
    closeModal: PropTypes.func,
    modalId: PropTypes.string,
};


ExtraCharge.displayName = 'ExtraCharge';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        modalId: state.modal.modals[0].id,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            closeModal,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(ExtraCharge);
