import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';

interface ConfirmBalanceTopUpProps {
    confirmThisDialog: Function;
    closeThisDialog: Function;
    data?: object;
    isRequesting?: boolean;
}

class ConfirmBalanceTopUp extends Component<ComponentProps> {
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

                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    override render() {
        let recharging = false;

        if (this.props.isRequesting) {
            recharging = true;
        }

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
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
                                            <span>
                                                Confirm Account Balance Top Up
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to top up your
                                        account balance with{' '}
                                        <span
                                            style={{
                                                fontWeight: 'bold',
                                            }}

                                        >{`${this.props.data.amount}$`}</span>
                                        ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            id="cancelBalanceTopUp"
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
                                            id="confirmBalanceTopUp"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            type="button"
                                            onClick={

                                                this.props.confirmThisDialog
                                            }
                                            disabled={recharging}
                                            autoFocus={true}
                                        >
                                            {!recharging && (
                                                <>
                                                    <span>
                                                        Yes, Recharge Account
                                                    </span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {recharging && <FormLoader />}
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


ConfirmBalanceTopUp.displayName = 'ConfirmBalanceTopUpFormModal';
const mapStateToProps: Function = (state: RootState) => ({
    isRequesting: state.project.addBalance.requesting
});

ConfirmBalanceTopUp.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object,
    isRequesting: PropTypes.bool,
};
export default connect(mapStateToProps)(ConfirmBalanceTopUp);
