import React, { Component } from 'react';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from '../../actions/modal';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DeleteSchedule from '../modals/DeleteSchedule';
import CancelSchedule from '../modals/CancelSchedule';
import DataPathHoC from '../DataPathHoC';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';

class ScheduleEventDeleteBox extends Component {
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
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteModalId' does not exist on type 'R... Remove this comment to see the full error message
        const { deleteModalId, cancelModalId } = this.state;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventId' does not exist on type... Remove this comment to see the full error message
            scheduledEventId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvent' does not exist on type '... Remove this comment to see the full error message
            scheduledEvent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleting' does not exist on type 'Readon... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ openModal }, dispatch);
const mapStateToProps = (state: $TSFixMe) => {
    return {
        deleting: state.scheduledEvent.deletedScheduledEvent.requesting,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ScheduleEventDeleteBox.propTypes = {
    projectId: PropTypes.string.isRequired,
    scheduledEventId: PropTypes.string.isRequired,
    deleting: PropTypes.bool,
    openModal: PropTypes.func.isRequired,
    scheduledEvent: PropTypes.object.isRequired,
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ScheduleEventDeleteBox.displayName = 'ScheduleEventDeleteBox';
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ScheduleEventDeleteBox);
