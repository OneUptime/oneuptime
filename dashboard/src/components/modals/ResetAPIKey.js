import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class ResetAPIKey extends Component {
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
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
                                        Fyipe API.
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
                                        id="resetApiKeySave"
                                        className="bs-Button bs-DeprecatedButton bs-Button--red"
                                        type="button"
                                        onClick={this.props.confirmThisDialog}
                                    >
                                        <ShouldRender
                                            if={!this.props.isRequesting}
                                        >
                                            <span>RESET</span>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={this.props.isRequesting}
                                        >
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                    >
                                        <span>Close</span>
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

ResetAPIKey.displayName = 'ResetAPIKeyModal';

const mapDispatchToProps = null;

const mapStateToProps = state => ({
    isRequesting: state.project.resetToken.requesting,
});

ResetAPIKey.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    confirmThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
};

export default connect(mapStateToProps, mapDispatchToProps)(ResetAPIKey);
