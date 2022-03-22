import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { RenderIfAdmin } from '../basic/RenderIfAdmin';
import ShouldRender from '../basic/ShouldRender';
import TooltipMini from '../basic/TooltipMini';
import { API_URL } from '../../config';

class ViewErrorTrackerKey extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            hidden: true,
            confirmBoxHidden: true,
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    toggleConfirmationBox = () => {
        this.setState(state => ({

            confirmBoxHidden: !state.confirmBoxHidden,
        }));
    };
    changeAPIKeyVisualState = () => {
        this.setState(state => ({

            hidden: !state.hidden,
        }));
    };
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter': {

                if (this.state.confirmBoxHidden) {
                    return this.toggleConfirmationBox();
                } else {

                    return this.props.confirmThisDialog();
                }
            }
            default:
                return false;
        }
    };

    render() {

        const { hidden } = this.state;

        const { currentProject, closeThisDialog } = this.props;
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
                                            <span>Tracker API Credentials</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--8 Padding-vertical--4">
                                        <p>
                                            <span>
                                                Use your Error Tracker API ID
                                                and Error Tracker API Key to
                                                track events happening in your
                                                apps which are then sent to your
                                                OneUptime Dashboard
                                            </span>
                                        </p>
                                    </div>
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row Flex-flex Flex-direction--column">
                                                    <label className="bs-Fieldset-label">
                                                        Error Tracker API ID
                                                    </label>
                                                    <div>
                                                        <span
                                                            className="value"
                                                            style={{
                                                                marginTop:
                                                                    '6px',
                                                                fontWeight:
                                                                    'bold',
                                                            }}
                                                        >

                                                            {this.props.data
                                                                .errorTracker !==
                                                                null
                                                                ? this.props

                                                                    .data
                                                                    .errorTracker
                                                                    ._id
                                                                : 'LOADING...'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row Flex-flex Flex-direction--column">
                                                    <label className="bs-Fieldset-label">
                                                        Error Tracker API URL
                                                    </label>
                                                    <div>
                                                        <span
                                                            className="value"
                                                            style={{
                                                                marginTop:
                                                                    '6px',
                                                                fontWeight:
                                                                    'bold',
                                                            }}
                                                        >
                                                            {API_URL !== null
                                                                ? API_URL
                                                                : 'LOADING...'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row Flex-flex Flex-direction--column">
                                                    <label className="bs-Fieldset-label">
                                                        Error Tracker API Key
                                                    </label>
                                                    <div>
                                                        <ShouldRender
                                                            if={hidden}
                                                        >
                                                            <span
                                                                className="value"
                                                                style={{
                                                                    marginTop:
                                                                        '6px',
                                                                    cursor:
                                                                        'pointer',
                                                                }}
                                                                onClick={
                                                                    this
                                                                        .changeAPIKeyVisualState
                                                                }

                                                                id={`show_error_tracker_key_${this.props.data.errorTracker.name}`}
                                                            >
                                                                Click here to
                                                                reveal Tracker
                                                                API key
                                                            </span>
                                                        </ShouldRender>
                                                        <ShouldRender
                                                            if={!hidden}
                                                        >
                                                            <div className="Flex-flex">
                                                                <span

                                                                    id={`error_tracker_key_${this.props.data.errorTracker.name}`}
                                                                    className="value"
                                                                    style={{
                                                                        marginTop:
                                                                            '6px',
                                                                        fontWeight:
                                                                            'bold',
                                                                    }}
                                                                >
                                                                    {this.props

                                                                        .data
                                                                        .errorTracker !==
                                                                        null
                                                                        ? this
                                                                            .props

                                                                            .data
                                                                            .errorTracker
                                                                            .key
                                                                        : 'LOADING...'}
                                                                </span>
                                                                <div
                                                                    onClick={
                                                                        this
                                                                            .changeAPIKeyVisualState
                                                                    }

                                                                    id={`hide_error_tracker_key_${this.props.data.errorTracker.name}`}
                                                                    className="Flex-flex Flex-alignItems--center Padding-left--8"
                                                                >
                                                                    <TooltipMini
                                                                        title="Hide Log API Key"
                                                                        content={
                                                                            <img
                                                                                alt="hide_error_tracker_key"
                                                                                src="/dashboard/assets/img/hide.svg"
                                                                                style={{
                                                                                    width:
                                                                                        '15px',
                                                                                    height:
                                                                                        '15px',
                                                                                    cursor:
                                                                                        'pointer',
                                                                                }}
                                                                            />
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                    <ShouldRender

                                        if={!this.state.confirmBoxHidden}
                                    >
                                        <div
                                            style={{ backgroundColor: 'white' }}
                                            className="Box-root"
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <p>
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                            Resetting the Error
                                                            Tracker API Key will
                                                            break all your
                                                            existing
                                                            integrations with
                                                            the OneUptime
                                                            Tracker Library
                                                        </span>
                                                    </p>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <p>
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                            Are you sure you
                                                            want to continue?
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

                                            id={`cancel_error_tracker_key_${this.props.data.errorTracker.name}`}
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"

                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <RenderIfAdmin
                                            currentProject={currentProject}
                                        >
                                            <ShouldRender

                                                if={this.state.confirmBoxHidden}
                                            >
                                                <button

                                                    id={`reset_error_tracker_key_${this.props.data.errorTracker.name}`}
                                                    className="bs-Button bs-Button--blue btn__modal"
                                                    onClick={
                                                        this
                                                            .toggleConfirmationBox
                                                    }
                                                    autoFocus={true}
                                                >
                                                    <ShouldRender
                                                        if={
                                                            !this.props

                                                                .isRequesting
                                                        }
                                                    >
                                                        <span>
                                                            Reset Tracker API
                                                            Key
                                                        </span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            this.props

                                                                .isRequesting
                                                        }
                                                    >
                                                        <FormLoader />
                                                    </ShouldRender>
                                                </button>
                                            </ShouldRender>
                                            <ShouldRender
                                                if={

                                                    !this.state.confirmBoxHidden
                                                }
                                            >
                                                <button

                                                    id={`confirm_reset_error_tracker_key_${this.props.data.errorTracker.name}`}
                                                    className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                                    type="button"
                                                    onClick={
                                                        this.props

                                                            .confirmThisDialog
                                                    }
                                                >
                                                    <ShouldRender
                                                        if={
                                                            !this.props

                                                                .isRequesting
                                                        }
                                                    >
                                                        <span>YES, RESET</span>
                                                        <span className="delete-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            this.props

                                                                .isRequesting
                                                        }
                                                    >
                                                        <FormLoader />
                                                    </ShouldRender>
                                                </button>
                                            </ShouldRender>
                                        </RenderIfAdmin>
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


ViewErrorTrackerKey.displayName = 'ViewErrorTrackerKeyModal';


ViewErrorTrackerKey.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    currentProject: PropTypes.object,
    data: PropTypes.object,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
    };
};

export default connect(mapStateToProps)(ViewErrorTrackerKey);
