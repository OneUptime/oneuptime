import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { bindActionCreators, Dispatch } from 'redux';
import { closeModal } from 'CommonUI/actions/Modal';
import {
    scanContainerSecurity,
    scanApplicationSecurity,
} from '../../actions/security';

interface ConfirmScanModalProps {
    closeThisDialog: Function;
    closeModal: Function;
    scanContainerSecurity: Function;
    scanApplicationSecurity: Function;
    projectId: Function;
    propArr?: unknown[];
    containerSecurityId: Function;
}

class ConfirmScanModal extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':
                return this.handleScan();
            default:
                return false;
        }
    };

    handleScan = () => {
        const {

            closeModal,

            propArr,

            scanContainerSecurity,

            scanApplicationSecurity,
        } = this.props;
        const {
            projectId,
            containerSecurityId,
            applicationSecurityId,
        } = propArr[0];
        if (containerSecurityId) {
            scanContainerSecurity({ projectId, containerSecurityId });
        }
        if (applicationSecurityId) {
            scanApplicationSecurity({ projectId, applicationSecurityId });
        }
        return closeModal({ id: containerSecurityId });
    };

    override render() {
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center" >
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >

                    <ClickOutside onClickOutside={this.props.closeThisDialog}>
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Scanning?</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to scan your

                                        {this.props.propArr[0].name}?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            id="cancelScanModal"
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"

                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="confirmScanModal"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            type="button"
                                            onClick={this.handleScan}
                                            autoFocus={true}
                                        >
                                            <span>Confirm</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ClickOutside>
                </div>
            </div>
        );
    }
}


ConfirmScanModal.displayName = 'ConfirmScanModal';
const mapStateToProps: Function = () => ({});

ConfirmScanModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    scanContainerSecurity: PropTypes.func.isRequired,
    scanApplicationSecurity: PropTypes.func.isRequired,
    projectId: PropTypes.func.isRequired,
    propArr: PropTypes.array,
    containerSecurityId: PropTypes.func.isRequired,
};
const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    { closeModal, scanContainerSecurity, scanApplicationSecurity },
    dispatch
);
export default connect(mapStateToProps, mapDispatchToProps)(ConfirmScanModal);
