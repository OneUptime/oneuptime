import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { RenderIfAdmin } from '../basic/RenderIfAdmin';
import ShouldRender from '../basic/ShouldRender';
import TooltipMini from '../basic/TooltipMini';
import { API_URL } from '../../config';
import { closeModal } from 'CommonUI/actions/Modal';
import { resetPerformanceTrackerKey } from '../../actions/performanceTracker';
import { bindActionCreators, Dispatch } from 'redux';

interface TrackerInfoProps {
    data?: object;
    closeModal?: Function;
    trackerObj?: object;
    resetPerformanceTrackerKey?: Function;
}

class TrackerInfo extends Component<ComponentProps> {
    state = {
        hidden: true,
        confirmBoxHidden: true,
    };

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
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
    handleReset = () => {
        const {

            resetPerformanceTrackerKey,

            data,

            closeModal,

            trackerObj,
        } = this.props;
        const { currentProject, performanceTracker }: $TSFixMe = data;

        resetPerformanceTrackerKey({
            projectId: currentProject._id,
            performanceTrackerId: performanceTracker._id,
        }).then(() => {
            if (!trackerObj.error) {
                closeModal();
            }
        });
    };
    handleKeyBoard = (e: $TSFixMe) => {

        const { closeModal }: $TSFixMe = this.props;

        switch (e.key) {
            case 'Escape':
                return closeModal();
            case 'Enter': {
                if (this.state.confirmBoxHidden) {
                    return this.toggleConfirmationBox();
                } else {
                    return this.handleReset();
                }
            }
            default:
                return false;
        }
    };

    override render() {
        const { hidden }: $TSFixMe = this.state;

        const { data, closeModal, trackerObj }: $TSFixMe = this.props;
        const { currentProject, performanceTracker }: $TSFixMe = data;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeModal}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Performance Tracker Credentials
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--8 Padding-vertical--4">
                                        <p>
                                            <span>
                                                Use your performance tracker API
                                                ID and API Key to track requests
                                                from your apps to your OneUptime
                                                Dashboard
                                            </span>
                                        </p>
                                    </div>
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row Flex-flex Flex-direction--column">
                                                    <label className="bs-Fieldset-label">
                                                        Performance Tracker API
                                                        ID
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
                                                            {performanceTracker
                                                                ? performanceTracker._id
                                                                : 'LOADING...'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row Flex-flex Flex-direction--column">
                                                    <label className="bs-Fieldset-label">
                                                        Performance Tracker API
                                                        URL
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
                                                        Performance Tracker API
                                                        Key
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
                                                                id={`show_performance_tracker_key_${performanceTracker.name}`}
                                                            >
                                                                Click here to
                                                                reveal
                                                                Performance
                                                                Tracker API key
                                                            </span>
                                                        </ShouldRender>
                                                        <ShouldRender
                                                            if={!hidden}
                                                        >
                                                            <div className="Flex-flex">
                                                                <span
                                                                    id={`performance_tracker_key_${performanceTracker.name}`}
                                                                    className="value"
                                                                    style={{
                                                                        marginTop:
                                                                            '6px',
                                                                        fontWeight:
                                                                            'bold',
                                                                    }}
                                                                >
                                                                    {performanceTracker
                                                                        ? performanceTracker.key
                                                                        : 'LOADING...'}
                                                                </span>
                                                                <div
                                                                    onClick={
                                                                        this
                                                                            .changeAPIKeyVisualState
                                                                    }
                                                                    id={`hide_performance_tracker_key_${performanceTracker.name}`}
                                                                    className="Flex-flex Flex-alignItems--center Padding-left--8"
                                                                >
                                                                    <TooltipMini
                                                                        title="Hide API Key"
                                                                        content={
                                                                            <img
                                                                                alt="hide_performance_tracker_key"
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
                                                            Resetting the
                                                            Performance Tracker
                                                            API Key will break
                                                            all your existing
                                                            integrations with
                                                            the OneUptime
                                                            Performance Metrics
                                                            Library
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
                                            id={`cancel_performance_tracker_key_${performanceTracker.name}`}
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={closeModal}
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
                                                    id={`reset_performance_tracker_key_${performanceTracker.name}`}
                                                    className="bs-Button bs-Button--blue btn__modal"
                                                    onClick={
                                                        this
                                                            .toggleConfirmationBox
                                                    }
                                                    autoFocus={true}
                                                >
                                                    <ShouldRender
                                                        if={
                                                            !trackerObj.requesting
                                                        }
                                                    >
                                                        <span>
                                                            Reset API Key
                                                        </span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            trackerObj.requesting
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
                                                    id={`confirm_reset_performance_tracker_key_${performanceTracker.name}`}
                                                    className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                                    type="button"
                                                    onClick={() =>
                                                        this.handleReset()
                                                    }
                                                >
                                                    <ShouldRender
                                                        if={
                                                            !trackerObj.requesting
                                                        }
                                                    >
                                                        <span>YES, RESET</span>
                                                        <span className="delete-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </ShouldRender>
                                                    <ShouldRender
                                                        if={
                                                            trackerObj.requesting
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


TrackerInfo.displayName = 'TrackerInfo';


TrackerInfo.propTypes = {
    data: PropTypes.object,
    closeModal: PropTypes.func,
    trackerObj: PropTypes.object,
    resetPerformanceTrackerKey: PropTypes.func,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        trackerObj: state.performanceTracker.resetPerformanceTrackerKey,
        data: state.modal.modals[0],
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ resetPerformanceTrackerKey, closeModal }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(TrackerInfo);
