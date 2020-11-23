import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

class OnCallScheduleModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
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
                                            You are currently on-call duty.
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                · test: Your duty ends at 11:59 PM and your next
                                duty begins at 12:00 AM and ends at 11:59 PM.
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                        autoFocus={true}
                                    >
                                        <span>Close</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
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

OnCallScheduleModal.displayName = 'OnCallScheduleModal';

const mapStateToProps = state => {
    return {
        // versions: state.version.versions,
    };
};

OnCallScheduleModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
};

export default connect(mapStateToProps)(OnCallScheduleModal);
