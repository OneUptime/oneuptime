import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import FeedBackModal from '../FeedbackModal';
import { showProfileMenu, updateProfileSetting } from '../../actions/profile';
import { openNotificationMenu } from '../../actions/notification';
import {
    openFeedbackModal,
    closeFeedbackModal,
    resetCreateFeedback,
} from '../../actions/feedback';
import { userSettings } from '../../actions/profile';
import { userScheduleRequest, fetchUserSchedule } from '../../actions/schedule';
import { getVersion } from '../../actions/version';
import { openSideNav } from '../../actions/page';
import { API_URL, User } from '../../config';

import { fetchSubProjectOngoingScheduledEvents } from '../../actions/scheduledEvent';
import ShouldRender from '../basic/ShouldRender';
import OnCallScheduleModal from '../OnCallScheduleModal';
import IncidentHeaderModal from '../modals/IncidentHeaderModal';
import ScheduleHeaderModal from '../modals/ScheduleHeaderModal';
import DataPathHoC from '../DataPathHoC';
import { openModal } from '../../actions/modal';
import _ from 'lodash';
import moment from 'moment-timezone';
import Search from './Search';
import isSubProjectViewer from '../../utils/isSubProjectViewer';
import { setActiveSubProject } from '../../actions/subProject';
import SubProjectDropDown from '../basic/SubProjectDropDown';
import { fetchMonitors } from '../../actions/monitor';
import { history } from '../../store';
import { socket } from '../basic/Socket';
import { showSearchBar, closeSearchBar } from '../../actions/search';
import ClickOutside from 'react-click-outside';

class TopContent extends Component {
    state = { width: 0 };
    updateDimensions = () => {
        this.setState({ width: window.innerWidth });
    };

    handleChange = value => {
        this.props.setActiveSubProject(value, true);

        // emit project id to connect to room in backend
        socket?.emit('project_switch', value);

        this.props.fetchMonitors(value);
        const val = history.location.pathname
            .split('project/')[1]
            .split('/')[0];
        history.push(`/dashboard/project/${val}`);
    };

    componentDidMount() {
        const {
            userSettings,
            getVersion,
            currentProject,
            fetchSubProjectOngoingScheduledEvents,
            user,
        } = this.props;
        userSettings();
        getVersion();
        this.props.userScheduleRequest();
        if (currentProject && currentProject._id) {
            fetchSubProjectOngoingScheduledEvents(currentProject._id);
        }
        if (this.props.currentProjectId && this.props.user.id) {
            this.props.fetchUserSchedule(
                this.props.currentProjectId,
                this.props.user.id
            );
        }
        if (Object.keys(user).length > 0) {
            const userData = {
                ...user,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            };
            this.props.updateProfileSetting(userData);
        }
        this.updateDimensions();
        window.addEventListener('resize', this.updateDimensions);
    }
    componentWillUnmount() {
        window.removeEventListener('keydown', this.ArrowDown);
        window.removeEventListener('resize', this.updateDimensions);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.currentProject !== this.props.currentProject) {
            this.props.currentProject &&
                this.props.fetchSubProjectOngoingScheduledEvents(
                    this.props.currentProject._id
                );
        }
        if (
            (!prevProps.user.id &&
                this.props.currentProjectId &&
                this.props.user.id) ||
            (prevProps.currentProjectId !== this.props.currentProjectId &&
                this.props.user.id)
        ) {
            this.props.fetchUserSchedule(
                this.props.currentProjectId,
                this.props.user.id
            );
        }
    }

    showFeedbackModal = () => {
        this.props.openFeedbackModal();
    };

    hideFeedbackModal = () => {
        this.props.resetCreateFeedback();
        this.props.closeFeedbackModal();
    };

    showProfileMenu = e => {
        this.props.showProfileMenu(e.clientX);
    };

    showNotificationsMenu = e => {
        this.props.openNotificationMenu(e.clientX);
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.hideFeedbackModal();
                return true;
            default:
                return false;
        }
    };

    handleActiveIncidentClick = () => {
        let unresolvedincidents = [];

        if (
            this.props.incidents &&
            this.props.incidents.incidents &&
            this.props.incidents.incidents.length > 0
        ) {
            unresolvedincidents = this.props.incidents.incidents.filter(
                incident => !incident.resolved
            );
        }
        this.props.openModal({
            content: DataPathHoC(IncidentHeaderModal, {
                status: 'active',
                incidents: unresolvedincidents,
                currentProjectSlug: this.props.currentProjectSlug,
                currentProjectId: this.props.currentProjectId,
            }),
        });
    };

    handleOngoingScheduleClick = () => {
        const { subProjectOngoingScheduledEvents } = this.props;
        const schedules = [];
        subProjectOngoingScheduledEvents.forEach(eventData => {
            schedules.push(...eventData.ongoingScheduledEvents);
        });
        this.props.openModal({
            content: DataPathHoC(ScheduleHeaderModal, {
                schedules,
                currentProjectSlug: this.props.currentProjectSlug,
                currentProjectId: this.props.currentProjectId,
            }),
        });
    };

    renderActiveIncidents = incidentCounter => (
        <>
            {typeof incidentCounter === 'number' && (
                <div
                    className={`Box-root Flex-flex Flex-direction--row Flex-alignItems--center Box-background--${
                        incidentCounter && incidentCounter > 0
                            ? 'red'
                            : incidentCounter === 0
                            ? 'green'
                            : null
                    } Text-color--white Border-radius--4 Text-fontWeight--bold Padding-left--8 Padding-right--6 pointer`}
                    style={{ paddingBottom: '6px', paddingTop: '6px' }}
                    onClick={this.handleActiveIncidentClick}
                    id="activeIncidents"
                >
                    <span
                        className={`db-SideNav-icon db-SideNav-icon--${
                            incidentCounter && incidentCounter > 0
                                ? 'info'
                                : incidentCounter === 0
                                ? 'tick'
                                : null
                        } db-SideNav-icon--selected`}
                        style={{
                            filter: 'brightness(0) invert(1)',
                            marginTop: '1px',
                            marginRight: '3px',
                        }}
                    />
                </div>
            )}
        </>
    );

    renderOngoingScheduledEvents = () => {
        const { subProjectOngoingScheduledEvents } = this.props;
        let count = 0;
        subProjectOngoingScheduledEvents.forEach(eventData => {
            count += eventData.count;
        });
        return count > 0 ? (
            <div
                className="Box-root box__yellow--dark Flex-flex Flex-direction--row Flex-alignItems--center Text-color--white Border-radius--4 Text-fontWeight--bold Padding-left--8 Padding-right--6 pointer Margin-left--20"
                style={{ paddingBottom: '6px', paddingTop: '6px' }}
                onClick={this.handleOngoingScheduleClick}
                id="ongoingEvents"
            >
                <span
                    className="db-SideNav-icon db-SideNav-icon--connect db-SideNav-icon--selected"
                    style={{
                        filter: 'brightness(0) invert(1)',
                        marginTop: '-1px',
                        marginRight: '3px',
                    }}
                />
            </div>
        ) : null;
    };

    renderOnCallSchedule = (
        activeSchedules,
        currentProjectId,
        currentProjectSlug
    ) => {
        return (
            <div
                className="Box-root box__cyan5 Flex-flex Flex-direction--row Flex-alignItems--center Text-color--white Border-radius--4 Text-fontWeight--bold Padding-left--8 Padding-right--6 pointer Margin-right--20"
                style={{ paddingBottom: '6px', paddingTop: '6px' }}
                id="onCallSchedule"
                onClick={() =>
                    this.props.openModal({
                        content: DataPathHoC(OnCallScheduleModal, {
                            status: 'active',
                            schedules: activeSchedules,
                            currentProjectId: currentProjectId,
                            currentProjectSlug: currentProjectSlug,
                        }),
                    })
                }
            >
                <span
                    className={`db-SideNav-icon db-SideNav-icon--phone db-SideNav-icon--selected`}
                    style={{
                        filter: 'brightness(0) invert(1)',
                        marginTop: '1px',
                        marginRight: '3px',
                    }}
                />
            </div>
        );
    };

    render() {
        const IMG_URL =
            this.props.profilePic &&
            this.props.profilePic !== '' &&
            this.props.profilePic !== 'null'
                ? `url(${API_URL}/file/${this.props.profilePic})`
                : 'url(https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y)';
        const userId = User.getUserId();
        const isNotViewer =
            this.props.currentProject &&
            !isSubProjectViewer(userId, this.props.currentProject);
        let count = 0;
        if (
            this.props.notifications &&
            this.props.notifications.notifications &&
            this.props.notifications.notifications.length
        ) {
            this.props.notifications.notifications.map(notification => {
                if (notification.read.indexOf(userId) > -1) {
                    return notification;
                } else {
                    count++;
                    return notification;
                }
            });
        }
        let incidentCounter = null;

        if (
            this.props.incidents &&
            this.props.incidents.incidents &&
            this.props.incidents.incidents.length > 0
        ) {
            incidentCounter = this.props.incidents.incidents.filter(
                incident => !incident.resolved
            ).length;
        }
        const { escalations } = this.props;

        const userSchedules = _.flattenDeep(
            escalations.map(escalation => {
                return escalation.teams
                    .map(team => {
                        const schedule = team.teamMembers.find(
                            user =>
                                String(user.userId) ===
                                String(
                                    this.props.user.id || this.props.user._id
                                )
                        );
                        if (schedule) {
                            schedule.projectId = escalation.projectId;
                            schedule.scheduleId = escalation.scheduleId;
                        }
                        return schedule;
                    })
                    .filter(escalation => escalation);
            })
        );

        const activeSchedules = [];
        const upcomingSchedules = [];
        const inactiveSchedules = [];

        if (userSchedules && userSchedules.length > 0) {
            userSchedules.forEach(userSchedule => {
                const now = (userSchedule && moment()).format('HH:mm');
                const oncallstart = moment(userSchedule.startTime).format(
                    'HH:mm'
                );
                const oncallend = moment(userSchedule.endTime).format('HH:mm');
                const dayStart = moment().startOf('day');
                const dayEnd = moment().endOf('day');

                const startTime = moment(
                    (userSchedule && userSchedule.startTime) || dayStart
                ).format('HH:mm');

                const endTime = moment(
                    (userSchedule && userSchedule.endTime) || dayEnd
                ).format('HH:mm');

                const compareDate = (oncallstart, oncallend, now) => {
                    const isDifferentDay = oncallstart >= oncallend;
                    const [startHour, startMin] = oncallstart.split(':');
                    const [endHour, endMin] = oncallend.split(':');
                    const [nowHour, nowMin] = now.split(':');
                    const addDay = 86400000;

                    const start = new Date(
                        new Date().setHours(startHour, startMin)
                    ).getTime();
                    const end = isDifferentDay
                        ? new Date(
                              new Date(new Date().getTime() + addDay).setHours(
                                  endHour,
                                  endMin
                              )
                          ).getTime()
                        : new Date(
                              new Date(new Date().getTime()).setHours(
                                  endHour,
                                  endMin
                              )
                          ).getTime();
                    let current = new Date(
                        new Date().setHours(nowHour, nowMin)
                    ).getTime();

                    current =
                        current < start && isDifferentDay
                            ? new Date(
                                  new Date(
                                      new Date().getTime() + addDay
                                  ).setHours(nowHour, nowMin)
                              ).getTime()
                            : current;

                    if (current >= start && current <= end) return true;
                    return false;
                };

                const isUserActive =
                    compareDate(oncallstart, oncallend, now) ||
                    oncallstart === oncallend;

                const isUpcoming = moment(startTime, 'HH:mm').diff(
                    moment(now, 'HH:mm'),
                    'minutes'
                );
                const isOnDutyAllTheTime =
                    userSchedule.startTime === userSchedule.endTime;

                const tempObj = { ...userSchedule, isOnDutyAllTheTime };
                tempObj.startTime = startTime;
                tempObj.endTime = endTime;
                if (isUserActive) {
                    activeSchedules.push(tempObj);
                } else {
                    if (isUpcoming) {
                        upcomingSchedules.push(tempObj);
                    } else {
                        inactiveSchedules.push(tempObj);
                    }
                }
            });
        }

        let ongoingEventList, topNavCardClass;
        const topNavCardCount = document.getElementById('myId')
            ? document.getElementById('myId').childElementCount
            : 0;
        if (topNavCardCount === 4) topNavCardClass = 'oneCardClass';
        if (topNavCardCount === 5) topNavCardClass = 'twoCardClass';
        if (topNavCardCount === 6) topNavCardClass = 'threeCardClass';
        const { project, searchFieldVisible, closeSearchBar } = this.props;
        const renderSearch =
            project.projects.success && project.projects.projects.length !== 0;

        let activeSubProject;
        this.props.subProjects.forEach(subProject => {
            if (subProject._id === this.props.activeSubProject) {
                activeSubProject = subProject.name;
            }
        });

        const loggedInUser = User.getUserId();
        const showMainProject = this.props.currentProject?.users.find(
            user => (user.userId._id || user.userId) === loggedInUser
        );

        return (
            <div
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
                style={{
                    zIndex: '2',
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                }}
                className="db-World-topContent Box-root Box-background--transparent Padding-vertical--20 db-Topnav-wrap"
            >
                <div>
                    <ShouldRender if={this.props.subProjects.length > 0}>
                        <SubProjectDropDown
                            value={
                                (activeSubProject &&
                                    `Current Sub Project: ${activeSubProject}`) ||
                                'Main Project'
                            }
                            options={[
                                {
                                    value: this.props.currentProject?._id,
                                    label: `${this.props.currentProject?.name}`,
                                },
                                ...(this.props.subProjects &&
                                this.props.subProjects.length > 0
                                    ? this.props.subProjects.map(
                                          subProject => ({
                                              value: subProject._id,
                                              label: subProject.name,
                                          })
                                      )
                                    : []),
                            ]}
                            updateState={this.handleChange}
                            ready={!this.props.fetchingSubProjects}
                            showMainProject={showMainProject}
                        />
                    </ShouldRender>
                </div>
                <div style={{ marginRight: '15px' }}>
                    <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                        <ShouldRender if={isNotViewer && searchFieldVisible}>
                            <ClickOutside onClickOutside={closeSearchBar}>
                                <div className="db-Search-wrapper search-input2 floating-search-input">
                                    <Search closeSearchBar={closeSearchBar} />
                                </div>
                            </ClickOutside>
                        </ShouldRender>
                        <div
                            className="Box-root"
                            onClick={this.props.openSideNav}
                        >
                            <div className="db-MenuContainer">
                                <div
                                    className={
                                        'db-MenuIcon Box-root Box-background--white'
                                    }
                                >
                                    <div className="db-MenuIcon--content db-MenuIcon--menu" />
                                </div>
                            </div>
                        </div>
                        <FeedBackModal
                            hideFeedbackModal={this.hideFeedbackModal}
                        />

                        <div
                            className="Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart"
                            id="myId"
                        >
                            {userSchedules ? (
                                <>
                                    {ongoingEventList &&
                                        ongoingEventList.length > 0 &&
                                        ongoingEventList}
                                    <ShouldRender
                                        if={
                                            activeSchedules &&
                                            activeSchedules.length > 0 &&
                                            isNotViewer
                                        }
                                    >
                                        {this.renderOnCallSchedule(
                                            activeSchedules,
                                            this.props.currentProjectId,
                                            this.props.currentProjectSlug,
                                            topNavCardClass
                                        )}
                                    </ShouldRender>
                                </>
                            ) : (
                                ''
                            )}

                            {isNotViewer &&
                                this.renderActiveIncidents(
                                    incidentCounter,
                                    topNavCardClass
                                )}

                            {isNotViewer &&
                                this.renderOngoingScheduledEvents(
                                    topNavCardClass
                                )}

                            <ShouldRender
                                if={
                                    isNotViewer &&
                                    renderSearch &&
                                    this.state.width > 760
                                }
                            >
                                <div className="Box-root Flex-flex">
                                    <div
                                        style={{
                                            outline: 'none',
                                            marginRight: '15px',
                                        }}
                                    >
                                        <button
                                            className={
                                                'db-Notifications-button'
                                            }
                                            style={{ paddingTop: 7 }}
                                            onClick={this.props.showSearchBar}
                                        >
                                            <img
                                                src="/dashboard/assets/icons/search-solid.svg"
                                                id="search-input-img"
                                                style={{
                                                    width: '20px',
                                                    height: '20px',
                                                    position: 'relative',
                                                }}
                                                alt="search-icon"
                                            />
                                        </button>
                                    </div>
                                </div>
                            </ShouldRender>

                            <div className="Box-root Flex-flex">
                                <div
                                    style={{
                                        outline: 'none',
                                        marginRight: '15px',
                                        marginLeft: '15px',
                                    }}
                                >
                                    <button
                                        className={'db-Notifications-button'}
                                        style={{ paddingTop: 7 }}
                                        onClick={this.showFeedbackModal}
                                    >
                                        <img
                                            src="/dashboard/assets/icons/question.svg"
                                            id="search-input-img"
                                            style={{
                                                width: '22px',
                                                height: '22px',
                                                position: 'relative',
                                            }}
                                            alt="help-icon"
                                        />
                                    </button>
                                </div>
                            </div>

                            <ShouldRender if={isNotViewer}>
                                <div className="Box-root Flex-flex">
                                    <div
                                        tabIndex="-1"
                                        style={{
                                            outline: 'none',
                                            marginRight: '15px',
                                        }}
                                    >
                                        <button
                                            className={
                                                count
                                                    ? 'db-Notifications-button active-notification'
                                                    : 'db-Notifications-button'
                                            }
                                            onClick={this.showNotificationsMenu}
                                        >
                                            <span className="db-Notifications-icon db-Notifications-icon--empty" />
                                        </button>
                                    </div>
                                </div>
                            </ShouldRender>

                            <div className="Box-root margin-20">
                                <div>
                                    <div className="Box-root Flex-flex">
                                        <div className="Box-root Flex-flex">
                                            <button
                                                className="bs-Button bs-DeprecatedButton db-UserMenuX"
                                                id="profile-menu"
                                                type="button"
                                                tabIndex="-1"
                                                onClick={this.showProfileMenu}
                                            >
                                                <div
                                                    className="db-GravatarImage db-UserMenuX-image"
                                                    style={{
                                                        backgroundImage: IMG_URL,
                                                    }}
                                                />
                                            </button>
                                        </div>
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

TopContent.displayName = 'TopContent';

const mapStateToProps = (state, props) => {
    const settings = state.profileSettings.profileSetting.data;
    const profilePic = settings ? settings.profilePic : '';
    const { projectId } = props;
    const monitors = projectId
        ? state.monitor.monitorsList.monitors.find(project => {
              return project._id === projectId;
          })
        : [];
    const currentProjectId =
        state.project.currentProject && state.project.currentProject._id;
    const currentProjectSlug =
        state.project.currentProject && state.project.currentProject.slug;

    return {
        profilePic,
        project: state.project,
        notifications: state.notifications.notifications,
        incidents: state.incident.unresolvedincidents,
        currentProject: state.project.currentProject,
        currentProjectId,
        currentProjectSlug,
        monitors,
        escalation: state.schedule.escalation,
        escalations: state.schedule.escalations,
        user: state.profileSettings.profileSetting.data,
        subProjectOngoingScheduledEvents:
            state.scheduledEvent.subProjectOngoingScheduledEvent.events,
        subProjects: state.subProject?.subProjects?.subProjects,
        fetchingSubProjects: state.subProject?.subProjects?.requesting,
        activeSubProject: state.subProject?.activeSubProject,
        searchFieldVisible: state.search.searchFieldVisible || false,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            showProfileMenu,
            openFeedbackModal,
            closeFeedbackModal,
            userSettings,
            openNotificationMenu,
            fetchUserSchedule,
            userScheduleRequest,
            getVersion,
            openSideNav,
            fetchSubProjectOngoingScheduledEvents,
            openModal,
            updateProfileSetting,
            setActiveSubProject,
            fetchMonitors,
            showSearchBar,
            closeSearchBar,
            resetCreateFeedback,
        },
        dispatch
    );

TopContent.propTypes = {
    getVersion: PropTypes.func,
    openSideNav: PropTypes.func,
    userSettings: PropTypes.func.isRequired,
    openFeedbackModal: PropTypes.func.isRequired,
    closeFeedbackModal: PropTypes.func.isRequired,
    showProfileMenu: PropTypes.func.isRequired,
    openNotificationMenu: PropTypes.func.isRequired,
    showSearchBar: PropTypes.func.isRequired,
    closeSearchBar: PropTypes.func.isRequired,
    searchFieldVisible: PropTypes.bool,
    profilePic: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    notifications: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    incidents: PropTypes.shape({ incidents: PropTypes.array }),
    length: PropTypes.number,
    map: PropTypes.func,
    currentProject: PropTypes.object,
    fetchSubProjectOngoingScheduledEvents: PropTypes.func,
    monitors: PropTypes.shape({ count: PropTypes.number }),
    subProjectOngoingScheduledEvents: PropTypes.array,
    openModal: PropTypes.func.isRequired,
    escalations: PropTypes.array,
    fetchUserSchedule: PropTypes.func,
    userScheduleRequest: PropTypes.func,
    user: PropTypes.object.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    currentProjectSlug: PropTypes.string.isRequired,
    updateProfileSetting: PropTypes.func.isRequired,
    project: PropTypes.object,
    subProjects: PropTypes.array,
    fetchingSubProjects: PropTypes.bool,
    setActiveSubProject: PropTypes.func,
    activeSubProject: PropTypes.string,
    fetchMonitors: PropTypes.func,
    resetCreateFeedback: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(TopContent);
