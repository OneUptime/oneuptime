import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { fetchAnnouncementLogs } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import ShouldRender from './ShouldRender';
import { handleResources } from '../config';

class AnnouncementLogs extends Component {
    state = {
        limit: 5,
    };
    componentDidMount() {
        const {
            fetchAnnouncementLogs,
            projectId,
            statusPageId,
            theme,
        } = this.props;
        const limit = theme
            ? statusPageId.announcementLogsHistory || 14
            : this.state.limit;
        fetchAnnouncementLogs(projectId, statusPageId._id, 0, limit);
    }

    more = () => {
        const {
            fetchAnnouncementLogs,
            projectId,
            statusPageId,
            logs,
        } = this.props;
        let { limit } = this.state;
        limit += Number(logs.limit);
        fetchAnnouncementLogs(projectId, statusPageId._id, 0, limit);
    };
    render() {
        const {
            theme,
            logs: { announcementLogs, limit, count },
            error,
            monitorState,
        } = this.props;
        return (
            <>
                {theme ? (
                    <>
                        <div className="new-theme-incident">
                            <div
                                style={{ marginBottom: '40px' }}
                                className="font-largest"
                            >
                                Past Announcements
                            </div>
                            {announcementLogs && announcementLogs.length > 0 ? (
                                announcementLogs.map((log, index) => {
                                    return (
                                        <div
                                            className="incident-object"
                                            key={index}
                                        >
                                            <ShouldRender if={log.style}>
                                                <div className="date-big">
                                                    {moment(
                                                        log.createdAt
                                                    ).format('MMMM Do, YYYY')}
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender if={!log.style}>
                                                <div className="border-width-90"></div>
                                            </ShouldRender>
                                            <div className="list_k">
                                                <b id={`event-name`}>
                                                    {log.announcementId.name}
                                                </b>
                                                <ShouldRender if={!log.endDate}>
                                                    <div
                                                        style={{
                                                            marginLeft: 5,
                                                        }}
                                                        className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                                    >
                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span id="ongoing-event">
                                                                Active
                                                            </span>
                                                        </span>
                                                    </div>
                                                </ShouldRender>
                                            </div>
                                            <div
                                                className="incident_desc"
                                                id={`event-description-`}
                                            >
                                                {log.announcementId.description}
                                            </div>
                                            <span
                                                className="ongoing__affectedmonitor--title"
                                                style={{
                                                    color:
                                                        'rgba(76, 76, 76, 0.8)',
                                                }}
                                            >
                                                Resources Affected:{' '}
                                            </span>
                                            <span
                                                className="ongoing__affectedmonitor--content"
                                                style={{
                                                    color: 'rgba(0, 0, 0, 0.5)',
                                                }}
                                            >
                                                {log.announcementId &&
                                                    handleResources(
                                                        monitorState,
                                                        log.announcementId
                                                    )}
                                            </span>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent:
                                                        'space-between',
                                                    alignItems: 'center',
                                                }}
                                            >
                                                <div
                                                    className="incident-date"
                                                    id="event-date"
                                                >
                                                    <span>
                                                        {moment(
                                                            log.startDate
                                                        ).format(
                                                            'MMMM Do YYYY, h:mm a'
                                                        )}
                                                        <ShouldRender
                                                            if={log.endDate}
                                                        >
                                                            &nbsp;&nbsp;-
                                                            &nbsp;&nbsp;
                                                            {moment(
                                                                log.endDate
                                                            ).format(
                                                                'MMMM Do YYYY, h:mm a'
                                                            )}
                                                        </ShouldRender>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="nt_list">
                                    {error ? (
                                        <span style={{ color: '#f00' }}>
                                            {error}
                                        </span>
                                    ) : (
                                        'no announcement log'
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        <div
                            id="scheduledEvents"
                            className="twitter-feed white box"
                            style={{ overflow: 'visible' }}
                        >
                            <div
                                className="messages"
                                style={{ position: 'relative' }}
                            >
                                <div
                                    className="box-inner"
                                    style={{
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                        width: '100%',
                                    }}
                                >
                                    <div
                                        style={{ display: 'block' }}
                                        className="feed-header"
                                    >
                                        <span className="feed-title">
                                            Announcement History
                                        </span>
                                        <ul className="feed-contents plain">
                                            {announcementLogs &&
                                            announcementLogs.length > 0 ? (
                                                announcementLogs.map(
                                                    (log, index) => {
                                                        return (
                                                            <li
                                                                className="incidentlist feed-item clearfix"
                                                                style={{
                                                                    margin:
                                                                        '0 0 10px',
                                                                    cursor:
                                                                        'text',
                                                                }}
                                                                key={index}
                                                            >
                                                                <div className="ct_header">
                                                                    {
                                                                        log
                                                                            .announcementId
                                                                            .name
                                                                    }
                                                                </div>
                                                                <div className="ct_desc">
                                                                    {
                                                                        log
                                                                            .announcementId
                                                                            .description
                                                                    }
                                                                </div>
                                                                <div
                                                                    className="ongoing__affectedmonitor"
                                                                    style={{
                                                                        marginTop: 10,
                                                                    }}
                                                                >
                                                                    <span
                                                                        className="ongoing__affectedmonitor--title"
                                                                        style={{
                                                                            color:
                                                                                'rgba(76, 76, 76, 0.8)',
                                                                        }}
                                                                    >
                                                                        Resource
                                                                        Affected:
                                                                    </span>{' '}
                                                                    <span
                                                                        className="ongoing__affectedmonitor--content"
                                                                        style={{
                                                                            color:
                                                                                'rgba(0, 0, 0, 0.5)',
                                                                            fontSize:
                                                                                '13px',
                                                                        }}
                                                                    >
                                                                        {log.announcementId &&
                                                                            handleResources(
                                                                                monitorState,
                                                                                log.announcementId
                                                                            )}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="ct_time time">
                                                                        {moment(
                                                                            log.startDate
                                                                        ).format(
                                                                            'MMMM Do YYYY, h:mm a'
                                                                        )}
                                                                        &nbsp;&nbsp;-
                                                                        &nbsp;&nbsp;
                                                                        <ShouldRender
                                                                            if={
                                                                                log.endDate
                                                                            }
                                                                        >
                                                                            {moment(
                                                                                log.endDate
                                                                            ).format(
                                                                                'MMMM Do YYYY, h:mm a'
                                                                            )}
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                !log.endDate
                                                                            }
                                                                        >
                                                                            <span>
                                                                                active
                                                                            </span>
                                                                        </ShouldRender>
                                                                    </span>
                                                                </div>
                                                            </li>
                                                        );
                                                    }
                                                )
                                            ) : (
                                                <li className="cl_nolist">
                                                    {error ? (
                                                        <span
                                                            style={{
                                                                color: '#f00',
                                                            }}
                                                        >
                                                            {error}
                                                        </span>
                                                    ) : (
                                                        'no announcement log'
                                                    )}
                                                </li>
                                            )}
                                        </ul>
                                        <ShouldRender
                                            if={count > Number(limit)}
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
                            </div>
                        </div>{' '}
                    </>
                )}
            </>
        );
    }
}

AnnouncementLogs.displayName = 'AnnouncementLogs';

AnnouncementLogs.propTypes = {
    theme: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    fetchAnnouncementLogs: PropTypes.func,
    projectId: PropTypes.string,
    statusPageId: PropTypes.object,
    logs: PropTypes.object,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    monitorState: PropTypes.array,
};

const mapStateToProps = state => ({
    logs: state.status.announcementLogs.logsList,
    requesting: state.status.announcementLogs.requesting,
    error: state.status.announcementLogs.error,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ fetchAnnouncementLogs }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(AnnouncementLogs);
