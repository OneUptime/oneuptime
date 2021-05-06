import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class SubProjectResetApiKey extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            case 'Enter':
                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    render() {
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
                                            <span>Confirm API Reset</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <p>
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">                                            
                                            Resetting the API Key will break all
                                            your existing integrations with the API.
                                            Are you sure you want to continue?
                                        </span>
                                    </p>                                    
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">                                    
                                        <button
                                            id="cancelResetKey"
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
                                            id="confirmResetKey"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            type="button"
                                            onClick={this.props.confirmThisDialog}
                                        >
                                            <span>OK</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
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

SubProjectResetApiKey.displayName = 'SubProjectResetApiKey';

const mapDispatchToProps = null;

const mapStateToProps = state => ({
    isRequesting: state.project.resetToken.requesting,
});

SubProjectResetApiKey.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    confirmThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
};

export default connect(mapStateToProps, mapDispatchToProps)(SubProjectResetApiKey);
