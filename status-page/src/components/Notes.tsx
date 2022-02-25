import React, { Component } from 'react';
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import moment from 'moment';
import { withRouter } from 'react-router-dom';
import ShouldRender from './ShouldRender';
import { capitalize } from '../config';

class Notes extends Component {
    handleIncidentStatus = (incident, timelines) => {
        let incidentTimeline = null,
            timelineStatus = null;
        timelines.map(timeline => {
            if (String(incident._id) === String(timeline.incidentId)) {
                incidentTimeline = timeline;
            }
            return timeline;
        });

        if (incidentTimeline) {
            if (incident.resolved) {
                timelineStatus = (
                    <span className="note_status">
                        <Translate>Resolved</Translate>{' '}
                    </span>
                );
            }

            if (incident.acknowledged && !incident.resolved) {
                timelineStatus = (
                    <span className="note_status">
                        <Translate>Acknowledged</Translate>{' '}
                    </span>
                );
            }
            if (!incident.resolved && !incident.acknowledged) {
                timelineStatus = (
                    <span className="note_status">
                        <Translate>Identified</Translate>
                    </span>
                );
            }

            if (
                !incidentTimeline.incident_state &&
                incidentTimeline.status === 'investigation notes deleted'
            ) {
                timelineStatus = (
                    <span className="note_status">
                        <Translate>Deleted a note</Translate>
                    </span>
                );
            }
            if (incidentTimeline.incident_state) {
                timelineStatus = (
                    <span className="note_status">
                        {capitalize(incidentTimeline.incident_state)}
                    </span>
                );
            }
        }

        return timelineStatus;
    };
    handleNavigation = (statusPageSlug, noteSlug) => {
        const { history } = this.props;

        history.push(`/status-page/${statusPageSlug}/incident/${noteSlug}`);
    };

    handleMonitorList = monitors => {
        if (monitors) {
            if (monitors.length === 1) {
                return monitors[0].monitorId.name;
            }
            if (monitors.length === 2) {
                return `${monitors[0].monitorId.name} and ${monitors[1].monitorId.name}`;
            }
            if (monitors.length === 3) {
                return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name} and ${monitors[2].monitorId.name}`;
            }
            if (monitors.length > 3) {
                return `${monitors[0].monitorId.name}, ${
                    monitors[1].monitorId.name
                } and ${monitors.length - 2} others`;
            }
        }
    };

    render() {
        const {
            statusPageSlug,
            uptimeColor,
            downtimeColor,
            degradedColor,
            incidentTimelines,
        } = this.props;

        return (
            <ShouldRender if={this.props.notes}>
                {this.props.notes.map((note, i) => {
                    if (!note)
                        return (
                            <div>
                                <Translate>No note</Translate>
                            </div>
                        );

                    return (
                        <li
                            className="incidentlist feed-item clearfix"
                            key={i}
                            onClick={() =>
                                this.handleNavigation(statusPageSlug, note.slug)
                            }
                        >
                            <div
                                className="incident-status-bubble"
                                style={{
                                    backgroundColor:
                                        note.incidentType === 'online'
                                            ? uptimeColor.backgroundColor
                                            : note.incidentType === 'offline'
                                            ? downtimeColor.backgroundColor
                                            : degradedColor.backgroundColor,
                                }}
                            ></div>
                            <div
                                className="message"
                                style={{
                                    width: '100%',
                                    marginLeft: 0,
                                    ...this.props.noteBackgroundColor,
                                }}
                            >
                                <div
                                    className="text"
                                    style={{
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        flexWrap: 'nowrap',
                                    }}
                                >
                                    <span
                                        style={{
                                            fontWeight: 'Bold',
                                            ...this.props.primaryTextColor,
                                            color: 'rgba(76, 76, 76, 0.8)',
                                            marginLeft: 25,
                                        }}
                                    >
                                        {note.title}
                                    </span>
                                    <span
                                        style={{
                                            ...this.props.secondaryTextColor,
                                            color: 'rgba(0, 0, 0, 0.5)',
                                            display: 'block',
                                            textAlign: 'justify',
                                        }}
                                    >
                                        {note.description}
                                    </span>
                                </div>
                            </div>
                            <div
                                className="ongoing__affectedmonitor"
                                style={
                                    note.description
                                        ? { marginTop: 10 }
                                        : { marginTop: 0 }
                                }
                            >
                                <span
                                    className="ongoing__affectedmonitor--title"
                                    style={{ color: 'rgba(76, 76, 76, 0.8)' }}
                                >
                                    <Translate>Resource Affected:</Translate>
                                </span>{' '}
                                <span
                                    className="ongoing__affectedmonitor--content"
                                    style={{ color: 'rgba(0, 0, 0, 0.5)' }}
                                >
                                    {this.handleMonitorList(note.monitors)}
                                </span>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginTop: 5,
                                    marginBottom: 5,
                                }}
                            >
                                <span
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                >
                                    <span
                                        className="time"
                                        style={{
                                            ...this.props.secondaryTextColor,
                                            marginLeft: 0,
                                            display: 'inline-block',
                                            padding: 0,
                                            color: 'rgba(76, 76, 76, 0.8)',
                                        }}
                                    >
                                        {moment(note.createdAt).format(
                                            'MMMM Do YYYY, h:mm a'
                                        )}
                                    </span>
                                    {this.handleIncidentStatus(
                                        note,
                                        incidentTimelines
                                    )}
                                    {note.resolved && (
                                        <span
                                            title="Resolved"
                                            className="resolved__incident"
                                        ></span>
                                    )}
                                    {!note.resolved && note.acknowledged && (
                                        <span
                                            title="Resolved"
                                            className="acknowledged__incident"
                                        ></span>
                                    )}
                                </span>
                                <span className="sp__icon sp__icon--forward"></span>
                            </div>
                        </li>
                    );
                })}
            </ShouldRender>
        );
    }
}

Notes.displayName = 'Notes';

Notes.propTypes = {
    notes: PropTypes.array,
    secondaryTextColor: PropTypes.object,
    primaryTextColor: PropTypes.object,
    noteBackgroundColor: PropTypes.object,
    statusPageSlug: PropTypes.string,
    degradedColor: PropTypes.object,
    uptimeColor: PropTypes.object,
    downtimeColor: PropTypes.object,
    incidentTimelines: PropTypes.array,
    history: PropTypes.object,
};

export default withRouter(Notes);
