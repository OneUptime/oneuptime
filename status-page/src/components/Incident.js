import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import Markdown from 'markdown-to-jsx';
import ShouldRender from './ShouldRender';
import {
    getStatusPage,
    fetchIncident,
    fetchIncidentNotes,
    moreIncidentNotes,
    fetchLastIncidentTimeline,
} from '../actions/status';
import { ACCOUNTS_URL, capitalize } from '../config';
import { ListLoader } from './basic/Loader';

class Incident extends Component {
    componentDidMount() {
        const {
            match: { params },
            statusData,
            fetchIncident,
            fetchIncidentNotes,
            fetchLastIncidentTimeline,
        } = this.props;
        const { incidentId } = params;

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
            window.location.href.indexOf('fyipeapp.com') > 0
        ) {
            statusPageSlug = window.location.host.split('.')[0];
            url = 'null';
        } else {
            statusPageSlug = 'null';
            url = window.location.host;
        }

        this.props.getStatusPage(statusPageSlug, url).catch(err => {
            if (err.message === 'Request failed with status code 401') {
                const { loginRequired } = this.props.login;
                if (loginRequired) {
                    window.location = `${ACCOUNTS_URL}/login?statusPage=true&statusPageURL=${window.location.href}`;
                }
            }
        });

        if (statusData && statusData._id) {
            fetchLastIncidentTimeline(statusData.projectId._id, incidentId);
            fetchIncident(statusData.projectId._id, incidentId);
            fetchIncidentNotes(statusData.projectId._id, incidentId, true);
        }
    }

    componentDidUpdate(prevProps) {
        const {
            match: { params },
            statusData,
            fetchIncident,
            fetchIncidentNotes,
            fetchLastIncidentTimeline,
        } = this.props;
        const { incidentId } = params;

        if (prevProps.statusData._id !== statusData._id) {
            fetchLastIncidentTimeline(statusData.projectId._id, incidentId);
            fetchIncident(statusData.projectId._id, incidentId);
            fetchIncidentNotes(statusData.projectId._id, incidentId, true);
        }
    }

    more() {
        const {
            statusData,
            match: { params },
            skip,
            moreIncidentNotes,
        } = this.props;
        const { incidentId } = params;

        moreIncidentNotes(statusData.projectId._id, incidentId, true, skip + 1);
    }

    handleIncidentStatus = () => {
        const {
            requestingTimeline,
            lastIncidentTimeline,
            incident,
        } = this.props;
        let timelineStatus = null;
        const styles = {
            display: 'flex',
            alignItems: 'flex-start',
            fontSize: 14,
            color: 'rgba(0, 0, 0, 0.5)',
            paddingTop: 7,
        };
        const incidentStatus = {
            color: 'rgba(76, 76, 76, 0.8)',
            fontWeight: 600,
            minWidth: 110,
        };

        if (!requestingTimeline) {
            if (
                !lastIncidentTimeline.incident_state &&
                lastIncidentTimeline.status !== 'resolved' &&
                lastIncidentTimeline.status !== 'acknowledged'
            ) {
                timelineStatus = (
                    <span style={styles}>
                        <span style={incidentStatus}>Incident Status: </span>
                        <span style={{ marginLeft: 5 }}>Identified</span>
                    </span>
                );
            }
            if (
                !lastIncidentTimeline.incident_state &&
                lastIncidentTimeline.status === 'investigation notes deleted'
            ) {
                timelineStatus = (
                    <span style={styles}>
                        <span style={incidentStatus}>Incident Status: </span>
                        <span className="time__wrapper">
                            <span>Deleted a note</span>
                            {incident.acknowledged && incident.resolved && (
                                <span
                                    title="Resolved"
                                    className="resolved__incident"
                                ></span>
                            )}
                            {incident.acknowledged && !incident.resolved && (
                                <span
                                    title="Acknowledged"
                                    className="acknowledged__incident"
                                ></span>
                            )}
                        </span>
                    </span>
                );
            }
            if (
                incident.acknowledged &&
                lastIncidentTimeline.status === 'acknowledged'
            ) {
                timelineStatus = (
                    <span style={styles}>
                        <span style={incidentStatus}>Incident Status:</span>
                        <span className="time__wrapper">
                            This incident was acknowledged on{' '}
                            {moment(incident.acknowledgedAt).format(
                                'MMMM Do YYYY, h:mm a'
                            )}
                            <span
                                title="Acknowledged"
                                className="acknowledged__incident"
                            ></span>
                        </span>
                    </span>
                );
            }
            if (
                incident.resolved &&
                lastIncidentTimeline.status === 'resolved'
            ) {
                timelineStatus = (
                    <span style={styles}>
                        <span style={incidentStatus}>Incident Status:</span>
                        <span className="time__wrapper">
                            This incident was resolved on{' '}
                            {moment(incident.resolvedAt).format(
                                'MMMM Do YYYY, h:mm a'
                            )}
                            <span
                                title="Resolved"
                                className="resolved__incident"
                            ></span>
                        </span>
                    </span>
                );
            }
            if (lastIncidentTimeline.incident_state) {
                timelineStatus = (
                    <span style={styles}>
                        <span style={incidentStatus}>Incident Status: </span>
                        <span style={{ marginLeft: 5 }}>
                            {capitalize(lastIncidentTimeline.incident_state)}
                        </span>
                    </span>
                );
            }
            if (lastIncidentTimeline.incident_state && incident.acknowledged) {
                timelineStatus = (
                    <span style={styles}>
                        <span style={incidentStatus}>Incident Status:</span>
                        <span className="time__wrapper">
                            <span>
                                {capitalize(
                                    lastIncidentTimeline.incident_state
                                )}
                            </span>
                            <span
                                title="Acknowledged"
                                className="acknowledged__incident"
                            ></span>
                        </span>
                    </span>
                );
            }
            if (lastIncidentTimeline.incident_state && incident.resolved) {
                timelineStatus = (
                    <span style={styles}>
                        <span style={incidentStatus}>Incident Status:</span>
                        <span className="time__wrapper">
                            <span>
                                {capitalize(
                                    lastIncidentTimeline.incident_state
                                )}
                            </span>
                            <span
                                title="Resolved"
                                className="resolved__incident"
                            ></span>
                        </span>
                    </span>
                );
            }
        }

        return timelineStatus;
    };

    renderError = () => {
        const { error } = this.props.status;
        if (error === 'Input data schema mismatch.') {
            return 'Page Not Found';
        } else if (error === 'Project Not present') {
            return 'Invalid Project.';
        } else return error;
    };

    render() {
        const {
            count,
            history,
            fetchingIncidentNotes,
            fetchingIncident,
            incident,
            incidentNotes,
            lastIncidentTimeline,
        } = this.props;
        const error = this.renderError();

        let downtimeColor, uptimeColor, degradedColor;
        if (
            !this.props.requestingStatus &&
            this.props.statusData &&
            this.props.statusData.colors
        ) {
            const colors = this.props.statusData.colors;
            downtimeColor = {
                backgroundColor: `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b})`,
            };
            uptimeColor = {
                backgroundColor: `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b})`,
            };
            degradedColor = {
                backgroundColor: `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b})`,
            };
        }

        return (
            <div
                className="page-main-wrapper"
                style={{ background: 'rgb(247, 247, 247)' }}
            >
                <div className="innernew">
                    <div
                        id="incident"
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
                                style={{ paddingTop: 20, paddingBottom: 20 }}
                            >
                                {!this.props.requestingStatus &&
                                    !fetchingIncident &&
                                    incident.incidentType && (
                                        <div
                                            className="incident-bubble"
                                            style={{
                                                backgroundColor:
                                                    incident.incidentType ===
                                                    'online'
                                                        ? uptimeColor.backgroundColor
                                                        : incident.incidentType ===
                                                          'offline'
                                                        ? downtimeColor.backgroundColor
                                                        : degradedColor.backgroundColor,
                                            }}
                                        ></div>
                                    )}
                                <span
                                    style={{
                                        color: 'rgba(76, 76, 76, 0.52)',
                                        textTransform: 'uppercase',
                                        fontWeight: '700',
                                        display: 'inline-block',
                                        marginBottom: 20,
                                        fontSize: 14,
                                        marginLeft: 25,
                                    }}
                                >
                                    Incident
                                </span>
                                {!fetchingIncident && incident.title && (
                                    <>
                                        <div
                                            className="individual-header"
                                            style={{
                                                marginBottom: incident.description
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
                                                    textTransform: 'unset',
                                                }}
                                            >
                                                {incident.title}
                                            </span>
                                            <span
                                                style={{
                                                    color: 'rgba(0, 0, 0, 0.5)',
                                                }}
                                            >
                                                {incident.description}
                                            </span>
                                        </div>
                                        <div
                                            className="ongoing__affectedmonitor"
                                            style={{ marginTop: 0 }}
                                        >
                                            <span
                                                className="ongoing__affectedmonitor--title"
                                                style={{
                                                    color:
                                                        'rgba(76, 76, 76, 0.8)',
                                                }}
                                            >
                                                Resource Affected:
                                            </span>{' '}
                                            <span
                                                className="ongoing__affectedmonitor--content"
                                                style={{
                                                    color: 'rgba(0, 0, 0, 0.5)',
                                                }}
                                            >
                                                {incident.monitorId.name}
                                            </span>
                                        </div>
                                    </>
                                )}
                                {!fetchingIncident &&
                                    lastIncidentTimeline &&
                                    lastIncidentTimeline.status &&
                                    this.handleIncidentStatus()}
                                <ShouldRender if={fetchingIncident}>
                                    <ListLoader />
                                </ShouldRender>
                                {!fetchingIncidentNotes &&
                                    !fetchingIncident &&
                                    incident.createdAt && (
                                        <span
                                            style={{
                                                fontSize: 14,
                                                color: 'rgba(0, 0, 0, 0.5)',
                                                paddingTop: 7,
                                                display: 'block',
                                            }}
                                        >
                                            <span>
                                                This incident was created on
                                            </span>{' '}
                                            <span className="time">
                                                {moment(
                                                    incident.createdAt
                                                ).format(
                                                    'MMMM Do YYYY, h:mm a'
                                                )}
                                            </span>
                                        </span>
                                    )}
                            </div>
                        </div>
                    </div>

                    <div
                        id="incidentNotes"
                        className="twitter-feed white box"
                        style={{ overflow: 'visible' }}
                    >
                        <div
                            className="messages"
                            style={{ position: 'relative' }}
                        >
                            <div className="box-inner">
                                <ShouldRender if={!fetchingIncidentNotes}>
                                    <div
                                        className="individual-header"
                                        style={{
                                            flexDirection: 'row',
                                            flexWrap: 'nowrap',
                                        }}
                                    >
                                        <span
                                            className="feed-title"
                                            style={{
                                                color: 'rgba(76, 76, 76, 0.8)',
                                                fontWeight: 'bold',
                                            }}
                                        >
                                            Incident Updates
                                        </span>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={fetchingIncidentNotes}>
                                    <ListLoader />
                                </ShouldRender>
                                <ul className="feed-contents plain">
                                    {!fetchingIncidentNotes &&
                                        incidentNotes &&
                                        incidentNotes.length > 0 &&
                                        incidentNotes.map(note => (
                                            <li
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
                                                            }}
                                                        >
                                                            {note.content && (
                                                                <Markdown>
                                                                    {
                                                                        note.content
                                                                    }
                                                                </Markdown>
                                                            )}
                                                        </span>
                                                        <span
                                                            style={{
                                                                display: 'flex',
                                                                marginTop: 15,
                                                                alignItems:
                                                                    'center',
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
                                                                Posted on{' '}
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
                                                                    note.incident_state
                                                                }
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}

                                    {!fetchingIncidentNotes &&
                                        incidentNotes &&
                                        incidentNotes.length === 0 && (
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
                                                        color:
                                                            'rgb(76, 76, 76)',
                                                    }}
                                                >
                                                    No incident updates yet.
                                                </span>
                                            </li>
                                        )}
                                </ul>
                            </div>
                            <ShouldRender
                                if={
                                    incidentNotes.length &&
                                    count > incidentNotes.length &&
                                    !fetchingIncidentNotes
                                }
                            >
                                <button
                                    className="more button-as-anchor anchor-centered"
                                    onClick={() => this.more()}
                                >
                                    More
                                </button>
                            </ShouldRender>
                        </div>
                    </div>

                    <ShouldRender if={fetchingIncident}>
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
                    <div id="footer">
                        <span
                            onClick={() => history.goBack()}
                            className="sp__icon sp__icon--back"
                            style={{
                                color: 'rgb(76, 76, 76)',
                                cursor: 'pointer',
                            }}
                        >
                            Back to status page
                        </span>
                        <p>
                            <a
                                href="https://fyipe.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'rgb(76, 76, 76)' }}
                            >
                                Powered by Fyipe
                            </a>
                        </p>
                    </div>
                    <ShouldRender if={error}>
                        <div id="app-loading">
                            <div>{error}</div>
                        </div>
                    </ShouldRender>
                </div>
            </div>
        );
    }
}

Incident.displayName = 'Incident';

Incident.propTypes = {
    match: PropTypes.object,
    statusData: PropTypes.object,
    getStatusPage: PropTypes.func,
    login: PropTypes.object.isRequired,
    history: PropTypes.object,
    fetchIncident: PropTypes.func,
    fetchIncidentNotes: PropTypes.func,
    moreIncidentNotes: PropTypes.func,
    count: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    fetchingIncidentNotes: PropTypes.bool,
    fetchingIncident: PropTypes.bool,
    incident: PropTypes.object,
    incidentNotes: PropTypes.array,
    requestingStatus: PropTypes.bool,
    fetchLastIncidentTimeline: PropTypes.func,
    requestingTimeline: PropTypes.bool,
    lastIncidentTimeline: PropTypes.object,
    status: PropTypes.object,
};

const mapStateToProps = state => {
    return {
        statusData: state.status.statusPage,
        login: state.login,
        skip: state.status.incidentNotes.skip,
        count: state.status.incidentNotes.count,
        fetchingIncidentNotes: state.status.incidentNotes.requesting,
        fetchingIncident: state.status.incident.requesting,
        incident: state.status.incident.incident,
        incidentNotes: state.status.incidentNotes.notes,
        requestingStatus: state.status.requesting,
        requestingTimeline: state.status.lastIncidentTimeline.requesting,
        lastIncidentTimeline: state.status.lastIncidentTimeline.timeline,
        status: state.status,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getStatusPage,
            fetchIncident,
            fetchIncidentNotes,
            moreIncidentNotes,
            fetchLastIncidentTimeline,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Incident);
