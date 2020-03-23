import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import moment from 'moment';
import ShouldRender from '../basic/ShouldRender';
import {
    fetchscheduledEvents,
    deleteScheduledEvent,
} from '../../actions/scheduledEvent';
import { openModal, closeModal } from '../../actions/modal';
import CreateSchedule from '../modals/CreateSchedule';
import EditSchedule from '../modals/EditSchedule';
import DataPathHoC from '../DataPathHoC';

export class ScheduledEventBox extends Component {
    constructor(props) {
        super(props);
        this.state = {
            createScheduledEventModalId: uuid.v4(),
        };
    }

    componentDidMount() {
        const projectId = this.props.monitor
            ? this.props.monitor.projectId._id || this.props.monitor.projectId
            : null;
        this.props.fetchscheduledEvents(
            projectId,
            this.props.monitor._id,
            0,
            5
        );
    }

    prevClicked = () => {
        const projectId = this.props.monitor
            ? this.props.monitor.projectId._id || this.props.monitor.projectId
            : null;
        this.props.fetchscheduledEvents(
            projectId,
            this.props.monitor._id,
            this.props.skip ? parseInt(this.props.skip, 10) - 5 : 5,
            5
        );
    };

    nextClicked = () => {
        const projectId = this.props.monitor
            ? this.props.monitor.projectId._id || this.props.monitor.projectId
            : null;
        this.props.fetchscheduledEvents(
            projectId,
            this.props.monitor._id,
            this.props.skip ? parseInt(this.props.skip, 10) + 5 : 5,
            5
        );
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: this.state.createScheduledEventModalId,
                });
            default:
                return false;
        }
    };

    render() {
        const { createScheduledEventModalId } = this.state;
        const {
            scheduledEvents,
            limit,
            count,
            skip,
            profileSettings,
            error,
            requesting,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };

        const canNext = count > parseInt(skip) + parseInt(limit) ? true : false;
        const canPrev = parseInt(skip) <= 0 ? false : true;
        const projectId = this.props.monitor
            ? this.props.monitor.projectId._id || this.props.monitor.projectId
            : null;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Scheduled Events</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Scheduled events for this monitor. Click on
                                    event name to edit.
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    id="addScheduledEventButton"
                                    onClick={() => {
                                        this.props.openModal({
                                            id: createScheduledEventModalId,
                                            content: DataPathHoC(
                                                CreateSchedule,
                                                {
                                                    monitorId: this.props
                                                        .monitor._id,
                                                    projectId,
                                                }
                                            ),
                                        });
                                    }}
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                >
                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <div className="Box-root Margin-right--8">
                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                        </div>
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>
                                                Create New Scheduled Event
                                            </span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bs-ContentSection-content Box-root">
                    <div className="bs-ObjectList db-UserList">
                        <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                            <div
                                id="scheduledEventsList"
                                className="bs-ObjectList-rows"
                            >
                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                    <div className="bs-ObjectList-cell">
                                        Event
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Created by
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Start Date
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        End Date
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Action
                                    </div>
                                </header>
                                {scheduledEvents.length > 0 &&
                                    scheduledEvents.map(scheduledEvent => (
                                        <div
                                            key={scheduledEvent._id}
                                            className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                            style={{ backgroundColor: 'white' }}
                                        >
                                            <div
                                                onClick={() =>
                                                    this.props.openModal({
                                                        id: createScheduledEventModalId,
                                                        content: EditSchedule,
                                                        event: scheduledEvent,
                                                    })
                                                }
                                                className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent db-ListViewItem--hasLink"
                                            >
                                                <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                    {this.props.name}
                                                </div>
                                                <div className="scheduled-event-name Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    {scheduledEvent.name}
                                                </div>
                                            </div>
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="bs-ObjectList-cell-row">
                                                    {
                                                        scheduledEvent
                                                            .createdById.name
                                                    }
                                                </div>
                                            </div>
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="bs-ObjectList-cell-row">
                                                    {moment(
                                                        scheduledEvent.startDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm a'
                                                    )}
                                                    <br />
                                                    <strong>
                                                        {
                                                            profileSettings.timezone
                                                        }
                                                    </strong>
                                                </div>
                                            </div>
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <div className="bs-ObjectList-cell-row">
                                                    {moment(
                                                        scheduledEvent.endDate
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm a'
                                                    )}
                                                    <br />
                                                    <strong>
                                                        {
                                                            profileSettings.timezone
                                                        }
                                                    </strong>
                                                </div>
                                            </div>
                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                <button
                                                    onClick={() =>
                                                        this.props.deleteScheduledEvent(
                                                            this.props
                                                                .currentProject
                                                                ._id,
                                                            scheduledEvent._id
                                                        )
                                                    }
                                                    className="Button bs-ButtonLegacy delete-schedule"
                                                    type="button"
                                                >
                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                            <span>Delete</span>
                                                        </span>
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                <ShouldRender
                                    if={
                                        !(
                                            (!scheduledEvents ||
                                                scheduledEvents.length === 0) &&
                                            !requesting &&
                                            !error
                                        )
                                    }
                                >
                                    <div style={footerBorderTopStyle}></div>
                                </ShouldRender>
                            </div>
                        </div>
                        <ShouldRender
                            if={
                                (!scheduledEvents ||
                                    scheduledEvents.length === 0) &&
                                !requesting &&
                                !error
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '20px 10px 0',
                                }}
                            >
                                <span>
                                    {(!scheduledEvents ||
                                        scheduledEvents.length === 0) &&
                                    !requesting &&
                                    !error
                                        ? 'You have no scheduled event at this time'
                                        : null}
                                    {error ? error : null}
                                </span>
                            </div>
                        </ShouldRender>
                        <div
                            className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                            style={{ backgroundColor: 'white' }}
                        >
                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        <span
                                            id="scheduledEventCount"
                                            className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                        >
                                            {this.props.count
                                                ? this.props.count +
                                                  (this.props.count > 1
                                                      ? '  Events'
                                                      : ' Event')
                                                : '0 Scheduled Event'}
                                        </span>
                                    </span>
                                </span>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevSchedule"
                                            onClick={() => this.prevClicked()}
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canPrev ? '' : 'Is--disabled')
                                            }
                                            disabled={!canPrev}
                                            data-db-analytics-name="list_view.pagination.previous"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>Previous</span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div className="Box-root">
                                        <button
                                            id="btnNextSchedule"
                                            onClick={() => this.nextClicked()}
                                            className={
                                                'Button bs-ButtonLegacy' +
                                                (canNext ? '' : 'Is--disabled')
                                            }
                                            disabled={!canNext}
                                            data-db-analytics-name="list_view.pagination.next"
                                            type="button"
                                        >
                                            <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span>Next</span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ScheduledEventBox.displayName = 'ScheduledEventBox';

ScheduledEventBox.propTypes = {
    monitor: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    fetchscheduledEvents: PropTypes.func.isRequired,
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    count: PropTypes.number,
    name: PropTypes.string,
    deleteScheduledEvent: PropTypes.func.isRequired,
    scheduledEvents: PropTypes.array,
    profileSettings: PropTypes.object,
    error: PropTypes.object,
    requesting: PropTypes.bool,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { fetchscheduledEvents, deleteScheduledEvent, openModal, closeModal },
        dispatch
    );

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
        scheduledEvents:
            state.scheduledEvent.scheduledEventList.scheduledEvents,
        requesting: state.scheduledEvent.scheduledEventList.requesting,
        count: state.scheduledEvent.scheduledEventList.count,
        limit: state.scheduledEvent.scheduledEventList.limit,
        skip: state.scheduledEvent.scheduledEventList.skip,
        error: state.scheduledEvent.scheduledEventList.error,
        profileSettings: state.profileSettings.profileSetting.data,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEventBox);
