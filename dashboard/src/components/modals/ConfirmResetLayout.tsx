import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { closeModal } from '../../actions/modal';

class ConfirmResetLayout extends Component {
    state = {
        requesting: false,
    };
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return this.props.data.resetLayoutToDefault();
            default:
                return false;
        }
    };

    resetBrandColors = () => {

        const { projectId, statusPageId } = this.props.data;

        this.props.resetBrandingColors(projectId, statusPageId).then(() => {

            this.props.closeThisDialog();
        });
    };

    render() {

        const { closeModal, data, closeThisDialog } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Reset</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to reset Layout to
                                        default?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={() => {
                                                return closeModal({
                                                    id:
                                                        data.confirmResetModalId,
                                                });
                                            }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="removeSubProject"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={() => {
                                                this.setState({
                                                    requesting: true,
                                                });

                                                this.props.data
                                                    .resetLayoutToDefault()
                                                    .then(() => {
                                                        this.setState({
                                                            requesting: false,
                                                        });
                                                        return closeModal({
                                                            id:
                                                                data.confirmResetModalId,
                                                        });
                                                    });
                                            }}
                                            disabled={

                                                this.props.statusPage
                                                    .resetBrandingColors
                                                    .requesting
                                            }
                                            autoFocus={true}
                                        >
                                            {!this.state.requesting && (
                                                <>
                                                    <span>Confirm</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {this.state.requesting && (
                                                <FormLoader />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


ConfirmResetLayout.displayName = 'ConfirmResetLayout';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        statusPage: state.statusPage,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            closeModal,
        },
        dispatch
    );
};


ConfirmResetLayout.propTypes = {
    closeModal: PropTypes.func,
    closeThisDialog: PropTypes.func.isRequired,
    statusPage: PropTypes.object,
    data: PropTypes.object,
    resetBrandingColors: PropTypes.func,
    resetLayoutToDefault: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ConfirmResetLayout);
