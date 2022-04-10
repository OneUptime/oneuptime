import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class ResetAPIKey extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

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

        const { closeThisDialog } = this.props;

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
                                            <span>Reset API Key</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <p>
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            Resetting the API Key will break all
                                            your existing integrations with the
                                            API.
                                        </span>
                                    </p>
                                    <p>
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            Are you sure you want to continue?
                                        </span>
                                    </p>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"

                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Close</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="resetApiKeySave"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={

                                                this.props.confirmThisDialog
                                            }
                                            autoFocus={true}
                                        >
                                            <ShouldRender

                                                if={!this.props.isRequesting}
                                            >
                                                <span>RESET</span>
                                                <span className="delete-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </ShouldRender>
                                            <ShouldRender

                                                if={this.props.isRequesting}
                                            >
                                                <FormLoader />
                                            </ShouldRender>
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


ResetAPIKey.displayName = 'ResetAPIKeyModal';

const mapDispatchToProps = null;

const mapStateToProps = (state: RootState) => ({
    isRequesting: state.project.resetToken.requesting
});


ResetAPIKey.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    confirmThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
};

export default connect(mapStateToProps, mapDispatchToProps)(ResetAPIKey);
