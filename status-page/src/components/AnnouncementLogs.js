import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { fetchAnnouncementLogs } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import ShouldRender from './ShouldRender';

class AnnouncementLogs extends Component {
    constructor(props) {
        super(props);
        this.limit = 14;
    }
    componentDidMount() {
        const { fetchAnnouncementLogs, projectId, statusPageId } = this.props;
        const limit = statusPageId.announcementLogsHistory || this.limit;
        fetchAnnouncementLogs(projectId, statusPageId._id, 0, limit);
    }
    render() {
        const {
            theme,
            logs: { announcementLogs },
            error,
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
                                Past Announcement Logs
                            </div>
                            <ul className="nt-ann-block">
                                {announcementLogs &&
                                announcementLogs.length > 0 ? (
                                    announcementLogs.map((log, index) => {
                                        return (
                                            <li key={index}>
                                                <div className="nt-topic">
                                                    {log.announcementId.name}
                                                </div>
                                                <div className="incident-date">
                                                    <span>
                                                        {moment(
                                                            log.startDate
                                                        ).format(
                                                            'MMMM Do YYYY, h:mm a'
                                                        )}
                                                        &nbsp;&nbsp;-
                                                        &nbsp;&nbsp;
                                                        <ShouldRender
                                                            if={log.endDate}
                                                        >
                                                            {moment(
                                                                log.endDate
                                                            ).format(
                                                                'MMMM Do YYYY, h:mm a'
                                                            )}
                                                        </ShouldRender>
                                                        <ShouldRender
                                                            if={!log.endDate}
                                                        >
                                                            <span>active</span>
                                                        </ShouldRender>
                                                    </span>
                                                </div>
                                            </li>
                                        );
                                    })
                                ) : (
                                    <li className="nt_list">
                                        {error ? (
                                            <span style={{ color: '#f00' }}>
                                                {error}
                                            </span>
                                        ) : (
                                            'no announcement log'
                                        )}
                                    </li>
                                )}
                            </ul>
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
                                            Announcement Logs
                                        </span>
                                        <ul style={{ paddingLeft: 0 }}>
                                            {announcementLogs &&
                                            announcementLogs.length > 0 ? (
                                                announcementLogs.map(
                                                    (log, index) => {
                                                        return (
                                                            <li
                                                                key={index}
                                                                className="ann_list scheduledEvent feed-item clearfix"
                                                            >
                                                                <div
                                                                    style={{
                                                                        maxWidth:
                                                                            '30%',
                                                                    }}
                                                                >
                                                                    {
                                                                        log
                                                                            .announcementId
                                                                            .name
                                                                    }
                                                                </div>
                                                                <div
                                                                    style={{
                                                                        display:
                                                                            'flex',
                                                                        alignItems:
                                                                            'center',
                                                                        flex: 1,
                                                                    }}
                                                                >
                                                                    <span
                                                                        className="time"
                                                                        style={{
                                                                            color:
                                                                                '#000',
                                                                            paddingTop: 0,
                                                                        }}
                                                                    >
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
};

const mapStateToProps = state => ({
    logs: state.status.announcementLogs.logsList,
    requesting: state.status.announcementLogs.requesting,
    error: state.status.announcementLogs.error,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ fetchAnnouncementLogs }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(AnnouncementLogs);
