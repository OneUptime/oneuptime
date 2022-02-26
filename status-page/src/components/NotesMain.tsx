import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import Markdown from 'markdown-to-jsx';
import Notes from './Notes';
import ShouldRender from './ShouldRender';
import SubscribeBox from './Subscribe/SubscribeBox';

import {
    getStatusPageNote,
    getStatusPageIndividualNote,
    getMoreNote,
    fetchLastIncidentTimelines,
    showIncidentCard,
} from '../actions/status';

import { openSubscribeMenu } from '../actions/subscribe';
import { capitalize } from '../config';
import Badge from './basic/Badge';
const countNum = 10;

class NotesMain extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.getAll = this.getAll.bind(this);
        this.more = this.more.bind(this);
        this.subscribebutton = this.subscribebutton.bind(this);
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        if (prevProps.statusPage !== this.props.statusPage) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
            if (this.props.individualnote) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getStatusPageIndividualNote' does not ex... Remove this comment to see the full error message
                this.props.getStatusPageIndividualNote(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                    this.props.individualnote._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                    this.props.individualnote.date,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                    this.props.individualnote.name,
                    true
                );
            }
        }
    }

    getAll = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showIncidentCard' does not exist on type... Remove this comment to see the full error message
        this.props.showIncidentCard(true);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getStatusPageNote' does not exist on typ... Remove this comment to see the full error message
        this.props.getStatusPageNote(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
            this.props.statusPageSlug,
            0
        );
    };

    more = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getMoreNote' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.getMoreNote(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
            this.props.statusPageSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            this.props.skip + 5
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLastIncidentTimelines' does not exi... Remove this comment to see the full error message
        this.props.fetchLastIncidentTimelines(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
            this.props.statusPageSlug
        );
    };

    subscribebutton = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSubscribeMenu' does not exist on typ... Remove this comment to see the full error message
        this.props.openSubscribeMenu();
    };

    handleIncidentStatus = (incident: $TSFixMe, timelines: $TSFixMe) => {
        let incidentTimeline = null,
            timelineStatus = null;

        if (timelines && Array.isArray(timelines) && timelines.length > 0) {
            timelines.map(timeline => {
                if (String(incident._id) === String(timeline.incidentId)) {
                    incidentTimeline = timeline;
                }
                return timeline;
            });
        }

        if (incidentTimeline) {
            if (incident.resolved) {
                timelineStatus = (
                    <Badge backgroundColor={'#fff'} fontColor={'#49c3b1'}>
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element' is not assignable to type 'string |... Remove this comment to see the full error message
                        <Translate>Resolved</Translate>
                    </Badge>
                );
            }

            if (
                incident.acknowledged &&
                !incident.resolved &&
                incident.incidentType
            ) {
                timelineStatus = (
                    <Badge
                        backgroundColor={'#fff'}
                        fontColor={
                            incident.incidentType === 'degraded'
                                ? 'rgb(227, 159, 72)'
                                : 'rgb(250, 109, 70)'
                        }
                    >
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element' is not assignable to type 'string |... Remove this comment to see the full error message
                        <Translate>Acknowledged</Translate>
                    </Badge>
                );
            }
            if (
                !incident.resolved &&
                !incident.acknowledged &&
                incident.incidentType
            ) {
                timelineStatus = (
                    <Badge
                        backgroundColor={'#fff'}
                        fontColor={
                            incident.incidentType === 'degraded'
                                ? 'rgb(227, 159, 72)'
                                : 'rgb(250, 109, 70)'
                        }
                    >
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element' is not assignable to type 'string |... Remove this comment to see the full error message
                        <Translate>Active Incident</Translate>
                    </Badge>
                );
            }

            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
                !incidentTimeline.incident_state &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'never'.
                incidentTimeline.status === 'investigation notes deleted'
            ) {
                timelineStatus = (
                    <Badge backgroundColor={'#fff'} fontColor={'#49c3b1'}>
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element' is not assignable to type 'string |... Remove this comment to see the full error message
                        <Translate>Deleted a note</Translate>
                    </Badge>
                );
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
            if (incidentTimeline.incident_state) {
                timelineStatus = (
                    <Badge backgroundColor={'#fff'} fontColor={'#49c3b1'}>
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
                        {capitalize(incidentTimeline.incident_state)}
                    </Badge>
                );
            }
        }

        return timelineStatus;
    };

    render() {
        let note = '';
        let contentBackground,
            primaryTextColor,
            secondaryTextColor,
            downtimeColor,
            uptimeColor,
            degradedColor,
            noteBackgroundColor: $TSFixMe;
        const subheading = {};
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        if (this.props.statusPage) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            const colors = this.props.statusPage.colors;
            contentBackground = {
                background: `rgba(${colors.statusPageBackground.r}, ${colors.statusPageBackground.g}, ${colors.statusPageBackground.b}, ${colors.statusPageBackground.a})`,
            };
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'color' does not exist on type '{}'.
            subheading.color = `rgba(${colors.subheading.r}, ${colors.subheading.g}, ${colors.subheading.b}, ${colors.subheading.a})`;
            primaryTextColor = {
                color: `rgba(${colors.primaryText.r}, ${colors.primaryText.g}, ${colors.primaryText.b}, ${colors.primaryText.a})`,
            };
            secondaryTextColor = {
                color: `rgba(${colors.secondaryText.r}, ${colors.secondaryText.g}, ${colors.secondaryText.b}, ${colors.secondaryText.a})`,
            };
            downtimeColor = {
                backgroundColor: `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b}, ${colors.downtime.a})`,
            };
            uptimeColor = {
                backgroundColor: `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`,
            };
            degradedColor = {
                backgroundColor: `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b}, ${colors.degraded.a})`,
            };
            noteBackgroundColor = {
                background: `rgba(${colors.noteBackground.r}, ${colors.noteBackground.g}, ${colors.noteBackground.b}, ${colors.noteBackground.a})`,
            };
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.noteData &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.noteData.notes &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'lastIncidentTimelines' does not exist on... Remove this comment to see the full error message
            this.props.lastIncidentTimelines
        ) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'Element' is not assignable to type 'string'.
            note = (
                <Notes
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                    notes={this.props.noteData.notes}
                    secondaryTextColor={secondaryTextColor}
                    primaryTextColor={primaryTextColor}
                    downtimeColor={downtimeColor}
                    uptimeColor={uptimeColor}
                    degradedColor={degradedColor}
                    noteBackgroundColor={noteBackgroundColor}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageId' does not exist on type 'Re... Remove this comment to see the full error message
                    statusPageId={this.props.statusPageId}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'lastIncidentTimelines' does not exist on... Remove this comment to see the full error message
                    incidentTimelines={this.props.lastIncidentTimelines}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
                    statusPageSlug={this.props.statusPageSlug}
                />
            );
        }
        const {
            enableRSSFeed,
            smsNotification,
            webhookNotification,
            emailNotification,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        } = this.props.statusPage;
        const showSubscriberOption =
            enableRSSFeed ||
            smsNotification ||
            webhookNotification ||
            emailNotification;

        const checkDuplicateDates = (items: $TSFixMe) => {
            const track = {};

            const result = [];

            for (const item of items) {
                const date = String(item.createdAt).slice(0, 10);

                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                if (!track[date]) {
                    item.style = true;
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    track[date] = date;
                } else {
                    item.style = false;
                }

                result.push(item);
            }

            return result;
        };

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
        const incidentNoteData = this.props.noteData;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.theme === 'Clean Theme' &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.noteData.notes.length > countNum &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            !this.props.noteData.notes[1].idNumber &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            !this.props.noteData.notes[1].style
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.noteData.notes.splice(1, 1);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            incidentNoteData.notes = this.props.noteData.notes;
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'theme' does not exist on type 'Readonly<... Remove this comment to see the full error message
        if (this.props.theme === 'Clean Theme') {
            return incidentNoteData && incidentNoteData.requesting ? (
                <div>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'center',
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
                </div>
            ) : incidentNoteData && incidentNoteData.notes.length > 0 ? (
                checkDuplicateDates(incidentNoteData.notes).map((note, i) => {
                    return (
                        <div
                            className="incident-object"
                            style={
                                noteBackgroundColor.background ===
                                'rgba(247, 247, 247, 1)'
                                    ? { background: 'rgba(255,255,255,1)' }
                                    : noteBackgroundColor
                            }
                            key={i}
                        >
                            <ShouldRender if={note.style}>
                                <div
                                    className="date-big"
                                    style={{ margin: 10, marginLeft: 0 }}
                                >
                                    <Translate>
                                        {moment(note.createdAt).format('LL')}
                                    </Translate>
                                </div>
                            </ShouldRender>
                            <ShouldRender if={!note.style}>
                                <div
                                    className="border-width-90"
                                    style={{ width: '100%' }}
                                ></div>
                            </ShouldRender>
                            {note.slug ? (
                                <span
                                    style={{
                                        margin: 10,
                                        marginLeft: 0,
                                        display: 'inline-block',
                                    }}
                                >
                                    <div
                                        className="list_k"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() =>
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
                                            this.props.history.push(
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
                                                `/status-page/${this.props.statusPageSlug}/incident/${note.slug}`
                                            )
                                        }
                                    >
                                        <b>{note.title}</b>
                                    </div>
                                    <div
                                        className="incident-date"
                                        style={{
                                            marginBottom: 12,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span style={{ marginRight: 10 }}>
                                            <Translate>Created at </Translate>
                                            {moment(note.createdAt).format(
                                                'LLL'
                                            )}
                                        </span>
                                        {this.handleIncidentStatus(
                                            note,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'lastIncidentTimelines' does not exist on... Remove this comment to see the full error message
                                            this.props.lastIncidentTimelines
                                        )}
                                    </div>
                                    {note.message &&
                                        note.message
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
                                            .map((message: $TSFixMe) => <div key={message._id}>
                                            <div
                                                className="incident_desc"
                                                style={{
                                                    marginBottom: 5,
                                                    whiteSpace:
                                                        'pre-wrap',
                                                }}
                                                key={message._id}
                                            >
                                                <b>
                                                    {
                                                        message.incident_state
                                                    }
                                                </b>{' '}
                                                {message.content
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
                                                                id={`note-${i}`}
                                                            >
                                                                {elem}
                                                            </Markdown>
                                                        )
                                                    )}
                                            </div>
                                            <div className="incident-date">
                                                <span>
                                                    {moment(
                                                        message.createdAt
                                                    ).format('LLL')}
                                                </span>
                                            </div>
                                        </div>)}
                                </span>
                            ) : (
                                <div
                                    className="bs-no-report"
                                    style={{
                                        margin: 10,
                                        display: 'inline-block',
                                    }}
                                >
                                    <Translate>No incident reported</Translate>
                                </div>
                            )}
                        </div>
                    );
                })
            ) : (
                <div className="no_monitor">
                    <ShouldRender
                        if={
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                            this.props.individualnote &&
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                            this.props.individualnote
                        }
                    >
                        <div className="date-big bs-color-b">
                            {moment(
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                this.props.individualnote &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                    this.props.individualnote.date
                            ).format('LL')}
                        </div>
                    </ShouldRender>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'notesmessage' does not exist on type 'Re... Remove this comment to see the full error message
                    {typeof this.props.notesmessage === 'string' ? (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'notesmessage' does not exist on type 'Re... Remove this comment to see the full error message
                        this.props.notesmessage
                    ) : (
                        <div>
                            <Translate> No incident available.</Translate>
                        </div>
                    )}
                </div>
            );
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            if (this.props.noteData && this.props.noteData.requesting) {
                return (
                    <div
                        className="twitter-feed white box"
                        style={{ overflow: 'visible', ...contentBackground }}
                    >
                        <div
                            className="messages"
                            style={{ position: 'relative' }}
                        >
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.noteData &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    !this.props.noteData.error
                                }
                            >
                                <div
                                    className="box-inner"
                                    style={{
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                        width: '100%',
                                    }}
                                >
                                    <div className="feed-header">
                                        <ShouldRender
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                            if={!this.props.individualnote}
                                        >
                                            <span
                                                className="feed-title"
                                                style={subheading}
                                            >
                                                <Translate>Incidents</Translate>
                                            </span>
                                        </ShouldRender>
                                        <ShouldRender
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                            if={this.props.individualnote}
                                        >
                                            <span
                                                className="feed-title"
                                                style={primaryTextColor}
                                            >
                                                Incidents for{' '}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                                {this.props.individualnote
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                                    ? this.props.individualnote
                                                          .name
                                                    : ''}{' '}
                                                on{' '}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                                {this.props.individualnote
                                                    ? moment(
                                                          this.props
                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                                              .individualnote
                                                              .date
                                                      ).format('LL')
                                                    : ''}
                                            </span>
                                        </ShouldRender>
                                    </div>
                                    <ShouldRender
                                        if={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.noteData &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.noteData.requesting
                                        }
                                    >
                                        <div
                                            className="ball-beat"
                                            id="notes-loader"
                                            style={{ marginBottom: 0 }}
                                        >
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                }}
                                            ></div>
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                }}
                                            ></div>
                                            <div
                                                style={{
                                                    height: '12px',
                                                    width: '12px',
                                                }}
                                            ></div>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </ShouldRender>
                        </div>
                    </div>
                );
            }

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
            return this.props.noteData ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                this.props.individualnote ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'showIncidentCardState' does not exist on... Remove this comment to see the full error message
                this.props.showIncidentCardState ? (
                <div
                    className="twitter-feed white box"
                    style={{
                        overflow: 'visible',
                        marginBottom: 40,
                        ...contentBackground,
                    }}
                    id="incidentCard"
                >
                    <div className="messages" style={{ position: 'relative' }}>
                        <div
                            className="box-inner"
                            style={{
                                paddingLeft: 0,
                                paddingRight: 0,
                                width: '100%',
                            }}
                        >
                            <div className="feed-header">
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                <ShouldRender if={!this.props.individualnote}>
                                    <span
                                        className="feed-title"
                                        style={subheading}
                                    >
                                        <Translate>Incidents</Translate>
                                    </span>
                                </ShouldRender>
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                <ShouldRender if={this.props.individualnote}>
                                    <span
                                        className="feed-title"
                                        style={primaryTextColor}
                                    >
                                        Incidents for{' '}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                        {this.props.individualnote
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                            ? this.props.individualnote.name
                                            : ''}{' '}
                                        on{' '}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                        {this.props.individualnote
                                            ? moment(
                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                                  this.props.individualnote.date
                                              ).format('LL')
                                            : ''}
                                    </span>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isSubscriberEnabled' does not exist on t... Remove this comment to see the full error message
                                        this.props.isSubscriberEnabled ===
                                            true && showSubscriberOption
                                    }
                                >
                                    <button
                                        className="bs-Button-subscribe"
                                        type="submit"
                                        onClick={() => this.subscribebutton()}
                                    >
                                        <span>
                                            <Translate>Subscribe</Translate>
                                        </span>
                                    </button>
                                </ShouldRender>
                            </div>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscribed' does not exist on type 'Read... Remove this comment to see the full error message
                                    this.props.subscribed &&
                                    showSubscriberOption
                                }
                            >
                                <SubscribeBox />
                            </ShouldRender>
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.noteData &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    !this.props.noteData.requesting &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.noteData.notes &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.noteData.notes.length
                                }
                            >
                                <ul className="feed-contents plain">{note}</ul>
                            </ShouldRender>

                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    (this.props.noteData &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                        !this.props.noteData.requesting &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.noteData.notes &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                        !this.props.noteData.notes.length) ||
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'showIncidentCardState' does not exist on... Remove this comment to see the full error message
                                    (this.props.showIncidentCardState &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                        !this.props.noteData.notes.length)
                                }
                            >
                                <ul className="feed-contents plain">
                                    <li
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
                                                ...secondaryTextColor,
                                            }}
                                        >
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notesmessage' does not exist on type 'Re... Remove this comment to see the full error message
                                            {this.props.notesmessage ? (
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'notesmessage' does not exist on type 'Re... Remove this comment to see the full error message
                                                this.props.notesmessage
                                            ) : (
                                                <Translate>
                                                    No incidents yet
                                                </Translate>
                                            )}
                                            .
                                        </span>
                                    </li>
                                </ul>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.noteData &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.noteData.notes &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.noteData.notes.length &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                this.props.count > this.props.skip + 5 &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                !this.props.noteData.requesting &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingmore' does not exist on type '... Remove this comment to see the full error message
                                !this.props.requestingmore &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                !this.props.noteData.error &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                !this.props.individualnote &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchingIncidentTimelines' does not exis... Remove this comment to see the full error message
                                !this.props.fetchingIncidentTimelines
                            }
                        >
                            <button
                                className="more button-as-anchor anchor-centered"
                                onClick={() => this.more()}
                            >
                                <Translate>More</Translate>
                            </button>
                        </ShouldRender>

                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}
                        >
                            <ShouldRender
                                if={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.noteData &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    !this.props.noteData.error &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                    !this.props.noteData.requesting &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'individualnote' does not exist on type '... Remove this comment to see the full error message
                                    this.props.individualnote
                                }
                            >
                                <button
                                    className="all__btn"
                                    onClick={() => this.getAll()}
                                >
                                    <Translate>All Incidents</Translate>
                                </button>
                            </ShouldRender>
                        </div>

                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.noteData &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.noteData.requesting
                            }
                        >
                            <div className="ball-beat" id="notes-loader">
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                                <div
                                    style={{ height: '12px', width: '12px' }}
                                ></div>
                            </div>
                        </ShouldRender>

                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteData' does not exist on type 'Readon... Remove this comment to see the full error message
                                this.props.noteData && this.props.requestingmore
                            }
                        >
                            <div className="ball-beat" id="more-loader">
                                <div
                                    style={{ height: '8px', width: '8px' }}
                                ></div>
                                <div
                                    style={{ height: '8px', width: '8px' }}
                                ></div>
                                <div
                                    style={{ height: '8px', width: '8px' }}
                                ></div>
                            </div>
                        </ShouldRender>
                    </div>
                </div>
            ) : null;
        }
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
NotesMain.displayName = 'NotesMain';

const mapStateToProps = (state: $TSFixMe) => {
    let skip =
        state.status.notes && state.status.notes.skip
            ? state.status.notes.skip
            : 0;
    let count =
        state.status.notes && state.status.notes.count
            ? state.status.notes.count
            : 0;
    if (typeof skip === 'string') {
        skip = parseInt(skip, 10);
    }
    if (typeof count === 'string') {
        count = parseInt(count, 10);
    }

    return {
        noteData: state.status.notes,
        requestingmore: state.status.requestingmore,
        individualnote: state.status.individualnote,
        notesmessage: state.status.notesmessage,
        subscribed: state.subscribe.subscribeMenu,
        skip,
        count,
        incidentHistoryDays: state.status.statusPage.incidentHistoryDays,
        isSubscriberEnabled: state.status.statusPage.isSubscriberEnabled,
        statusPage: state.status.statusPage,
        lastIncidentTimelines: state.status.lastIncidentTimelines.timelines,
        fetchingIncidentTimelines:
            state.status.lastIncidentTimelines.requesting,
        showIncidentCardState: state.status.showIncidentCard,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        getStatusPageNote,
        getStatusPageIndividualNote,
        getMoreNote,
        openSubscribeMenu,
        fetchLastIncidentTimelines,
        showIncidentCard,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
NotesMain.propTypes = {
    noteData: PropTypes.object,
    notesmessage: PropTypes.string,
    individualnote: PropTypes.object,
    getStatusPageNote: PropTypes.func,
    getStatusPageIndividualNote: PropTypes.func,
    getMoreNote: PropTypes.func,
    requestingmore: PropTypes.bool,
    projectId: PropTypes.string,
    statusPageSlug: PropTypes.string,
    openSubscribeMenu: PropTypes.func,
    subscribed: PropTypes.bool,
    skip: PropTypes.number,
    count: PropTypes.number,
    statusPageId: PropTypes.string,
    isSubscriberEnabled: PropTypes.bool.isRequired,
    statusPage: PropTypes.object,
    fetchLastIncidentTimelines: PropTypes.func,
    lastIncidentTimelines: PropTypes.array,
    fetchingIncidentTimelines: PropTypes.bool,
    showIncidentCard: PropTypes.func,
    showIncidentCardState: PropTypes.bool,
    theme: PropTypes.string,
    history: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(NotesMain));
