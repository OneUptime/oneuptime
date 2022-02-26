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
// @ts-expect-error ts-migrate(1192) FIXME: Module '"/home/nawazdhandala/Projects/OneUptime/ap... Remove this comment to see the full error message
import OnCallScheduleModal from '../OnCallScheduleModal';
import IncidentHeaderModal from '../modals/IncidentHeaderModal';
import ScheduleHeaderModal from '../modals/ScheduleHeaderModal';
import DataPathHoC from '../DataPathHoC';
import { openModal } from '../../actions/modal';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'loda... Remove this comment to see the full error message
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
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';

class TopContent extends Component {
    ArrowDown: $TSFixMe;
    state = { width: 0 };
    updateDimensions = () => {
        this.setState({ width: window.innerWidth });
    };

    handleChange = (value: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setActiveSubProject' does not exist on t... Remove this comment to see the full error message
        this.props.setActiveSubProject(value, true);

        // emit project id to connect to room in backend
        socket?.emit('project_switch', value);

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
        this.props.fetchMonitors(value);
        const val = history.location.pathname
            .split('project/')[1]
            .split('/')[0];
        history.push(`/dashboard/project/${val}`);
    };

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userSettings' does not exist on type 'Re... Remove this comment to see the full error message
            userSettings,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getVersion' does not exist on type 'Read... Remove this comment to see the full error message
            getVersion,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectOngoingScheduledEvents' d... Remove this comment to see the full error message
            fetchSubProjectOngoingScheduledEvents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            user,
        } = this.props;
        userSettings();
        getVersion();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userScheduleRequest' does not exist on t... Remove this comment to see the full error message
        this.props.userScheduleRequest();
        if (currentProject && currentProject._id) {
            fetchSubProjectOngoingScheduledEvents(currentProject._id);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
        if (this.props.currentProjectId && this.props.user.id) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserSchedule' does not exist on typ... Remove this comment to see the full error message
            this.props.fetchUserSchedule(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                this.props.currentProjectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.user.id
            );
        }
        if (Object.keys(user).length > 0) {
            const userData = {
                ...user,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            };
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateProfileSetting' does not exist on ... Remove this comment to see the full error message
            this.props.updateProfileSetting(userData);
        }
        this.updateDimensions();
        window.addEventListener('resize', this.updateDimensions);
    }
    componentWillUnmount() {
        window.removeEventListener('keydown', this.ArrowDown);
        window.removeEventListener('resize', this.updateDimensions);
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (prevProps.currentProject !== this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectOngoingScheduledEvents' d... Remove this comment to see the full error message
                this.props.fetchSubProjectOngoingScheduledEvents(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id
                );
        }
        if (
            (!prevProps.user.id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                this.props.currentProjectId &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.user.id) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
            (prevProps.currentProjectId !== this.props.currentProjectId &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.user.id)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserSchedule' does not exist on typ... Remove this comment to see the full error message
            this.props.fetchUserSchedule(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                this.props.currentProjectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.user.id
            );
        }
    }

    showFeedbackModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openFeedbackModal' does not exist on typ... Remove this comment to see the full error message
        this.props.openFeedbackModal();
    };

    hideFeedbackModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetCreateFeedback' does not exist on t... Remove this comment to see the full error message
        this.props.resetCreateFeedback();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeFeedbackModal' does not exist on ty... Remove this comment to see the full error message
        this.props.closeFeedbackModal();
    };

    showProfileMenu = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showProfileMenu' does not exist on type ... Remove this comment to see the full error message
        this.props.showProfileMenu(e.clientX);
    };

    showNotificationsMenu = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openNotificationMenu' does not exist on ... Remove this comment to see the full error message
        this.props.openNotificationMenu(e.clientX);
    };

    handleKeyBoard = (e: $TSFixMe) => {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.incidents.length > 0
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            unresolvedincidents = this.props.incidents.incidents.filter(
                (incident: $TSFixMe) => !incident.resolved
            );
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            content: DataPathHoC(IncidentHeaderModal, {
                status: 'active',
                incidents: unresolvedincidents,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectSlug' does not exist on ty... Remove this comment to see the full error message
                currentProjectSlug: this.props.currentProjectSlug,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                currentProjectId: this.props.currentProjectId,
            }),
        });
    };

    handleOngoingScheduleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectOngoingScheduledEvents' does n... Remove this comment to see the full error message
        const { subProjectOngoingScheduledEvents } = this.props;
        const schedules: $TSFixMe = [];
        subProjectOngoingScheduledEvents.forEach((eventData: $TSFixMe) => {
            schedules.push(...eventData.ongoingScheduledEvents);
        });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            content: DataPathHoC(ScheduleHeaderModal, {
                schedules,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectSlug' does not exist on ty... Remove this comment to see the full error message
                currentProjectSlug: this.props.currentProjectSlug,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                currentProjectId: this.props.currentProjectId,
            }),
        });
    };

    renderActiveIncidents = (incidentCounter: $TSFixMe) => <>
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
    </>;

    renderOngoingScheduledEvents = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectOngoingScheduledEvents' does n... Remove this comment to see the full error message
        const { subProjectOngoingScheduledEvents } = this.props;
        let count = 0;
        subProjectOngoingScheduledEvents.forEach((eventData: $TSFixMe) => {
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
        activeSchedules: $TSFixMe,
        currentProjectId: $TSFixMe,
        currentProjectSlug: $TSFixMe
    ) => {
        return (
            <div
                className="Box-root box__cyan5 Flex-flex Flex-direction--row Flex-alignItems--center Text-color--white Border-radius--4 Text-fontWeight--bold Padding-left--8 Padding-right--6 pointer Margin-right--20"
                style={{ paddingBottom: '6px', paddingTop: '6px' }}
                id="onCallSchedule"
                onClick={() =>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.profilePic &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.profilePic !== '' &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.profilePic !== 'null'
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
                ? `url(${API_URL}/file/${this.props.profilePic})`
                : 'url(https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y)';
        const userId = User.getUserId();
        const isNotViewer =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            !isSubProjectViewer(userId, this.props.currentProject);
        let count = 0;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications.notifications &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications.notifications.length
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications.notifications.map((notification: $TSFixMe) => {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.incidents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.incidents.incidents.length > 0
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            incidentCounter = this.props.incidents.incidents.filter(
                (incident: $TSFixMe) => !incident.resolved
            ).length;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalations' does not exist on type 'Rea... Remove this comment to see the full error message
        const { escalations } = this.props;

        const userSchedules = _.flattenDeep(
            escalations.map((escalation: $TSFixMe) => {
                return escalation.teams
                    .map((team: $TSFixMe) => {
                        const schedule = team.teamMembers.find(
                            (user: $TSFixMe) => String(user.userId) ===
                            String(
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                this.props.user.id || this.props.user._id
                            )
                        );
                        if (schedule) {
                            schedule.projectId = escalation.projectId;
                            schedule.scheduleId = escalation.scheduleId;
                        }
                        return schedule;
                    })
                    .filter((escalation: $TSFixMe) => escalation);
            })
        );

        const activeSchedules: $TSFixMe = [];
        const upcomingSchedules = [];
        const inactiveSchedules = [];

        if (userSchedules && userSchedules.length > 0) {
            userSchedules.forEach((userSchedule: $TSFixMe) => {
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

                const compareDate = (oncallstart: $TSFixMe, oncallend: $TSFixMe, now: $TSFixMe) => {
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
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            ? document.getElementById('myId').childElementCount
            : 0;
        if (topNavCardCount === 4) topNavCardClass = 'oneCardClass';
        if (topNavCardCount === 5) topNavCardClass = 'twoCardClass';
        if (topNavCardCount === 6) topNavCardClass = 'threeCardClass';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { project, searchFieldVisible, closeSearchBar } = this.props;
        const renderSearch =
            project.projects.success && project.projects.projects.length !== 0;

        let activeSubProject;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.subProjects.forEach((subProject: $TSFixMe) => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeSubProject' does not exist on type... Remove this comment to see the full error message
            if (subProject._id === this.props.activeSubProject) {
                activeSubProject = subProject.name;
            }
        });

        const loggedInUser = User.getUserId();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const showMainProject = this.props.currentProject?.users.find(
            (user: $TSFixMe) => (user.userId._id || user.userId) === loggedInUser
        );

        return (
            <div
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    <ShouldRender if={this.props.subProjects.length > 0}>
                        <SubProjectDropDown
                            value={
                                (activeSubProject &&
                                    `Current Sub Project: ${activeSubProject}`) ||
                                'Main Project'
                            }
                            options={[
                                {
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                    value: this.props.currentProject?._id,
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                    label: `${this.props.currentProject?.name}`,
                                },
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                                ...(this.props.subProjects &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                                this.props.subProjects.length > 0
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                                    ? this.props.subProjects.map(
                                          (subProject: $TSFixMe) => ({
                                              value: subProject._id,
                                              label: subProject.name
                                          })
                                      )
                                    : []),
                            ]}
                            updateState={this.handleChange}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchingSubProjects' does not exist on t... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ closeSearchBar: any; }' is not assignable ... Remove this comment to see the full error message
                                    <Search closeSearchBar={closeSearchBar} />
                                </div>
                            </ClickOutside>
                        </ShouldRender>
                        <div
                            className="Box-root"
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSideNav' does not exist on type 'Rea... Remove this comment to see the full error message
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
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ hideFeedbackModal: () => void; }' is not a... Remove this comment to see the full error message
                            hideFeedbackModal={this.hideFeedbackModal}
                        />

                        <div
                            className="Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart"
                            id="myId"
                        >
                            {userSchedules ? (
                                <>
                                    {ongoingEventList &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'length' does not exist on type 'never'.
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                                            this.props.currentProjectId,
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectSlug' does not exist on ty... Remove this comment to see the full error message
                                            this.props.currentProjectSlug,
                                            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 4.
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
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 2.
                                    topNavCardClass
                                )}

                            {isNotViewer &&
                                this.renderOngoingScheduledEvents(
                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 0 arguments, but got 1.
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showSearchBar' does not exist on type 'R... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
TopContent.displayName = 'TopContent';

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const settings = state.profileSettings.profileSetting.data;
    const profilePic = settings ? settings.profilePic : '';
    const { projectId } = props;
    const monitors = projectId
        ? state.monitor.monitorsList.monitors.find((project: $TSFixMe) => {
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
    profilePic: PropTypes.string,
    notifications: PropTypes.object,
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
