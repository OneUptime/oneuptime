import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import moment from 'moment';
import ShouldRender from './ShouldRender';
import {
    getStatusPage,
    fetchIncident,
    fetchIncidentNotes,
    moreIncidentNotes,
} from '../actions/status';
import { ACCOUNTS_URL } from '../config';
import { ListLoader } from './basic/Loader';

class Incident extends Component {
    componentDidMount() {
        const {
            match: { params },
            statusData,
            fetchIncident,
            fetchIncidentNotes,
        } = this.props;
        const { incidentId } = params;

        if (
            window.location.search.substring(1) &&
            window.location.search.substring(1) === 'embedded=true'
        ) {
            document.getElementsByTagName('html')[0].style.background =
                'none transparent';
        }

        let url, statusPageId;

        if (
            window.location.pathname.includes('/status-page/') &&
            window.location.pathname.split('/').length >= 3
        ) {
            statusPageId = window.location.pathname.split('/')[2];
            url = 'null';
        } else if (
            window.location.href.indexOf('localhost') > -1 ||
            window.location.href.indexOf('fyipeapp.com') > 0
        ) {
            statusPageId = window.location.host.split('.')[0];
            url = 'null';
        } else {
            statusPageId = 'null';
            url = window.location.host;
        }

        this.props.getStatusPage(statusPageId, url).catch(err => {
            if (err.message === 'Request failed with status code 401') {
                const { loginRequired } = this.props.login;
                if (loginRequired) {
                    window.location = `${ACCOUNTS_URL}/login?statusPage=true&statusPageURL=${window.location.href}`;
                }
            }
        });

        if (statusData && statusData._id) {
            fetchIncident(statusData.projectId._id, incidentId);
            fetchIncidentNotes(
                statusData.projectId._id,
                incidentId,
                'investigation'
            );
        }
    }

    componentDidUpdate(prevProps) {
        const {
            match: { params },
            statusData,
            fetchIncident,
            fetchIncidentNotes,
        } = this.props;
        const { incidentId } = params;

        if (prevProps.statusData._id !== statusData._id) {
            fetchIncident(statusData.projectId._id, incidentId);
            fetchIncidentNotes(
                statusData.projectId._id,
                incidentId,
                'investigation'
            );
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

        moreIncidentNotes(
            statusData.projectId._id,
            incidentId,
            'investigation',
            skip + 1
        );
    }

    render() {
        const {
            count,
            history,
            fetchingIncidentNotes,
            fetchingIncident,
            incident,
            incidentNotes,
        } = this.props;

        return (
            <div
                className="page-main-wrapper"
                style={{ background: 'rgb(247, 247, 247)' }}
            >
                <div className="innernew" style={{ width: 609 }}>
                    <div
                        className="twitter-feed white box"
                        style={{ overflow: 'visible' }}
                    >
                        <div
                            className="largestatus"
                            style={{ padding: '30px 36px' }}
                        >
                            <div className="title-wrapper">
                                <span
                                    className="title"
                                    style={{
                                        color: 'rgb(0, 0, 0)',
                                        padding: 0,
                                    }}
                                >
                                    Incident
                                </span>
                            </div>
                        </div>
                    </div>

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
                            <div className="box-inner">
                                {!fetchingIncident && incident.title && (
                                    <div
                                        className="feed-header clearfix"
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            flexWrap: 'nowrap',
                                        }}
                                    >
                                        <span
                                            className="feed-title"
                                            style={{
                                                color: 'rgb(76, 76, 76)',
                                                fontWeight: 'bold',
                                                marginBottom: 10,
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
                                )}
                                <ShouldRender if={fetchingIncident}>
                                    <ListLoader />
                                </ShouldRender>
                                {!fetchingIncident && incident.createdAt && (
                                    <span
                                        className="time"
                                        style={{
                                            color: 'rgba(0, 0, 0, 0.5)',
                                            fontSize: 12,
                                        }}
                                    >
                                        {moment(incident.createdAt).format(
                                            'MMMM Do YYYY, h:mm a'
                                        )}
                                        &nbsp;&nbsp;&nbsp;&nbsp;
                                        {incident.resolved
                                            ? '(Resolved)'
                                            : '(Not Resolved)'}
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
                                        className="feed-header clearfix"
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'row',
                                            flexWrap: 'nowrap',
                                        }}
                                    >
                                        <span
                                            className="feed-title"
                                            style={{
                                                color: 'rgb(76, 76, 76)',
                                                fontWeight: 'bold',
                                            }}
                                        >
                                            Scheduled Event Notes
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
                                                className="scheduledEvent feed-item clearfix"
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
                                                        <span>
                                                            <span className="note-badge badge badge__color--green">
                                                                {
                                                                    note.incident_state
                                                                }
                                                            </span>
                                                        </span>
                                                        <span
                                                            style={{
                                                                color:
                                                                    'rgba(0, 0, 0, 0.5)',
                                                            }}
                                                        >
                                                            {note.content}
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
                                                    No incident note yet.
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
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getStatusPage, fetchIncident, fetchIncidentNotes, moreIncidentNotes },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Incident);
