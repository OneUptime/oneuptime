import React, { Component } from 'react';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from 'CommonUI/actions/Modal';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { v4 as uuidv4 } from 'uuid';
import DeleteSchedule from '../Modals/DeleteSchedule';
import CancelSchedule from '../Modals/CancelSchedule';
import DataPathHoC from '../DataPathHoC';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';

export interface ComponentProps {
    projectId: string;
    scheduledEventId: string;
    deleting?: boolean;
    openModal: Function;
    scheduledEvent: object;
}

class ScheduleEventDeleteBox extends Component<ComponentProps> {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { deleteModalId: uuidv4(), cancelModalId: uuidv4() };
    }
    deleteScheduleEvent = () => {
        alert('im to delete');
    };

    cancelScheduleEvent = () => {
        alert('im to cancel');
    };
    override render() {

        const { deleteModalId, cancelModalId }: $TSFixMe = this.state;
        const {

            projectId,

            scheduledEventId,

            openModal,

            scheduledEvent,

            deleting,
        } = this.props;
        return (
            <div>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="Box-root Margin-bottom--12"
                >
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Cancel Scheduled Maintenance Event
                                        </span>
                                    </span>
                                    <p>
                                        <span>
                                            Click the button to cancel this
                                            scheduled maintenance event.
                                        </span>
                                    </p>
                                </div>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                    <span className="db-SettingsForm-footerMessage"></span>
                                    <div>
                                        {scheduledEvent.resolved ? (
                                            <button
                                                className="bs-Button"
                                                disabled
                                            >
                                                <span>
                                                    Event has been resolved
                                                </span>
                                            </button>
                                        ) : scheduledEvent.cancelled ? (
                                            <button
                                                className="bs-Button"
                                                disabled
                                            >
                                                <span>
                                                    Event has been cancelled
                                                </span>
                                            </button>
                                        ) : (
                                            <button
                                                className="bs-Button bs-Button--blue Box-background--blue"
                                                id={`cancelScheduleEvent`}
                                                onClick={() =>
                                                    openModal({
                                                        id: cancelModalId,
                                                        onClose: () => '',
                                                        onConfirm: () =>
                                                            this.cancelScheduleEvent(),
                                                        content: DataPathHoC(
                                                            CancelSchedule,
                                                            {
                                                                projectId,
                                                                eventId: scheduledEventId,
                                                            }
                                                        ),
                                                    })
                                                }
                                            >
                                                <ShouldRender if={!deleting}>
                                                    <span>Cancel</span>
                                                </ShouldRender>
                                                <ShouldRender if={deleting}>
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="Box-root Margin-bottom--12"
                ></div>
                {/* end cancel */}
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Delete Scheduled Maintenance Event
                                    </span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanently delete
                                        this scheduled maintenance event.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        id={`deleteScheduleEvent`}
                                        onClick={() =>
                                            openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.deleteScheduleEvent(),
                                                content: DataPathHoC(
                                                    DeleteSchedule,
                                                    {
                                                        projectId,
                                                        eventId: scheduledEventId,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
                                            <FormLoader />
                                        </ShouldRender>
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

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ openModal }, dispatch);
const mapStateToProps: Function = (state: RootState) => {
    return {
        deleting: state.scheduledEvent.deletedScheduledEvent.requesting,
    };
};


ScheduleEventDeleteBox.propTypes = {
    projectId: PropTypes.string.isRequired,
    scheduledEventId: PropTypes.string.isRequired,
    deleting: PropTypes.bool,
    openModal: PropTypes.func.isRequired,
    scheduledEvent: PropTypes.object.isRequired,
};

ScheduleEventDeleteBox.displayName = 'ScheduleEventDeleteBox';
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ScheduleEventDeleteBox);
