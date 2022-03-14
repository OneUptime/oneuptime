import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from '../../actions/modal';
import CreateSchedule from '../modals/CreateSchedule';
import DataPathHoC from '../DataPathHoC';
import { history } from '../../store';
import { capitalize } from '../../config';
import { ListLoader } from '../basic/Loader';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import Badge from '../common/Badge';
import MessageBox from '../modals/MessageBox';

class EventBox extends Component {
    limit: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            createScheduledEventModalId: uuidv4(),
        };
        this.limit = 10;
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleMonitorList = (monitors: $TSFixMe) => {
        if (monitors.length === 0) {
            return 'No monitor in this event';
        }
        if (monitors.length === 1) {
            return monitors[0].monitorId.name;
        }
        if (monitors.length === 2) {
            return `${monitors[0].monitorId.name} and ${monitors[1].monitorId.name}`;
        }
        if (monitors.length === 3) {
            return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name} and ${monitors[2].monitorId.name}`;
        }

        return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name
            } and ${monitors.length - 2} others`;
    };

    handleScheduledEventDetail = (scheduledEventSlug: $TSFixMe) => {
        history.push(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            `/dashboard/project/${this.props.slug}/scheduledEvents/${scheduledEventSlug}`
        );
    };

    handleKeyboard = (event: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalList' does not exist on type 'Reado... Remove this comment to see the full error message
        const { modalList, allScheduleEventLength } = this.props;

        if (allScheduleEventLength === 1) {
            if (event.target.localName === 'body' && event.key) {
                switch (event.key) {
                    case 'N':
                    case 'n':
                        if (modalList.length === 0) {
                            event.preventDefault();
                            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                            return document
                                .getElementById('addScheduledEventButton')
                                .click();
                        }
                        return false;
                    default:
                        return false;
                }
            }
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventModalId' does not ex... Remove this comment to see the full error message
        const { createScheduledEventModalId } = this.state;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
            scheduledEvents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type 'Readonly<... Remove this comment to see the full error message
            limit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            count,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            skip,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
            error,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchingMonitors' does not exist on type... Remove this comment to see the full error message
            fetchingMonitors,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            monitors,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentSubProject' does not exist on typ... Remove this comment to see the full error message
            currentSubProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'prevClicked' does not exist on type 'Rea... Remove this comment to see the full error message
            prevClicked,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextClicked' does not exist on type 'Rea... Remove this comment to see the full error message
            nextClicked,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'parentProjectId' does not exist on type ... Remove this comment to see the full error message
            parentProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'allScheduleEventLength' does not exist o... Remove this comment to see the full error message
            allScheduleEventLength,
        } = this.props;
        const footerBorderTopStyle = { margin: 0, padding: 0 };
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const numberOfPages = Math.ceil(parseInt(this.props.count) / 10);

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;
        let projectName = subProjects.find((obj: $TSFixMe) => obj._id === projectId)?.name;
        projectName = projectName
            ? projectName
            : currentProject
                ? currentProject.name
                : currentSubProject
                    ? currentSubProject.name
                    : '';

        const noMonitorMessage = (
            <span>
                No monitors added to this project yet. Please create one.
            </span>
        );

        return (
            <Fade>
                <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        style={{ textTransform: 'capitalize' }}
                                    >
                                        Scheduled Maintenance Event{' '}
                                        <span
                                            style={{
                                                textTransform: 'lowercase',
                                            }}
                                        >
                                            for
                                        </span>{' '}
                                        {currentProject?._id !== projectId
                                            ? projectName
                                            : currentProject.name}
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Scheduled Maintenance Event shows up on
                                        status pages and dashboard to let your
                                        team or customers know of any planned
                                        maintenance activity you have for{' '}
                                        {projectName}
                                    </span>
                                </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                <div className="Box-root">
                                    <ShouldRender
                                        if={
                                            !fetchingMonitors &&
                                            monitors.length > 0
                                        }
                                    >
                                        <button
                                            id="addScheduledEventButton"
                                            onClick={() => {
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                                this.props.openModal({
                                                    id: createScheduledEventModalId,
                                                    content: DataPathHoC(
                                                        CreateSchedule,
                                                        {
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
                                                {allScheduleEventLength ===
                                                    1 ? (
                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                        <span>
                                                            Create New Event
                                                        </span>
                                                        <span className="new-btn__keycode">
                                                            N
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                        <span>
                                                            Create New Event{' '}
                                                        </span>
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            !fetchingMonitors &&
                                            monitors.length === 0
                                        }
                                    >
                                        <button
                                            id="addScheduledEventButton"
                                            onClick={() => {
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                                this.props.openModal({
                                                    id: createScheduledEventModalId,
                                                    content: DataPathHoC(
                                                        MessageBox,
                                                        {
                                                            title:
                                                                'Create Scheduled Maintenance Event',
                                                            message: noMonitorMessage,
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
                                                {allScheduleEventLength ===
                                                    1 ? (
                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                        <span>
                                                            Create New Event
                                                        </span>
                                                        <span className="new-btn__keycode">
                                                            N
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                        <span>
                                                            Create New Event{' '}
                                                        </span>
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bs-ContentSection-content Box-root">
                        <div className="bs-ObjectList db-UserList">
                            <div
                                style={{
                                    overflow: 'hidden',
                                    overflowX: 'auto',
                                }}
                            >
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
                                            Monitor(s)
                                        </div>
                                        <div className="bs-ObjectList-cell">
                                            Start Date
                                        </div>
                                        <div className="bs-ObjectList-cell">
                                            End Date
                                        </div>
                                        <div
                                            className="bs-ObjectList-cell"
                                            style={{
                                                marginRight: '10px',
                                            }}
                                        >
                                            Status
                                        </div>
                                        <div
                                            className="bs-ObjectList-cell"
                                            style={{
                                                float: 'right',
                                                marginRight: '10px',
                                            }}
                                        >
                                            Action
                                        </div>
                                    </header>
                                    {scheduledEvents.length > 0 &&
                                        scheduledEvents.map(
                                            (scheduledEvent: $TSFixMe, index: $TSFixMe) => {
                                                const scheduleStatus = scheduledEvent.resolved ? (
                                                    <Badge color={'green'}>
                                                        Completed
                                                    </Badge>
                                                ) : scheduledEvent.cancelled ? (
                                                    <Badge color={'red'}>
                                                        Cancelled
                                                    </Badge>
                                                ) : !scheduledEvent.cancelled &&
                                                    !scheduledEvent.resolved ? (
                                                    moment() <
                                                        moment(
                                                            scheduledEvent.startDate
                                                        ) ? (
                                                        <Badge color={'blue'}>
                                                            Scheduled
                                                        </Badge>
                                                    ) : moment() >=
                                                        moment(
                                                            scheduledEvent.startDate
                                                        ) &&
                                                        moment() <
                                                        moment(
                                                            scheduledEvent.endDate
                                                        ) ? (
                                                        <Badge color={'yellow'}>
                                                            Ongoing
                                                        </Badge>
                                                    ) : moment() >
                                                        moment(
                                                            scheduledEvent.endDate
                                                        ) ? (
                                                        <Badge color={'blue'}>
                                                            Ended
                                                        </Badge>
                                                    ) : null
                                                ) : null;

                                                return (
                                                    <div
                                                        key={scheduledEvent._id}
                                                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                        style={{
                                                            backgroundColor:
                                                                'white',
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            this.handleScheduledEventDetail(
                                                                scheduledEvent.slug
                                                            );
                                                        }}
                                                    >
                                                        <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                            <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                                {
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                        .name
                                                                }
                                                            </div>
                                                            <div className="scheduled-event-name Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                {capitalize(
                                                                    scheduledEvent.name
                                                                )}{' '}
                                                                {scheduledEvent.recurring ? (
                                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-wrap--noWrap">
                                                                            <span>
                                                                                {
                                                                                    'Recurring Event'
                                                                                }
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div className="bs-ObjectList-cell-row">
                                                                {
                                                                    scheduledEvent
                                                                        .createdById
                                                                        .name
                                                                }
                                                            </div>
                                                        </div>
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div
                                                                className="bs-ObjectList-cell-row"
                                                                id={`monitor-${this.handleMonitorList(
                                                                    scheduledEvent.monitors
                                                                )}`}
                                                            >
                                                                {scheduledEvent.monitors &&
                                                                    this.handleMonitorList(
                                                                        scheduledEvent.monitors
                                                                    )}
                                                            </div>
                                                        </div>
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div className="bs-ObjectList-cell-row">
                                                                {moment(
                                                                    scheduledEvent.startDate
                                                                ).format(
                                                                    'MMMM Do YYYY, h:mm a'
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div className="bs-ObjectList-cell-row">
                                                                {moment(
                                                                    scheduledEvent.endDate
                                                                ).format(
                                                                    'MMMM Do YYYY, h:mm a'
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div className="Box-root">
                                                                {scheduleStatus}
                                                            </div>
                                                        </div>
                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                            <div className="Box-root">
                                                                <button
                                                                    id={`viewScheduledEvent_${index}`}
                                                                    title="view"
                                                                    className="bs-Button bs-DeprecatedButton"
                                                                    type="button"
                                                                    style={{
                                                                        float:
                                                                            'right',
                                                                        marginLeft: 10,
                                                                    }}
                                                                    onClick={e => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        this.handleScheduledEventDetail(
                                                                            scheduledEvent.slug
                                                                        );
                                                                    }}
                                                                >
                                                                    <span>
                                                                        View
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                        )}
                                    <ShouldRender
                                        if={
                                            !(
                                                (!scheduledEvents ||
                                                    scheduledEvents.length ===
                                                    0) &&
                                                !requesting &&
                                                !error
                                            )
                                        }
                                    >
                                        <div style={footerBorderTopStyle}></div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <ShouldRender if={fetchingMonitors && requesting}>
                                <ListLoader />
                            </ShouldRender>
                            {/* hide this from the view */}
                            <ShouldRender
                                if={
                                    !fetchingMonitors &&
                                    monitors.length === 0 &&
                                    false
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
                                        No monitors was added to this project.{' '}
                                        {parentProjectId ? (
                                            <Link
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                to={`/dashboard/project/${this.props.slug}/components`}
                                                style={{
                                                    textDecoration: 'underline',
                                                }}
                                            >
                                                Please create one.
                                            </Link>
                                        ) : (
                                            <Link
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                to={`/dashboard/project/${this.props.slug}/components`}
                                                style={{
                                                    textDecoration: 'underline',
                                                }}
                                            >
                                                Please create one.
                                            </Link>
                                        )}
                                    </span>
                                </div>
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    (!scheduledEvents ||
                                        scheduledEvents.length === 0) &&
                                    !requesting &&
                                    !error &&
                                    !fetchingMonitors
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
                                            ? 'You have no scheduled maintenance event at this time'
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
                                                {numberOfPages > 0
                                                    ? `Page ${
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'pages' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    !this.props.pages[
                                                        projectId
                                                    ]
                                                        ? 1
                                                        : this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'pages' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                            .pages[
                                                        projectId
                                                        ]
                                                    } of ${numberOfPages} (${
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    this.props.count
                                                    } Event${
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    this.props.count === 1
                                                        ? ''
                                                        : 's'
                                                    })`
                                                    : `${
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    this.props.count
                                                    } Event${
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    this.props.count === 1
                                                        ? ''
                                                        : 's'
                                                    }`}
                                            </span>
                                        </span>
                                    </span>
                                </div>
                                <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <div className="Box-root Margin-right--8">
                                            <button
                                                id="btnPrevSchedule"
                                                onClick={() =>
                                                    prevClicked(projectId, skip)
                                                }
                                                className={
                                                    'Button bs-ButtonLegacy' +
                                                    (canPrev
                                                        ? ''
                                                        : 'Is--disabled')
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
                                                onClick={() =>
                                                    nextClicked(projectId, skip)
                                                }
                                                className={
                                                    'Button bs-ButtonLegacy' +
                                                    (canNext
                                                        ? ''
                                                        : 'Is--disabled')
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
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
EventBox.displayName = 'EventBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
EventBox.propTypes = {
    openModal: PropTypes.func.isRequired,
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    count: PropTypes.number,
    name: PropTypes.string,
    slug: PropTypes.string,
    scheduledEvents: PropTypes.array,
    error: PropTypes.object,
    requesting: PropTypes.bool,
    projectId: PropTypes.string,
    fetchingMonitors: PropTypes.bool,
    monitors: PropTypes.array,
    currentProject: PropTypes.object,
    subProjects: PropTypes.array,
    prevClicked: PropTypes.func,
    nextClicked: PropTypes.func,
    parentProjectId: PropTypes.string,
    modalList: PropTypes.array,
    allScheduleEventLength: PropTypes.number,
    pages: PropTypes.object,
    currentSubProject: PropTypes.object,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        openModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const monitorData = state.monitor.monitorsList.monitors.find(
        (data: $TSFixMe) => String(data._id) === String(ownProps.projectId)
    );
    const monitors = monitorData.monitors;

    return {
        monitors,
        pages: state.scheduledEvent.pages,
        slug: state.project.currentProject && state.project.currentProject.slug,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(EventBox);
