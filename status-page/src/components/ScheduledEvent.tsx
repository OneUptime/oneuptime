import React, { Component } from 'react';
import { connect } from 'react-redux';

import { Translate } from 'react-auto-translate';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import Markdown from 'markdown-to-jsx';
import ShouldRender from './ShouldRender';
import {
    fetchEventNote,
    getStatusPage,
    fetchEvent,
    moreEventNote,
} from '../actions/status';
import { ACCOUNTS_URL } from '../config';
import { ListLoader } from './basic/Loader';
import AffectedResources from './basic/AffectedResources';

import { Link } from 'react-router-dom';

class ScheduledEvent extends Component {
    componentDidMount() {
        const {

            match: { params },

            fetchEventNote,

            statusData,

            fetchEvent,
        } = this.props;
        const { eventId } = params;

        if (
            window.location.search.substring(1) &&
            window.location.search.substring(1) === 'embedded=true'
        ) {
            document.getElementsByTagName('html')[0].style.background =
                'none transparent';
        }

        let url, statusPageSlug;

        if (
            window.location.pathname.includes('/status-page/') &&
            window.location.pathname.split('/').length >= 3
        ) {
            statusPageSlug = window.location.pathname.split('/')[2];
            url = 'null';
        } else if (
            window.location.href.indexOf('localhost') > -1 ||
            window.location.href.indexOf('oneuptimeapp.com') > 0
        ) {
            statusPageSlug = window.location.host.split('.')[0];
            url = 'null';
        } else {
            statusPageSlug = 'null';
            url = window.location.host;
        }


        this.props.getStatusPage(statusPageSlug, url).catch((err: $TSFixMe) => {
            if (err.message === 'Request failed with status code 401') {

                const { loginRequired } = this.props.login;
                if (loginRequired) {

                    window.location = `${ACCOUNTS_URL}/login?statusPage=true&statusPageURL=${window.location.href}`;
                }
            }
        });

        if (statusData && statusData._id) {
            // fetch a particular scheduled event
            fetchEvent(statusData.projectId._id, eventId);
            // fetch scheduled event note
            fetchEventNote(statusData.projectId._id, eventId, 'investigation');
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        const {

            match: { params },

            fetchEventNote,

            statusData,

            fetchEvent,
        } = this.props;
        const { eventId } = params;

        if (prevProps.statusData._id !== statusData._id) {
            // fetch a particular scheduled event
            fetchEvent(statusData.projectId._id, eventId);
            // fetch scheduled event note
            fetchEventNote(statusData.projectId._id, eventId, 'investigation');
        }
    }

    more() {
        const {

            moreEventNote,

            statusData,

            match: { params },

            skip,
        } = this.props;
        const { eventId } = params;

        moreEventNote(
            statusData.projectId._id,
            eventId,
            'investigation',
            skip + 1
        );
    }

    renderError = () => {

        const { error } = this.props.status;
        if (error === 'Input data schema mismatch.') {
            return 'Page Not Found';
        } else if (error === 'Project Not present') {
            return 'Invalid Project.';
        } else return error;
    };

    AffectedResources = ({
        event,
        monitorState
    }: $TSFixMe) => {
        const affectedMonitors: $TSFixMe = [];
        let monitorCount = 0;

        const eventMonitors: $TSFixMe = [];
        // populate the ids of the event monitors in an array
        event &&
            event.monitors &&
            event.monitors.map((monitor: $TSFixMe) => {
                eventMonitors.push(String(monitor.monitorId._id));
                return monitor;
            });

        monitorState.map((monitor: $TSFixMe) => {
            if (eventMonitors.includes(String(monitor._id))) {
                affectedMonitors.push(monitor);
                monitorCount += 1;
            }
            return monitor;
        });
        // check if the length of monitors on status page equals the monitor count
        // if they are equal then all the monitors in status page is in a particular scheduled event
        if (monitorCount === monitorState.length) {
            return (
                <>
                    <span
                        style={{
                            fontWeight: 600,
                        }}
                    >
                        <Translate>Resource Affected - </Translate>
                    </span>{' '}
                    <span>
                        <Translate> All resources are affected</Translate>
                    </span>
                </>
            );
        } else {
            return <>
                <span
                    style={{
                        fontWeight: 600,
                    }}
                >
                    <Translate>Resource Affected:</Translate>
                </span>{' '}
                <span>
                    {affectedMonitors

                        .map(monitor => monitor.name)
                        .join(', ')
                        .replace(/, ([^,]*)$/, ' and $1')}
                </span>
            </>;
        }
    };

    render() {
        const {

            fetchingNotes,

            fetchingEvent,

            scheduledEvent,

            eventNotes,

            count,

            history,

            monitorState,

            match,

            statusData,
        } = this.props;
        const error = this.renderError();

        const { params } = match;
        const statusPageUrl = `/status-page/${params.statusPageSlug}`;

        const currentTime = moment();

        return (
            <div
                className="page-main-wrapper"
                style={{ background: 'rgb(247, 247, 247)' }}
            >
                {statusData.theme === 'Clean Theme' && (
                    <div
                        className="new-main-container"
                        style={{
                            maxWidth: 600,
                            margin: 'auto',
                            marginTop: 70,
                            marginBottom: 70,
                        }}
                    >
                        <div style={{ marginBottom: 50 }}>
                            <div>
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <header
                                        className="feed-title"
                                        style={{
                                            fontWeight: 'bold',
                                            textAlign: 'center',
                                            fontSize: 30,
                                            // textTransform: 'unset',
                                        }}
                                    >
                                        {scheduledEvent.name}
                                    </header>
                                </div>
                                <p
                                    style={{
                                        textAlign: 'center',
                                        fontWeight: '500',
                                        marginBottom: 10,
                                        color: 'rgba(0, 0, 0, 0.6)',
                                        fontSize: 25,
                                    }}
                                >
                                    Scheduled Maintenance Report for{' '}
                                    <Link
                                        style={{ color: 'rgba(0, 0, 0, 0.6)' }}
                                        to={`/status-page/${statusData.slug}`}
                                    >
                                        {statusData.name}
                                    </Link>
                                </p>
                            </div>
                            <ShouldRender if={fetchingEvent}>
                                <ListLoader />
                            </ShouldRender>
                            {!fetchingNotes &&
                                eventNotes &&
                                !fetchingEvent &&
                                scheduledEvent.startDate &&
                                scheduledEvent.endDate && (
                                    <span
                                        style={{
                                            fontSize: 14,
                                            color: '#AAA',
                                            display: 'block',
                                            textAlign: 'center',
                                        }}
                                    >
                                        <span
                                            className="time"
                                            style={{
                                                color: 'rgba(0, 0, 0, 0.5)',
                                            }}
                                        >
                                            {moment(
                                                scheduledEvent.startDate
                                            ).format('MMMM Do YYYY, h:mm a')}
                                            &nbsp;&nbsp;-&nbsp;&nbsp;
                                            {moment(
                                                scheduledEvent.endDate
                                            ).format('MMMM Do YYYY, h:mm a')}
                                        </span>
                                    </span>
                                )}
                        </div>
                        <div>
                            <ShouldRender if={fetchingNotes}>
                                <ListLoader />
                            </ShouldRender>
                            {!fetchingNotes &&
                                eventNotes &&
                                eventNotes.length > 0 &&
                                eventNotes
                                    .sort((a: $TSFixMe, b: $TSFixMe) => {
                                        (a = moment(a.createdAt)),
                                            (b = moment(b.createdAt));
                                        // order in ascending order
                                        if (b.diff(a) > 0) {
                                            return -1;
                                        } else if (b.diff(a) < 0) {
                                            return 1;
                                        } else {
                                            return 0;
                                        }
                                    })
                                    .map((note: $TSFixMe) => <div
                                        key={note._id}
                                        style={{
                                            width: '100%',
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 3fr',
                                            gridColumnGap: 10,
                                            marginTop: 20,
                                        }}
                                    >
                                        <div>
                                            <span
                                                style={{
                                                    display: 'block',
                                                    fontWeight: 'bold',
                                                    textTransform:
                                                        'capitalize',
                                                }}
                                            >
                                                {note.event_state}
                                            </span>
                                        </div>
                                        <div>
                                            <span
                                                style={{
                                                    color:
                                                        'rgba(0, 0, 0, 0.6)',
                                                    fontSize: 14,
                                                    display: 'block',
                                                    textAlign: 'justify',
                                                    whiteSpace: 'pre-wrap',
                                                }}
                                            >
                                                {note.content &&
                                                    note.content
                                                        .split('\n')
                                                        .map(
                                                            (
                                                                elem: $TSFixMe,
                                                                index: $TSFixMe
                                                            ) => (
                                                                <Markdown
                                                                    key={`${elem}-${index}`}
                                                                    options={{
                                                                        forceBlock: true,
                                                                    }}
                                                                >
                                                                    {elem}
                                                                </Markdown>
                                                            )
                                                        )}
                                            </span>
                                            {note.event_state ===
                                                'Created' && (
                                                    <span
                                                        style={{
                                                            display: 'block',
                                                            marginTop: 10,
                                                            color: '#AAA',
                                                            fontSize: 12,
                                                        }}
                                                    >
                                                        {this.AffectedResources(
                                                            {
                                                                event: scheduledEvent,
                                                                monitorState: monitorState,
                                                            }
                                                        )}
                                                    </span>
                                                )}
                                            <span
                                                style={{
                                                    display: 'flex',
                                                    marginTop: 5,
                                                    alignItems: 'center',
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        color: '#AAA',
                                                        fontSize: 12,
                                                        display: 'block',
                                                    }}
                                                >
                                                    Posted on{' '}
                                                    {moment(
                                                        note.createdAt
                                                    ).format(
                                                        'MMMM Do YYYY, h:mm a'
                                                    )}
                                                </span>
                                            </span>
                                        </div>
                                    </div>)}

                            {!fetchingNotes &&
                                eventNotes &&
                                eventNotes.length === 0 && (
                                    <div
                                        className="feed-item clearfix"
                                        style={{
                                            minHeight: '5px',
                                            marginBottom: '10px',
                                            display: 'flex',
                                            flexDirection: 'row',
                                            flexWrap: 'nowrap',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <span
                                            className="time"
                                            style={{
                                                fontSize: '0.8em',
                                                marginLeft: '0px',
                                                color: 'rgb(76, 76, 76)',
                                            }}
                                        >
                                            <Translate>
                                                No scheduled event updates yet.
                                            </Translate>
                                        </span>
                                    </div>
                                )}
                        </div>
                    </div>
                )}
                <div className="innernew" id="scheduledEventPage">
                    {statusData.theme === 'Classic Theme' && (
                        <>
                            <div
                                id="scheduledEvents"
                                className="twitter-feed white box"
                                style={{ overflow: 'visible' }}
                            >
                                <div
                                    className="messages"
                                    style={{
                                        position: 'relative',
                                    }}
                                >
                                    <div
                                        className="box-inner"
                                        style={{
                                            paddingTop: 20,
                                            paddingBottom: 20,
                                        }}
                                    >
                                        <span
                                            style={{
                                                color: 'rgba(76, 76, 76, 0.52)',
                                                textTransform: 'uppercase',
                                                fontWeight: '700',
                                                display: 'inline-block',
                                                marginBottom: 20,
                                                fontSize: 14,
                                            }}
                                        >
                                            <Translate>
                                                {' '}
                                                Scheduled Event
                                            </Translate>
                                        </span>
                                        {!fetchingEvent && scheduledEvent.name && (
                                            <>
                                                <div
                                                    className="individual-header"
                                                    style={{
                                                        marginBottom: scheduledEvent.description
                                                            ? 25
                                                            : 10,
                                                    }}
                                                >
                                                    <span
                                                        className="feed-title"
                                                        style={{
                                                            color:
                                                                'rgba(76, 76, 76, 0.8)',
                                                            fontWeight: 'bold',
                                                            marginBottom: 10,
                                                        }}
                                                    >
                                                        {scheduledEvent.name}
                                                    </span>
                                                    <span
                                                        style={{
                                                            color:
                                                                'rgba(0, 0, 0, 0.5)',
                                                        }}
                                                    >
                                                        {
                                                            scheduledEvent.description
                                                        }
                                                    </span>
                                                </div>
                                                <div
                                                    className="ongoing__affectedmonitor"
                                                    style={{ marginTop: 0 }}
                                                >
                                                    <AffectedResources
                                                        event={scheduledEvent}
                                                        monitorState={
                                                            monitorState
                                                        }
                                                        colorStyle="grey"
                                                    />
                                                </div>
                                            </>
                                        )}
                                        <ShouldRender if={fetchingEvent}>
                                            <ListLoader />
                                        </ShouldRender>
                                        {!fetchingNotes &&
                                            eventNotes &&
                                            !fetchingEvent &&
                                            scheduledEvent.startDate &&
                                            scheduledEvent.endDate && (
                                                <span style={{ fontSize: 12 }}>
                                                    <span
                                                        className="time"
                                                        style={{
                                                            color:
                                                                'rgba(0, 0, 0, 0.5)',
                                                        }}
                                                    >
                                                        {moment(
                                                            scheduledEvent.startDate
                                                        ).format(
                                                            'MMMM Do YYYY, h:mm a'
                                                        )}
                                                        &nbsp;&nbsp;-&nbsp;&nbsp;
                                                        {moment(
                                                            scheduledEvent.endDate
                                                        ).format(
                                                            'MMMM Do YYYY, h:mm a'
                                                        )}
                                                    </span>
                                                    {scheduledEvent.cancelled ? (
                                                        <div
                                                            style={{
                                                                marginLeft: 15,
                                                                padding:
                                                                    '2px 10px',
                                                                fontWeight:
                                                                    '600',
                                                            }}
                                                            className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                        >
                                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--10 Text-fontWeight--bold Text-lineHeight--14 Text-typeface--upper Text-wrap--noWrap">
                                                                <span id="ongoing-event">
                                                                    <Translate>
                                                                        Cancelled
                                                                    </Translate>
                                                                </span>
                                                            </span>
                                                        </div>
                                                    ) : scheduledEvent.resolved ? (
                                                        <div
                                                            style={{
                                                                marginLeft: 15,
                                                                padding:
                                                                    '2px 10px',
                                                                fontWeight:
                                                                    '600',
                                                            }}
                                                            className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                        >
                                                            <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--10 Text-fontWeight--bold Text-lineHeight--14 Text-typeface--upper Text-wrap--noWrap">
                                                                <span id="ongoing-event">
                                                                    <Translate>
                                                                        Completed
                                                                    </Translate>
                                                                </span>
                                                            </span>
                                                        </div>
                                                    ) : currentTime.isSameOrAfter(
                                                        moment(
                                                            scheduledEvent.startDate
                                                        )
                                                    ) &&
                                                        currentTime.isBefore(
                                                            moment(
                                                                scheduledEvent.endDate
                                                            )
                                                        ) ? (
                                                        <div
                                                            style={{
                                                                marginLeft: 15,
                                                                padding:
                                                                    '2px 10px',
                                                                fontWeight:
                                                                    '600',
                                                            }}
                                                            className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                        >
                                                            <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--10 Text-fontWeight--bold Text-lineHeight--14 Text-typeface--upper Text-wrap--noWrap">
                                                                <span id="ongoing-event">
                                                                    <Translate>
                                                                        Ongoing
                                                                    </Translate>
                                                                </span>
                                                            </span>
                                                        </div>
                                                    ) : currentTime.isBefore(
                                                        moment(
                                                            scheduledEvent.startDate
                                                        )
                                                    ) ? (
                                                        <div
                                                            style={{
                                                                marginLeft: 15,
                                                                padding:
                                                                    '2px 10px',
                                                                fontWeight:
                                                                    '600',
                                                            }}
                                                            className="Badge Badge--color--blue Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                        >
                                                            <span className="Badge-text Text-color--default Text-display--inline Text-fontSize--10 Text-fontWeight--bold Text-lineHeight--14 Text-typeface--upper Text-wrap--noWrap">
                                                                <span id="ongoing-event">
                                                                    <Translate>
                                                                        Scheduled
                                                                    </Translate>
                                                                </span>
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        currentTime.isSameOrAfter(
                                                            moment(
                                                                scheduledEvent.endDate
                                                            )
                                                        ) && (
                                                            <div
                                                                style={{
                                                                    marginLeft: 15,
                                                                    padding:
                                                                        '2px 10px',
                                                                    fontWeight:
                                                                        '600',
                                                                }}
                                                                className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                            >
                                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--10 Text-fontWeight--bold Text-lineHeight--14 Text-typeface--upper Text-wrap--noWrap">
                                                                    <span id="ongoing-event">
                                                                        <Translate>
                                                                            Ended
                                                                        </Translate>
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        )
                                                    )}
                                                </span>
                                            )}
                                    </div>
                                </div>
                            </div>

                            <div
                                id="scheduledEventNotes"
                                className="twitter-feed white box"
                                style={{ overflow: 'visible' }}
                            >
                                <div
                                    className="messages"
                                    style={{ position: 'relative' }}
                                >
                                    <div className="box-inner">
                                        <ShouldRender if={!fetchingNotes}>
                                            <div className="individual-header">
                                                <span
                                                    className="feed-title"
                                                    style={{
                                                        color:
                                                            'rgba(76, 76, 76, 0.8)',
                                                        fontWeight: 'bold',
                                                    }}
                                                >
                                                    <Translate>
                                                        {' '}
                                                        Scheduled Event Updates
                                                    </Translate>
                                                </span>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender if={fetchingNotes}>
                                            <ListLoader />
                                        </ShouldRender>
                                        <ul className="feed-contents plain">
                                            {!fetchingNotes &&
                                                eventNotes &&
                                                eventNotes.length > 0 &&
                                                eventNotes.map((note: $TSFixMe) => <li
                                                    key={note._id}
                                                    className="feed-item clearfix"
                                                >
                                                    <div
                                                        className="message"
                                                        style={{
                                                            width: '100%',
                                                            marginLeft: 0,
                                                            background:
                                                                'rgb(247, 247, 247)',
                                                        }}
                                                    >
                                                        <div className="note__wrapper">
                                                            <span
                                                                style={{
                                                                    color:
                                                                        'rgba(0, 0, 0, 0.5)',
                                                                    fontSize: 14,
                                                                    display:
                                                                        'block',
                                                                    textAlign:
                                                                        'justify',
                                                                    whiteSpace:
                                                                        'pre-wrap',
                                                                }}
                                                            >
                                                                {note.content &&
                                                                    note.content
                                                                        .split(
                                                                            '\n'
                                                                        )
                                                                        .map(
                                                                            (
                                                                                elem: $TSFixMe,
                                                                                index: $TSFixMe
                                                                            ) => (
                                                                                <Markdown
                                                                                    key={`${elem}-${index}`}
                                                                                    options={{
                                                                                        forceBlock: true,
                                                                                    }}
                                                                                >
                                                                                    {
                                                                                        elem
                                                                                    }
                                                                                </Markdown>
                                                                            )
                                                                        )}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    display:
                                                                        'flex',
                                                                    alignItems:
                                                                        'center',
                                                                    marginTop: 15,
                                                                }}
                                                            >
                                                                <span
                                                                    style={{
                                                                        color:
                                                                            'rgba(0, 0, 0, 0.5)',
                                                                        fontSize: 12,
                                                                        display:
                                                                            'block',
                                                                    }}
                                                                >
                                                                    <Translate>
                                                                        {' '}
                                                                        Posted
                                                                        on
                                                                    </Translate>{' '}
                                                                    {moment(
                                                                        note.createdAt
                                                                    ).format(
                                                                        'MMMM Do YYYY, h:mm a'
                                                                    )}
                                                                </span>
                                                                <span
                                                                    style={{
                                                                        marginLeft: 15,
                                                                    }}
                                                                    className="note-badge badge badge__color--green"
                                                                >
                                                                    {
                                                                        note.event_state
                                                                    }
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                </li>)}

                                            {!fetchingNotes &&
                                                eventNotes &&
                                                eventNotes.length === 0 && (
                                                    <li
                                                        className="feed-item clearfix"
                                                        style={{
                                                            minHeight: '5px',
                                                            marginBottom:
                                                                '10px',
                                                            display: 'flex',
                                                            flexDirection:
                                                                'row',
                                                            flexWrap: 'nowrap',
                                                            justifyContent:
                                                                'center',
                                                        }}
                                                    >
                                                        <span
                                                            className="time"
                                                            style={{
                                                                fontSize:
                                                                    '0.8em',
                                                                marginLeft:
                                                                    '0px',
                                                                color:
                                                                    'rgb(76, 76, 76)',
                                                            }}
                                                        >
                                                            <Translate>
                                                                {' '}
                                                                No schedule
                                                                event updates
                                                                yet.
                                                            </Translate>
                                                        </span>
                                                    </li>
                                                )}
                                        </ul>
                                    </div>
                                    <ShouldRender
                                        if={
                                            eventNotes.length &&
                                            count > eventNotes.length &&
                                            !fetchingNotes
                                        }
                                    >
                                        <button
                                            className="more button-as-anchor anchor-centered"
                                            onClick={() => this.more()}
                                        >
                                            <Translate> More</Translate>
                                        </button>
                                    </ShouldRender>
                                </div>
                            </div>
                        </>
                    )}

                    <ShouldRender if={fetchingEvent}>
                        <div
                            id="app-loading"
                            style={{
                                position: 'fixed',
                                top: '0',
                                bottom: '0',
                                left: '0',
                                right: '0',
                                backgroundColor: '#fdfdfd',
                                zIndex: '999',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}
                        >
                            <div style={{ transform: 'scale(2)' }}>
                                <svg
                                    viewBox="0 0 24 24"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="bs-Spinner-svg"
                                >
                                    <ellipse
                                        cx="12"
                                        cy="12"
                                        rx="10"
                                        ry="10"
                                        className="bs-Spinner-ellipse"
                                    ></ellipse>
                                </svg>
                            </div>
                        </div>
                    </ShouldRender>
                    <div
                        id="footer"
                        style={{ display: 'flex', alignItems: 'center' }}
                    >
                        <span
                            onClick={() => history.push(statusPageUrl)}
                            className="sp__icon sp__icon--back"
                            style={{
                                color: 'rgb(76, 76, 76)',
                                cursor: 'pointer',
                                width: '100%',
                            }}
                        >
                            <Translate> Back to status page</Translate>
                        </span>
                        <p>
                            <a
                                href="https://oneuptime.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'rgb(76, 76, 76)' }}
                            >
                                <Translate>Powered by</Translate> OneUptime
                            </a>
                        </p>
                    </div>
                    <ShouldRender if={error}>
                        <div id="app-loading">
                            <div>
                                <Translate>{error}</Translate>
                            </div>
                        </div>
                    </ShouldRender>
                </div>
            </div>
        );
    }
}


ScheduledEvent.displayName = 'ScheduledEvent';


ScheduledEvent.propTypes = {
    fetchEventNote: PropTypes.func,
    match: PropTypes.object,
    fetchingNotes: PropTypes.bool,
    statusData: PropTypes.object,
    getStatusPage: PropTypes.func,
    login: PropTypes.object.isRequired,
    fetchEvent: PropTypes.func,
    fetchingEvent: PropTypes.bool,
    scheduledEvent: PropTypes.object,
    eventNotes: PropTypes.array,
    moreEventNote: PropTypes.func,
    count: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    history: PropTypes.object,
    monitorState: PropTypes.array,
    status: PropTypes.object,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        fetchingNotes: state.status.eventNoteList.requesting,
        statusData: state.status.statusPage,
        login: state.login,
        fetchingEvent: state.status.scheduledEvent.requesting,
        scheduledEvent: state.status.scheduledEvent.event,
        eventNotes: state.status.eventNoteList.eventNotes,
        count: state.status.eventNoteList.count,
        skip: state.status.eventNoteList.skip,
        monitorState: state.status.statusPage.monitorsData,
        status: state.status,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    { fetchEventNote, getStatusPage, fetchEvent, moreEventNote },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(ScheduledEvent);
