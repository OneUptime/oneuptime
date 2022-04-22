import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Translate } from 'react-auto-translate';
import { fetchAnnouncementLogs } from '../actions/status';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import moment from 'moment';
import ShouldRender from './ShouldRender';
import { handleResources } from '../config';
import Markdown from 'markdown-to-jsx';

class AnnouncementLogs extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    state = {
        limit: 5,
    };

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
    override render() {
        const {

            theme,

            logs: { announcementLogs, limit, count },

            error,

            monitorState,
        } = this.props;
        return <>
            {theme ? (
                <>
                    <div className="new-theme-incident">
                        <div
                            style={{ marginBottom: '40px' }}
                            className="font-largest"
                        >
                            <Translate> Announcements</Translate>
                        </div>
                        {announcementLogs && announcementLogs.length > 0 ? (
                            announcementLogs.map((log: $TSFixMe, index: $TSFixMe) => {
                                return (
                                    <div
                                        className="incident-object"
                                        key={index}
                                    >
                                        <ShouldRender if={log.style}>
                                            <div className="date-big">
                                                {moment(
                                                    log.createdAt
                                                ).format(
                                                    'MMMM Do, YYYY'
                                                )}{' '}
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
                                                            <Translate>
                                                                Active{' '}
                                                            </Translate>
                                                        </span>
                                                    </span>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                        <div
                                            className="incident_desc"
                                            id={`event-description-`}
                                            style={{
                                                whiteSpace: 'pre-wrap',
                                            }}
                                        >
                                            {log.announcementId
                                                .description &&
                                                log.announcementId.description
                                                    .split('\n')
                                                    .map((elem: $TSFixMe, index: $TSFixMe) => (
                                                        <Markdown
                                                            key={`${elem}-${index}`}
                                                            options={{
                                                                forceBlock: true,
                                                            }}
                                                        >
                                                            {elem}
                                                        </Markdown>
                                                    ))}
                                        </div>
                                        <ShouldRender
                                            if={
                                                log.announcementId.monitors
                                                    .length > 0
                                            }
                                        >
                                            <span
                                                className="ongoing__affectedmonitor--title"
                                                style={{
                                                    color:
                                                        'rgba(76, 76, 76, 0.8)',
                                                }}
                                            >
                                                <Translate>
                                                    Resources Affected
                                                </Translate>
                                                :{' '}
                                            </span>
                                            <span
                                                className="ongoing__affectedmonitor--content"
                                                style={{
                                                    color:
                                                        'rgba(0, 0, 0, 0.5)',
                                                }}
                                            >
                                                {log.announcementId &&
                                                    handleResources(
                                                        monitorState,
                                                        log.announcementId
                                                    )}
                                            </span>
                                        </ShouldRender>
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
                                                    )}{' '}
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
                                        <Translate>{error} </Translate>
                                    </span>
                                ) : (
                                    <Translate>
                                        No announcements at this time.
                                    </Translate>
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
                                        <Translate>
                                            Announcement History
                                        </Translate>
                                    </span>
                                    <ul className="feed-contents plain">
                                        {announcementLogs &&
                                            announcementLogs.length > 0 ? (
                                            announcementLogs.map(
                                                (log: $TSFixMe, index: $TSFixMe) => {
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
                                                            <div
                                                                className="ct_desc"
                                                                style={{
                                                                    whiteSpace:
                                                                        'pre-wrap',
                                                                }}
                                                            >
                                                                <Translate>
                                                                    {log
                                                                        .announcementId
                                                                        .description &&
                                                                        log.announcementId.description
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
                                                                </Translate>
                                                            </div>
                                                            <ShouldRender
                                                                if={
                                                                    log
                                                                        .announcementId
                                                                        .monitors
                                                                        .length >
                                                                    0
                                                                }
                                                            >
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
                                                                        <Translate>
                                                                            Resource
                                                                            Affected:
                                                                        </Translate>
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
                                                            </ShouldRender>
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
                                                                            <Translate>
                                                                                active
                                                                            </Translate>
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
                                                        <Translate>
                                                            {error}
                                                        </Translate>
                                                    </span>
                                                ) : (
                                                    <Translate>
                                                        No announcements at
                                                        this time.{' '}
                                                    </Translate>
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
                                            <Translate>More</Translate>
                                        </button>
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                    </div>{' '}
                </>
            )}
        </>;
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

const mapStateToProps: Function = (state: RootState) => ({
    logs: state.status.announcementLogs.logsList,
    requesting: state.status.announcementLogs.requesting,
    error: state.status.announcementLogs.error
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ fetchAnnouncementLogs }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(AnnouncementLogs);
