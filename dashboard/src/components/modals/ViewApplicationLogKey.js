import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import { RenderIfAdmin } from '../basic/RenderIfAdmin';
import ShouldRender from '../basic/ShouldRender';

class ViewApplicationLogKey extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            hidden: true,
            confirmBoxHidden: true,
        };
    }
    toggleConfirmationBox = () => {
        this.setState(state => ({
            confirmBoxHidden: !state.confirmBoxHidden,
        }));
    };
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const { hidden } = this.state;
        const { currentProject } = this.props;
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
                                        <span>Application Log Credentials</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--8 Padding-vertical--4">
                                    <p>
                                        <span>
                                            Use your Application Log ID and
                                            Application Log Key to log requests
                                            from your apps to your Fyipe
                                            Dashboard
                                        </span>
                                    </p>
                                </div>
                                <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row Flex-flex Flex-direction--column">
                                                <label className="bs-Fieldset-label">
                                                    Application Log ID
                                                </label>
                                                <div>
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                            fontWeight: 'bold',
                                                        }}
                                                    >
                                                        {this.props.data
                                                            .applicationLog !==
                                                        null
                                                            ? this.props.data
                                                                  .applicationLog
                                                                  ._id
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row Flex-flex Flex-direction--column">
                                                <label className="bs-Fieldset-label">
                                                    Application Log Key
                                                </label>
                                                <div
                                                    id={`show_application_log_key_${this.props.data.applicationLog.name}`}
                                                    onClick={() =>
                                                        this.setState(
                                                            state => ({
                                                                hidden: !state.hidden,
                                                            })
                                                        )
                                                    }
                                                >
                                                    <ShouldRender if={hidden}>
                                                        <span
                                                            className="value"
                                                            style={{
                                                                marginTop:
                                                                    '6px',
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                        >
                                                            Click here to reveal
                                                            Application Log key
                                                        </span>
                                                    </ShouldRender>
                                                    <ShouldRender if={!hidden}>
                                                        <span
                                                            id={`application_log_key_${this.props.data.applicationLog.name}`}
                                                            className="value"
                                                            style={{
                                                                marginTop:
                                                                    '6px',
                                                                fontWeight:
                                                                    'bold',
                                                            }}
                                                        >
                                                            {this.props.data
                                                                .applicationLog !==
                                                            null
                                                                ? this.props
                                                                      .data
                                                                      .applicationLog
                                                                      .key
                                                                : 'LOADING...'}
                                                        </span>
                                                    </ShouldRender>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                                <ShouldRender if={!this.state.confirmBoxHidden}>
                                    <div
                                        style={{ backgroundColor: 'white' }}
                                        className="Box-root"
                                    >
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <p>
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        Resetting the
                                                        Application Log Key will
                                                        break all your existing
                                                        integrations with the
                                                        Fyipe Application Logger
                                                        Library
                                                    </span>
                                                </p>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <p>
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        Are you sure you want to
                                                        continue?
                                                    </span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        id={`cancel_application_log_key_${this.props.data.applicationLog.name}`}
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <RenderIfAdmin
                                        currentProject={currentProject}
                                    >
                                        <ShouldRender
                                            if={this.state.confirmBoxHidden}
                                        >
                                            <button
                                                id={`reset_application_log_key_${this.props.data.applicationLog.name}`}
                                                className="bs-Button bs-Button--blue"
                                                onClick={
                                                    this.toggleConfirmationBox
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        !this.props.isRequesting
                                                    }
                                                >
                                                    <span>
                                                        Reset Application Log
                                                        Key
                                                    </span>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={this.props.isRequesting}
                                                >
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={!this.state.confirmBoxHidden}
                                        >
                                            <button
                                                id={`confirm_reset_application_log_key_${this.props.data.applicationLog.name}`}
                                                className="bs-Button bs-DeprecatedButton bs-Button--red"
                                                type="button"
                                                onClick={
                                                    this.props.confirmThisDialog
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        !this.props.isRequesting
                                                    }
                                                >
                                                    <span>YES, RESET</span>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={this.props.isRequesting}
                                                >
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </ShouldRender>
                                    </RenderIfAdmin>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ViewApplicationLogKey.displayName = 'ViewApplicationLogKeyModal';

ViewApplicationLogKey.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    currentProject: PropTypes.object,
    data: PropTypes.object,
};

const mapStateToProps = state => {
    return {
        applicationLogState: state.applicationLog,
        currentProject: state.project.currentProject,
    };
};

export default connect(mapStateToProps)(ViewApplicationLogKey);
