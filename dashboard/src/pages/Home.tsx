import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import { loadPage } from '../actions/page';

import { userScheduleRequest, fetchUserSchedule } from '../actions/schedule';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import _ from 'lodash';
import moment from 'moment-timezone';
import OnCallSchedule from '../components/onCall/OnCallSchedule';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
import IncidentStatus from '../components/incident/IncidentStatus';
import { fetchSubProjectOngoingScheduledEvents } from '../actions/scheduledEvent';
import { subProjectTeamLoading } from '../actions/team';
import { getSmtpConfig } from '../actions/smsTemplates';
import OngoingScheduledEvent from '../components/scheduledEvent/OngoingScheduledEvent';
import flattenArray from '../utils/flattenArray';
import CustomTutorial from '../components/tutorial/CustomTutorial';
import {
    fetchBreachedMonitorSla,
    closeBreachedMonitorSla,
} from '../actions/monitor';
import { fetchDefaultMonitorSla } from '../actions/monitorSla';
import BreachedMonitorSla from '../components/monitorSla/BreachedMonitorSla';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchErrorTrackersByProject } from '../actions/errorTracker';
import { ErrorTrackerList } from '../components/errorTracker/ErrorTrackerList';
import { fetchUnresolvedIncidents } from '../actions/incident';

class Home extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            tabIndex: 0,
        };
    }
    componentWillMount() {
        resetIdCounter();
    }
    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'loadPage' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.loadPage('Home');

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userScheduleRequest' does not exist on t... Remove this comment to see the full error message
        this.props.userScheduleRequest();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
        if (this.props.currentProjectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUnresolvedIncidents' does not exist... Remove this comment to see the full error message
            this.props.fetchUnresolvedIncidents(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                this.props.currentProjectId,
                true
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getSmtpConfig' does not exist on type 'R... Remove this comment to see the full error message
            this.props.getSmtpConfig(this.props.currentProjectId);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackersByProject' does not ex... Remove this comment to see the full error message
            this.props.fetchErrorTrackersByProject(this.props.currentProjectId);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
            if (this.props.currentProjectId && this.props.user.id) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUserSchedule' does not exist on typ... Remove this comment to see the full error message
                this.props.fetchUserSchedule(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                    this.props.currentProjectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    this.props.user.id
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectOngoingScheduledEvents' d... Remove this comment to see the full error message
                this.props.fetchSubProjectOngoingScheduledEvents(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                    this.props.currentProjectId
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchBreachedMonitorSla' does not exist ... Remove this comment to see the full error message
                this.props.fetchBreachedMonitorSla(this.props.currentProjectId);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultMonitorSla' does not exist o... Remove this comment to see the full error message
                this.props.fetchDefaultMonitorSla(this.props.currentProjectId);
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            this.props.subProjectTeamLoading(this.props.currentProjectId);
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSubProjectOngoingScheduledEvents' d... Remove this comment to see the full error message
            this.props.fetchSubProjectOngoingScheduledEvents(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                this.props.currentProjectId
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchBreachedMonitorSla' does not exist ... Remove this comment to see the full error message
            this.props.fetchBreachedMonitorSla(this.props.currentProjectId);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultMonitorSla' does not exist o... Remove this comment to see the full error message
            this.props.fetchDefaultMonitorSla(this.props.currentProjectId);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
        if (prevProps.currentProjectId !== this.props.currentProjectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            this.props.subProjectTeamLoading(this.props.currentProjectId);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchUnresolvedIncidents' does not exist... Remove this comment to see the full error message
            this.props.fetchUnresolvedIncidents(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                this.props.currentProjectId,
                true
            );
        }
    }

    handleClosingSla = (projectId: $TSFixMe, monitorId: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeBreachedMonitorSla' does not exist ... Remove this comment to see the full error message
        this.props.closeBreachedMonitorSla(projectId, monitorId);
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalations' does not exist on type 'Rea... Remove this comment to see the full error message
            escalations,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;

        const userSchedules = _.flattenDeep(
            escalations.map((escalation: $TSFixMe) => {
                return escalation.teams
                    .map((team: $TSFixMe) => {
                        const schedule = team.teamMembers
                            .map((teamMember: $TSFixMe) => teamMember)
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            .filter((user: $TSFixMe) => user.userId === this.props.user.id)
                            .pop();
                        if (schedule) {
                            schedule.projectId = escalation.projectId;
                            schedule.scheduleId = escalation.scheduleId;
                        }
                        return schedule;
                    })
                    .filter((escalation: $TSFixMe) => escalation);
            })
        );

        const activeSchedules = [];
        const upcomingSchedules: $TSFixMe = [];
        const inactiveSchedules: $TSFixMe = [];

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

        let incidentslist;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
        if (this.props.incidents) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            incidentslist = this.props.incidents.map((incident: $TSFixMe, i: $TSFixMe) => {
                return (
                    <RenderIfUserInSubProject
                        key={`${incident._id || i}`}
                        subProjectId={
                            incident.projectId._id || incident.projectId
                        }
                    >
                        <IncidentStatus
                            count={i}
                            incident={incident}
                            multiple={true}
                            route={pathname}
                            multipleIncidentRequest={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleIncidentRequest' does not exist ... Remove this comment to see the full error message
                                this.props.multipleIncidentRequest
                            }
                            editable={false}
                        />
                    </RenderIfUserInSubProject>
                );
            });
        }
        let errorEventList;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackers' does not exist on type 'R... Remove this comment to see the full error message
        if (this.props.errorTrackers) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackers' does not exist on type 'R... Remove this comment to see the full error message
            this.props.errorTrackers && this.props.errorTrackers.length > 0
                ? (errorEventList = (
                    <div className="Box-root Margin-vertical--12">
                        <div
                            className="db-Trends Card-root"
                            style={{ overflow: 'visible' }}
                        >
                            <ErrorTrackerList
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackers' does not exist on type 'R... Remove this comment to see the full error message
                                errorTrackers={this.props.errorTrackers}
                                showComponentWithIssue={true}
                            />
                        </div>
                    </div>
                ))
                : (errorEventList = (
                    <div>
                        <div className="Box-root Margin-bottom--12 Card-shadow--medium Box-background--green Border-radius--4">
                            <div className="db-Trends-header Padding-vertical--48">
                                <div className="db-Trends-controls">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                <span className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--center">
                                                    <span
                                                        className="db-SideNav-icon db-SideNav-icon--tick db-SideNav-icon--selected"
                                                        style={{
                                                            filter:
                                                                'brightness(0) invert(1)',
                                                            marginTop: '1px',
                                                            marginRight:
                                                                '5px',
                                                        }}
                                                    />
                                                    <span
                                                        id="component-content-header"
                                                        className="ContentHeader-title Text-color--white Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        You currently
                                                        don&apos;t have any
                                                        error events.
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ));
        }

        let ongoingEventList;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectOngoingScheduledEvents' does n... Remove this comment to see the full error message
            this.props.subProjectOngoingScheduledEvents &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectOngoingScheduledEvents' does n... Remove this comment to see the full error message
            this.props.subProjectOngoingScheduledEvents.length > 0
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectOngoingScheduledEvents' does n... Remove this comment to see the full error message
            let ongoingScheduledEvents = this.props.subProjectOngoingScheduledEvents.map(
                (eventData: $TSFixMe) => eventData.ongoingScheduledEvents
            );
            ongoingScheduledEvents = flattenArray(ongoingScheduledEvents);
            ongoingEventList = ongoingScheduledEvents.map((event: $TSFixMe) => <RenderIfUserInSubProject
                key={event._id}
                subProjectId={event.projectId._id || event.projectId}
            >
                <OngoingScheduledEvent
                    event={event}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorList' does not exist on type 'Rea... Remove this comment to see the full error message
                    monitorList={this.props.monitorList}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    slug={this.props.slug}
                />
            </RenderIfUserInSubProject>);
        }

        let breachedMonitorSlaList;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSlaBreaches' does not exist on ty... Remove this comment to see the full error message
        if (this.props.monitorSlaBreaches && this.props.monitorSlaBreaches) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSlaBreaches' does not exist on ty... Remove this comment to see the full error message
            breachedMonitorSlaList = this.props.monitorSlaBreaches.map(
                (monitor: $TSFixMe) => !monitor.monitorSla &&
                    !this.props
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultMonitorSla' does not exist on typ... Remove this comment to see the full error message
                        .defaultMonitorSla ? null : !monitor.monitorSla &&
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultMonitorSla' does not exist on typ... Remove this comment to see the full error message
                            this.props.defaultMonitorSla ? (
                    <RenderIfUserInSubProject
                        key={monitor._id}
                        subProjectId={
                            monitor.projectId._id || monitor.projectId
                        }
                    >
                        <BreachedMonitorSla
                            monitor={monitor}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultMonitorSla' does not exist on typ... Remove this comment to see the full error message
                            sla={this.props.defaultMonitorSla}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            userId={this.props.user.id}
                            closeSla={this.handleClosingSla}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closingSla' does not exist on type 'Read... Remove this comment to see the full error message
                            closingSla={this.props.closingSla}
                        />
                    </RenderIfUserInSubProject>
                ) : (
                    <RenderIfUserInSubProject
                        key={monitor._id}
                        subProjectId={
                            monitor.projectId._id || monitor.projectId
                        }
                    >
                        <BreachedMonitorSla
                            monitor={monitor}
                            sla={monitor.monitorSla}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            userId={this.props.user.id}
                            closeSla={this.handleClosingSla}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closingSla' does not exist on type 'Read... Remove this comment to see the full error message
                            closingSla={this.props.closingSla}
                        />
                    </RenderIfUserInSubProject>
                )
            );
        }

        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="Home" />
                <ShouldRender
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                    if={this.props.monitors && this.props.monitors.length > 0}
                >
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{page: string; }' is not assignable to type... Remove this comment to see the full error message
                    <AlertDisabledWarning page="Home" />
                </ShouldRender>
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="dashboard-home-view react-view">
                                    <div>
                                        <div>
                                            <Tabs
                                                selectedTabClassName={
                                                    'custom-tab-selected'
                                                }
                                                onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)
                                                }
                                                selectedIndex={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabIndex' does not exist on type 'Readon... Remove this comment to see the full error message
                                                    this.state.tabIndex
                                                }
                                            >
                                                <div className="Flex-flex Flex-direction--columnReverse">
                                                    <TabList
                                                        id="customTabList"
                                                        className={
                                                            'custom-tab-list'
                                                        }
                                                    >
                                                        <Tab
                                                            className={
                                                                'custom-tab custom-tab-2'
                                                            }
                                                        >
                                                            Incidents
                                                        </Tab>
                                                        <Tab
                                                            className={
                                                                'custom-tab custom-tab-2'
                                                            }
                                                        >
                                                            Error Events
                                                        </Tab>
                                                        <div
                                                            id="tab-slider"
                                                            className="custom-tab-2"
                                                        ></div>
                                                    </TabList>
                                                </div>

                                                <TabPanel>
                                                    <Fade>
                                                        <span>
                                                            <ShouldRender
                                                                if={
                                                                    !this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalation' does not exist on type 'Read... Remove this comment to see the full error message
                                                                        .escalation
                                                                        .requesting
                                                                }
                                                            >
                                                                {userSchedules ? (
                                                                    <>
                                                                        <ShouldRender
                                                                            if={
                                                                                upcomingSchedules &&
                                                                                upcomingSchedules.length >
                                                                                0
                                                                            }
                                                                        >
                                                                            <OnCallSchedule
                                                                                status="upcoming"
                                                                                schedules={
                                                                                    upcomingSchedules
                                                                                }
                                                                                slug={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                                        .slug
                                                                                }
                                                                            />
                                                                        </ShouldRender>

                                                                        <ShouldRender
                                                                            if={
                                                                                inactiveSchedules &&
                                                                                inactiveSchedules.length >
                                                                                0
                                                                            }
                                                                        >
                                                                            <OnCallSchedule
                                                                                status="inactive"
                                                                                schedules={
                                                                                    inactiveSchedules
                                                                                }
                                                                                slug={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                                        .slug
                                                                                }
                                                                            />
                                                                        </ShouldRender>

                                                                        {ongoingEventList &&
                                                                            ongoingEventList.length >
                                                                            0 &&
                                                                            ongoingEventList}

                                                                        {breachedMonitorSlaList &&
                                                                            breachedMonitorSlaList.length >
                                                                            0 &&
                                                                            breachedMonitorSlaList}

                                                                        <div className="Box-root Margin-bottom--12">
                                                                            {/* Here, component, monitor and team member notifier */}
                                                                            <CustomTutorial
                                                                                components={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'components' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                        .components
                                                                                }
                                                                                monitors={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                        .monitors
                                                                                }
                                                                                tutorialStat={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                                                                        .tutorialStat
                                                                                }
                                                                                currentProjectId={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProjectId' does not exist on type... Remove this comment to see the full error message
                                                                                        .currentProjectId
                                                                                }
                                                                                projectTeamMembers={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectTeamMembers' does not exist on ty... Remove this comment to see the full error message
                                                                                        .projectTeamMembers
                                                                                }
                                                                                slug={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                                        .slug
                                                                                }
                                                                            />

                                                                            {/* Here, check if atleast 1 component and monitor exists before deciding on incidents */}
                                                                            {this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'components' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                .components &&
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'components' does not exist on type 'Read... Remove this comment to see the full error message
                                                                                    .components
                                                                                    .length >
                                                                                0 &&
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .monitors &&
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                                                                                    .monitors
                                                                                    .length >
                                                                                0 ? (
                                                                                incidentslist &&
                                                                                    incidentslist.length >
                                                                                    0 ? (
                                                                                    incidentslist
                                                                                ) : (
                                                                                    <div>
                                                                                        <div className="Box-root Margin-bottom--12 Card-shadow--medium Box-background--green Border-radius--4">
                                                                                            <div className="db-Trends-header Padding-vertical--48">
                                                                                                <div className="db-Trends-controls">
                                                                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                                                                <span className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--center">
                                                                                                                    <span
                                                                                                                        className="db-SideNav-icon db-SideNav-icon--tick db-SideNav-icon--selected"
                                                                                                                        style={{
                                                                                                                            filter:
                                                                                                                                'brightness(0) invert(1)',
                                                                                                                            marginTop:
                                                                                                                                '1px',
                                                                                                                            marginRight:
                                                                                                                                '5px',
                                                                                                                        }}
                                                                                                                    />
                                                                                                                    <span
                                                                                                                        id="component-content-header"
                                                                                                                        className="ContentHeader-title Text-color--white Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-wrap--wrap"
                                                                                                                    >
                                                                                                                        You
                                                                                                                        currently
                                                                                                                        don&apos;t
                                                                                                                        have
                                                                                                                        any
                                                                                                                        active
                                                                                                                        incidents.
                                                                                                                    </span>
                                                                                                                </span>
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                )
                                                                            ) : null}
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    ''
                                                                )}
                                                            </ShouldRender>

                                                            <ShouldRender
                                                                if={
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalation' does not exist on type 'Read... Remove this comment to see the full error message
                                                                        .escalation
                                                                        .requesting
                                                                }
                                                            >
                                                                <LoadingState />
                                                            </ShouldRender>
                                                        </span>
                                                    </Fade>
                                                </TabPanel>
                                                <TabPanel>
                                                    <div>{errorEventList}</div>
                                                </TabPanel>
                                            </Tabs>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Home.displayName = 'Home';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Home.propTypes = {
    currentProjectId: PropTypes.string.isRequired,
    user: PropTypes.object.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    loadPage: PropTypes.func,
    userScheduleRequest: PropTypes.func,
    fetchUserSchedule: PropTypes.func,
    escalation: PropTypes.object,
    escalations: PropTypes.array,
    slug: PropTypes.string,
    incidents: PropTypes.array,
    projectTeamMembers: PropTypes.array,
    subProjectTeamLoading: PropTypes.func,
    monitors: PropTypes.array,
    components: PropTypes.array,
    monitorList: PropTypes.array,
    fetchSubProjectOngoingScheduledEvents: PropTypes.func,
    subProjectOngoingScheduledEvents: PropTypes.array,
    multipleIncidentRequest: PropTypes.object,
    tutorialStat: PropTypes.object,
    getSmtpConfig: PropTypes.func.isRequired,
    fetchBreachedMonitorSla: PropTypes.func,
    fetchDefaultMonitorSla: PropTypes.func,
    closeBreachedMonitorSla: PropTypes.func,
    monitorSlaBreaches: PropTypes.array,
    defaultMonitorSla: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null]),
    ]),
    closingSla: PropTypes.bool,
    fetchErrorTrackersByProject: PropTypes.func,
    errorTrackers: PropTypes.array,
    fetchUnresolvedIncidents: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
    currentProject: PropTypes.object,
};

const mapStateToProps = (state: $TSFixMe) => {
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    let monitors: $TSFixMe = [],
        components: $TSFixMe = [],
        projectTeamMembers: $TSFixMe = [];
    state.monitor.monitorsList.monitors.map((monitor: $TSFixMe) => {
        monitors = monitors.concat(...monitor.monitors);
        return monitor;
    });
    state.component.componentList.components.map((component: $TSFixMe) => {
        components = components.concat(...component.components);
        return component;
    });
    state.team.subProjectTeamMembers.map((subProjectTeamMember: $TSFixMe) => {
        projectTeamMembers = projectTeamMembers.concat(
            ...subProjectTeamMember.teamMembers
        );
        return subProjectTeamMember;
    });
    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the 3 custom tutorials to display on the Home Page
    const tutorialStat = {
        componentCustom: { show: true },
        monitorCustom: { show: true },
        teamMemberCustom: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }
    return {
        currentProjectId: projectId,
        user: state.profileSettings.profileSetting.data,
        escalation: state.schedule.escalation,
        escalations: state.schedule.escalations,
        incidents: state.incident.unresolvedincidents.incidents,
        projectTeamMembers,
        components,
        monitors,
        monitorList: state.monitor.monitorsList.monitors,
        subProjectOngoingScheduledEvents:
            state.scheduledEvent.subProjectOngoingScheduledEvent.events,
        multipleIncidentRequest: state.incident.unresolvedincidents,
        tutorialStat,
        monitorSlaBreaches: state.monitor.monitorSlaBreaches.slaBreaches,
        defaultMonitorSla: state.monitorSla.defaultMonitorSla.sla,
        closingSla: state.monitor.closeBreachedMonitorSla.requesting,
        errorTrackers: state.errorTracker.errorTrackersList.errorTrackers,
        slug: state.project.currentProject && state.project.currentProject.slug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        currentProject: state.project.currentProject,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            loadPage,
            userScheduleRequest,
            fetchUserSchedule,
            subProjectTeamLoading,
            fetchSubProjectOngoingScheduledEvents,
            getSmtpConfig,
            fetchBreachedMonitorSla,
            closeBreachedMonitorSla,
            fetchDefaultMonitorSla,
            fetchErrorTrackersByProject,
            fetchUnresolvedIncidents,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(Home);
