import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchAnnouncementLogs } from '../../actions/statusPage';

import { PropTypes } from 'prop-types';
import moment from 'moment';
import Badge from '../common/Badge';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import { openModal } from '../../actions/modal';

import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import DeleteAnnouncementLog from '../modals/DeleteAnnouncementLog';

class AnnouncementLog extends Component {
    deleteAnnouncement: $TSFixMe;
    limit: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.limit = 10;
        this.state = {
            deleteModalId: uuidv4(),
        };
    }
    async componentDidMount() {

        const { fetchAnnouncementLogs, projectId, statusPage } = this.props;
        await fetchAnnouncementLogs(projectId, statusPage._id, 0, this.limit);
    }

    handleMonitorList = (monitors: $TSFixMe) => {
        if (monitors.length === 0) {
            return 'No monitor in this announcement';
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

    prevClicked = (skip: $TSFixMe) => {

        const { fetchAnnouncementLogs, projectId, statusPage } = this.props;
        fetchAnnouncementLogs(
            projectId,
            statusPage._id,
            skip ? Number(skip) - this.limit : this.limit,
            this.limit
        );
    };

    nextClicked = (skip: $TSFixMe) => {

        const { fetchAnnouncementLogs, projectId, statusPage } = this.props;
        fetchAnnouncementLogs(
            projectId,
            statusPage._id,
            skip ? Number(skip) + this.limit : this.limit,
            this.limit
        );
    };

    render() {
        const {

            requesting,

            error,

            logs: { announcementLogs, count, skip, limit },

            projectId,

            statusPage,
        } = this.props;


        const { deleteModalId } = this.state;

        const canNext = count > Number(skip) + Number(limit) ? true : false;
        const canPrev = Number(skip) <= 0 ? false : true;

        const footerBorderTopStyle = { margin: 0, padding: 0 };
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Announcement History</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here&#39;s a log of all the announcements
                                    that were hidden/shown and their timeframe.
                                </span>
                            </span>
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
                                id="announcementList"
                                className="bs-ObjectList-rows"
                            >
                                <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                    <div className="bs-ObjectList-cell">
                                        Announcement
                                    </div>
                                    <div className="bs-ObjectList-cell">
                                        Monitor(s)
                                    </div>
                                    <div
                                        className="bs-ObjectList-cell"
                                        style={{
                                            marginRight: '10px',
                                        }}
                                    >
                                        Start Date
                                    </div>
                                    <div
                                        className="bs-ObjectList-cell"
                                        style={{
                                            marginRight: '10px',
                                        }}
                                    >
                                        End Date
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
                                {announcementLogs &&
                                    announcementLogs.length > 0 &&
                                    announcementLogs.map((log: $TSFixMe) => {
                                        return (
                                            <div
                                                key={`announcement-${log._id}`}
                                                className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                style={{
                                                    backgroundColor: 'white',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                    <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                        {
                                                            log.announcementId
                                                                .name
                                                        }
                                                    </div>
                                                </div>
                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                    <div
                                                        className="bs-ObjectList-cell-row"
                                                        id={`monitor`}
                                                    >
                                                        {log.announcementId
                                                            .monitors &&
                                                            this.handleMonitorList(
                                                                log
                                                                    .announcementId
                                                                    .monitors
                                                            )}
                                                    </div>
                                                </div>
                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                    <div className="Box-root">
                                                        {log.startDate
                                                            ? moment(
                                                                log.startDate
                                                            ).format(
                                                                'MMMM Do YYYY, h:mm a'
                                                            )
                                                            : '-'}
                                                    </div>
                                                </div>
                                                <div className="bs-ObjectList-cell bs-u-v-middle">
                                                    <div className="Box-root">
                                                        {log.endDate &&
                                                            moment(
                                                                log.endDate
                                                            ).format(
                                                                'MMMM Do YYYY, h:mm a'
                                                            )}
                                                        {!log.endDate && (
                                                            <Badge
                                                                color={'green'}
                                                            >
                                                                active
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                <div
                                                    className="bs-ObjectList-cell bs-u-v-middle"
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent:
                                                            'flex-end',
                                                        alignItems: 'center',
                                                        paddingTop: '20px',
                                                    }}
                                                >
                                                    <button
                                                        id={`deleteAnnouncementLog`}
                                                        title="delete"
                                                        className="bs-Button bs-DeprecatedButton"
                                                        type="button"
                                                        style={{
                                                            float: 'right',
                                                            marginLeft: 10,
                                                        }}
                                                        onClick={() =>

                                                            this.props.openModal(
                                                                {
                                                                    id: deleteModalId,
                                                                    onClose: () =>
                                                                        '',
                                                                    onConfirm: () =>
                                                                        this.deleteAnnouncement(),
                                                                    content: DataPathHoC(
                                                                        DeleteAnnouncementLog,
                                                                        {
                                                                            projectId,
                                                                            announcementLogId:
                                                                                log._id,
                                                                            statusPage,
                                                                        }
                                                                    ),
                                                                }
                                                            )
                                                        }
                                                    >
                                                        <span>Delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                <ShouldRender
                                    if={
                                        !(
                                            (!announcementLogs ||
                                                announcementLogs.length ===
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
                        <ShouldRender if={requesting}>
                            <ListLoader />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                !requesting &&
                                (!announcementLogs ||
                                    announcementLogs.length === 0 ||
                                    error)
                            }
                        >
                            <div
                                className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                style={{
                                    textAlign: 'center',
                                    backgroundColor: 'white',
                                    padding: '20px 10px 10px',
                                }}
                            >
                                <span>
                                    {(!announcementLogs ||
                                        announcementLogs.length === 0) &&
                                        !requesting &&
                                        !error
                                        ? 'You have no announcements at this time.'
                                        : null}
                                    {error ? error : null}
                                </span>
                            </div>
                        </ShouldRender>
                        <div
                            className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                            style={{
                                backgroundColor: 'white',
                                justifyContent: 'space-between',
                            }}
                        >
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--center">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <ShouldRender
                                                    if={
                                                        announcementLogs &&
                                                        count
                                                    }
                                                >
                                                    <span id="numberOfAnnouncements">
                                                        {count}
                                                    </span>{' '}
                                                    {announcementLogs &&
                                                        count > 1
                                                        ? 'Logs'
                                                        : 'Log'}
                                                </ShouldRender>
                                            </span>
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div className="Box-root Margin-right--8">
                                        <button
                                            id="btnPrevAnnouncement"
                                            onClick={() =>
                                                this.prevClicked(skip)
                                            }
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
                                            id="btnNextAnnouncement"
                                            onClick={() =>
                                                this.nextClicked(skip)
                                            }
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


AnnouncementLog.displayName = 'AnnouncementLog';


AnnouncementLog.propTypes = {
    fetchAnnouncementLogs: PropTypes.func,
    projectId: PropTypes.string,
    statusPage: PropTypes.object,
    logs: PropTypes.object,
    requesting: PropTypes.bool,
    error: PropTypes.string,
    openModal: PropTypes.func,
};

const mapStateToProps = (state: $TSFixMe) => ({
    logs: state.statusPage.announcementLogs.logsList,
    requesting: state.statusPage.announcementLogs.requesting,
    error: state.statusPage.announcementLogs.error
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ fetchAnnouncementLogs, openModal }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(AnnouncementLog);
