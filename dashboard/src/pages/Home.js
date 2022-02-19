import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import { loadPage } from '../actions/page';

import { userScheduleRequest, fetchUserSchedule } from '../actions/schedule';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
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
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchErrorTrackersByProject } from '../actions/errorTracker';
import { ErrorTrackerList } from '../components/errorTracker/ErrorTrackerList';
import { fetchUnresolvedIncidents } from '../actions/incident';

class Home extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            tabIndex: 0,
        };
    }
    componentWillMount() {
        resetIdCounter();
    }
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    componentDidMount() {
        this.props.loadPage('Home');

        this.props.userScheduleRequest();
        if (this.props.currentProjectId) {
            this.props.fetchUnresolvedIncidents(
                this.props.currentProjectId,
                true
            );
            this.props.getSmtpConfig(this.props.currentProjectId);
            this.props.fetchErrorTrackersByProject(this.props.currentProjectId);
            if (this.props.currentProjectId && this.props.user.id) {
                this.props.fetchUserSchedule(
                    this.props.currentProjectId,
                    this.props.user.id
                );
                this.props.fetchSubProjectOngoingScheduledEvents(
                    this.props.currentProjectId
                );
                this.props.fetchBreachedMonitorSla(this.props.currentProjectId);
                this.props.fetchDefaultMonitorSla(this.props.currentProjectId);
            }
            this.props.subProjectTeamLoading(this.props.currentProjectId);
        }
    }

    componentDidUpdate(prevProps) {
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
            this.props.fetchSubProjectOngoingScheduledEvents(
                this.props.currentProjectId
            );
            this.props.fetchBreachedMonitorSla(this.props.currentProjectId);
            this.props.fetchDefaultMonitorSla(this.props.currentProjectId);
        }
        if (prevProps.currentProjectId !== this.props.currentProjectId) {
            this.props.subProjectTeamLoading(this.props.currentProjectId);
            this.props.fetchUnresolvedIncidents(
                this.props.currentProjectId,
                true
            );
        }
    }

    handleClosingSla = (projectId, monitorId) => {
        this.props.closeBreachedMonitorSla(projectId, monitorId);
    };

    render() {
        const {
            escalations,
            location: { pathname },
            currentProject,
            switchToProjectViewerNav,
        } = this.props;

        const userSchedules = _.flattenDeep(
            escalations.map(escalation => {
                return escalation.teams
                    .map(team => {
                        const schedule = team.teamMembers
                            .map(teamMember => teamMember)
                            .filter(user => user.userId === this.props.user.id)
                            .pop();
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

        let incidentslist;
        if (this.props.incidents) {
            incidentslist = this.props.incidents.map((incident, i) => {
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
                                this.props.multipleIncidentRequest
                            }
                            editable={false}
                        />
                    </RenderIfUserInSubProject>
                );
            });
        }
        let errorEventList;
        if (this.props.errorTrackers) {
            this.props.errorTrackers && this.props.errorTrackers.length > 0
                ? (errorEventList = (
                      <div className="Box-root Margin-vertical--12">
                          <div
                              className="db-Trends Card-root"
                              style={{ overflow: 'visible' }}
                          >
                              <ErrorTrackerList
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
            this.props.subProjectOngoingScheduledEvents &&
            this.props.subProjectOngoingScheduledEvents.length > 0
        ) {
            let ongoingScheduledEvents = this.props.subProjectOngoingScheduledEvents.map(
                eventData => eventData.ongoingScheduledEvents
            );
            ongoingScheduledEvents = flattenArray(ongoingScheduledEvents);
            ongoingEventList = ongoingScheduledEvents.map(event => (
                <RenderIfUserInSubProject
                    key={event._id}
                    subProjectId={event.projectId._id || event.projectId}
                >
                    <OngoingScheduledEvent
                        event={event}
                        monitorList={this.props.monitorList}
                        slug={this.props.slug}
                    />
                </RenderIfUserInSubProject>
            ));
        }

        let breachedMonitorSlaList;
        if (this.props.monitorSlaBreaches && this.props.monitorSlaBreaches) {
            breachedMonitorSlaList = this.props.monitorSlaBreaches.map(
                monitor =>
                    !monitor.monitorSla &&
                    !this.props
                        .defaultMonitorSla ? null : !monitor.monitorSla &&
                      this.props.defaultMonitorSla ? (
                        <RenderIfUserInSubProject
                            key={monitor._id}
                            subProjectId={
                                monitor.projectId._id || monitor.projectId
                            }
                        >
                            <BreachedMonitorSla
                                monitor={monitor}
                                sla={this.props.defaultMonitorSla}
                                userId={this.props.user.id}
                                closeSla={this.handleClosingSla}
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
                                userId={this.props.user.id}
                                closeSla={this.handleClosingSla}
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
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="Home" />
                <ShouldRender
                    if={this.props.monitors && this.props.monitors.length > 0}
                >
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
                                                onSelect={tabIndex =>
                                                    this.tabSelected(tabIndex)
                                                }
                                                selectedIndex={
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
                                                                                        .components
                                                                                }
                                                                                monitors={
                                                                                    this
                                                                                        .props
                                                                                        .monitors
                                                                                }
                                                                                tutorialStat={
                                                                                    this
                                                                                        .props
                                                                                        .tutorialStat
                                                                                }
                                                                                currentProjectId={
                                                                                    this
                                                                                        .props
                                                                                        .currentProjectId
                                                                                }
                                                                                projectTeamMembers={
                                                                                    this
                                                                                        .props
                                                                                        .projectTeamMembers
                                                                                }
                                                                                slug={
                                                                                    this
                                                                                        .props
                                                                                        .slug
                                                                                }
                                                                            />

                                                                            {/* Here, check if atleast 1 component and monitor exists before deciding on incidents */}
                                                                            {this
                                                                                .props
                                                                                .components &&
                                                                            this
                                                                                .props
                                                                                .components
                                                                                .length >
                                                                                0 &&
                                                                            this
                                                                                .props
                                                                                .monitors &&
                                                                            this
                                                                                .props
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

Home.displayName = 'Home';

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

const mapStateToProps = state => {
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    let monitors = [],
        components = [],
        projectTeamMembers = [];
    state.monitor.monitorsList.monitors.map(monitor => {
        monitors = monitors.concat(...monitor.monitors);
        return monitor;
    });
    state.component.componentList.components.map(component => {
        components = components.concat(...component.components);
        return component;
    });
    state.team.subProjectTeamMembers.map(subProjectTeamMember => {
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

const mapDispatchToProps = dispatch => {
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
