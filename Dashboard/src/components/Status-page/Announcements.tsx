import React, { Component } from 'react';

import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import CreateAnnouncement from '../modals/CreateAnnouncement';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { openModal } from 'CommonUI/actions/modal';
import { bindActionCreators, Dispatch } from 'redux';
import { fetchAnnouncements } from '../../actions/statusPage';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import Badge from '../common/Badge';
import DeleteAnnouncement from '../modals/DeleteAnnouncement';
import EditAnnouncement from '../modals/EditAnnouncement';
import HideAnnouncement from '../modals/HideAnnouncement';
import AnnouncementLog from './AnnouncementLog';

interface AnnouncementsProps {
    openModal?: Function;
    projectId?: string;
    statusPage?: object;
    fetchAnnouncements?: Function;
    announcements?: object;
    requesting?: boolean;
    announceError?: boolean;
}

class Announcements extends Component<ComponentProps> {
    deleteAnnouncement: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            createAnnounceentModalId: uuidv4(),
            deleteModalId: uuidv4(),
            limit: 10,
        };
    }

    async override componentDidMount() {

        const { fetchAnnouncements, projectId, statusPage }: $TSFixMe = this.props;

        fetchAnnouncements(projectId, statusPage._id, 0, this.state.limit);
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

    prevClicked = (projectId: string, skip: PositiveNumber) => {

        const { fetchAnnouncements, statusPage }: $TSFixMe = this.props;

        const { limit }: $TSFixMe = this.state;
        fetchAnnouncements(
            projectId,
            statusPage._id,
            skip ? Number(skip) - limit : limit,
            limit
        );
    };

    nextClicked = (projectId: string, skip: PositiveNumber) => {

        const { fetchAnnouncements, statusPage }: $TSFixMe = this.props;

        const { limit }: $TSFixMe = this.state;
        fetchAnnouncements(
            projectId,
            statusPage._id,
            skip ? Number(skip) + limit : limit,
            limit
        );
    };

    override render() {

        const { createAnnounceentModalId, deleteModalId }: $TSFixMe = this.state;
        const {

            projectId,

            statusPage,

            announcements,

            requesting,

            announceError,
        } = this.props;
        const footerBorderTopStyle: $TSFixMe = { margin: 0, padding: 0 };
        const { skip, count, limit }: $TSFixMe = announcements;

        const canNext: $TSFixMe = count > Number(skip) + Number(limit) ? true : false;
        const canPrev: $TSFixMe = Number(skip) <= 0 ? false : true;
        return <>
            <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Announcement Templates</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Announcements shows up on status pages
                                    and dashboard to let your team or
                                    customers know of any infomation.
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <button
                                    id="addAnnouncementButton"
                                    onClick={() => {

                                        this.props.openModal({
                                            id: createAnnounceentModalId,
                                            content: DataPathHoC(
                                                CreateAnnouncement,
                                                {
                                                    projectId,
                                                    statusPage,
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
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>
                                                New Announcement Template{' '}
                                            </span>
                                        </span>
                                    </div>
                                </button>
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

                                {announcements &&
                                    announcements.allAnnouncements &&
                                    announcements.allAnnouncements.length >
                                    0 &&
                                    announcements.allAnnouncements.map(
                                        (announcement: $TSFixMe) => {
                                            return (
                                                <div
                                                    key={`announcement-${announcement._id}`}
                                                    className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                    style={{
                                                        backgroundColor:
                                                            'white',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                        <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                            {
                                                                announcement.name
                                                            }
                                                        </div>
                                                    </div>
                                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                                        <div
                                                            className="bs-ObjectList-cell-row"
                                                            id={`monitor`}
                                                        >
                                                            {announcement.monitors &&
                                                                this.handleMonitorList(
                                                                    announcement.monitors
                                                                )}
                                                        </div>
                                                    </div>

                                                    <div className="bs-ObjectList-cell bs-u-v-middle">
                                                        <div className="Box-root">
                                                            {announcement.hideAnnouncement ? (
                                                                <Badge
                                                                    color={
                                                                        'red'
                                                                    }
                                                                >
                                                                    not
                                                                    visible
                                                                    on
                                                                    status
                                                                    page
                                                                </Badge>
                                                            ) : (
                                                                <Badge
                                                                    color={
                                                                        'green'
                                                                    }
                                                                >
                                                                    visible
                                                                    on
                                                                    status
                                                                    page
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
                                                            alignItems:
                                                                'center',
                                                            paddingTop:
                                                                '20px',
                                                        }}
                                                    >
                                                        <button
                                                            id={`hideAnnouncement`}
                                                            title={
                                                                announcement.hideAnnouncement
                                                                    ? 'show announcement'
                                                                    : 'hide announcement'
                                                            }
                                                            className="bs-Button bs-DeprecatedButton"
                                                            type="button"
                                                            style={{
                                                                float:
                                                                    'right',
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
                                                                            HideAnnouncement,
                                                                            {
                                                                                projectId,
                                                                                announcement,
                                                                            }
                                                                        ),
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            <span>
                                                                {announcement.hideAnnouncement
                                                                    ? 'Show'
                                                                    : 'Hide'}
                                                            </span>
                                                        </button>
                                                        <button
                                                            id={`editAnnouncement`}
                                                            title="edit"
                                                            className="bs-Button bs-DeprecatedButton"
                                                            type="button"
                                                            style={{
                                                                float:
                                                                    'right',
                                                                marginLeft: 10,
                                                            }}
                                                            onClick={() => {

                                                                this.props.openModal(
                                                                    {
                                                                        id: deleteModalId,
                                                                        onClose: () =>
                                                                            '',
                                                                        onConfirm: () =>
                                                                            this.deleteAnnouncement(),
                                                                        content: DataPathHoC(
                                                                            EditAnnouncement,
                                                                            {
                                                                                projectId,
                                                                                announcement,
                                                                                statusPage,
                                                                            }
                                                                        ),
                                                                    }
                                                                );
                                                            }}
                                                        >
                                                            <span>
                                                                Edit
                                                            </span>
                                                        </button>
                                                        <button
                                                            id={`deleteAnnouncement`}
                                                            title="delete"
                                                            className="bs-Button bs-DeprecatedButton"
                                                            type="button"
                                                            style={{
                                                                float:
                                                                    'right',
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
                                                                            DeleteAnnouncement,
                                                                            {
                                                                                projectId,
                                                                                announcementId:
                                                                                    announcement._id,
                                                                            }
                                                                        ),
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            <span>
                                                                Delete
                                                            </span>
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    )}
                                <ShouldRender
                                    if={
                                        !(
                                            (!announcements ||
                                                (announcements.allAnnouncements &&
                                                    announcements
                                                        .allAnnouncements
                                                        .length) === 0) &&
                                            !requesting &&
                                            !announceError
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
                                (!announcements ||
                                    (announcements.allAnnouncements &&
                                        announcements.allAnnouncements
                                            .length === 0) ||
                                    announceError)
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
                                    {(!announcements ||
                                        (announcements.allAnnouncements &&
                                            announcements.allAnnouncements
                                                .length === 0)) &&
                                        !requesting &&
                                        !announceError
                                        ? 'You have no announcement at this time'
                                        : null}
                                    {announceError ? announceError : null}
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
                                                        announcements &&
                                                        announcements.count
                                                    }
                                                >
                                                    <span id="numberOfAnnouncements">
                                                        {
                                                            announcements.count
                                                        }
                                                    </span>{' '}
                                                    {announcements &&
                                                        announcements.count > 1
                                                        ? 'Announcements'
                                                        : 'Announcement'}
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
                                                this.prevClicked(
                                                    projectId,
                                                    skip
                                                )
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
                                            id="btnNextAnnouncement"
                                            onClick={() =>
                                                this.nextClicked(
                                                    projectId,
                                                    skip
                                                )
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
            <AnnouncementLog

                projectId={projectId}
                statusPage={statusPage}
            />
        </>;
    }
}


Announcements.displayName = 'Announcements';


Announcements.propTypes = {
    openModal: PropTypes.func,
    projectId: PropTypes.string,
    statusPage: PropTypes.object,
    fetchAnnouncements: PropTypes.func,
    announcements: PropTypes.object,
    requesting: PropTypes.bool,
    announceError: PropTypes.bool,
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ openModal, fetchAnnouncements }, dispatch);

const mapStateToProps: Function = (state: RootState) => {
    return {
        announcements: state.statusPage.announcements.announcementsList,
        requesting: state.statusPage.announcements.requesting,
        announceError: state.statusPage.announcements.error,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(Announcements);
