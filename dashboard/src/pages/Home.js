import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import { loadPage } from '../actions/page';
import { closeIncident } from '../actions/incident';
import { logEvent } from '../analytics';
import { userScheduleRequest, fetchUserSchedule } from '../actions/schedule';
import { IS_SAAS_SERVICE } from '../config';
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
import ComponentIssue from '../components/component/ComponentIssue';
import {
    fetchBreachedMonitorSla,
    closeBreachedMonitorSla,
} from '../actions/monitor';
import { fetchDefaultMonitorSla } from '../actions/monitorSla';
import BreachedMonitorSla from '../components/monitorSla/BreachedMonitorSla';

class Home extends Component {
    componentDidMount() {
        this.props.loadPage('Home');
        if (IS_SAAS_SERVICE) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > HOME');
        }
        this.props.userScheduleRequest();
        this.props.getSmtpConfig(this.props.currentProjectId);
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
        if (this.props.currentProjectId) {
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
        }
    }
    renderComponentIssues = () => {
        const { components, currentProjectId } = this.props;

        let componentIssueslist;
        if (components) {
            componentIssueslist = components.map((component, i) => {
                return (
                    <div key={i}>
                        <ComponentIssue
                            component={component}
                            currentProjectId={currentProjectId}
                        />
                    </div>
                );
            });
        }
        return componentIssueslist;
    };

    closeAllIncidents = async () => {
        const incidents = this.props.incidents;
        for (const incident of incidents) {
            if (incident.resolved) {
                this.props.closeIncident(incident.projectId, incident._id);
            }
        }
    };

    handleClosingSla = (projectId, monitorId) => {
        this.props.closeBreachedMonitorSla(projectId, monitorId);
    };

    render() {
        const {
            escalations,
            location: { pathname },
        } = this.props;

        const showDeleteBtn = this.props.incidents.some(
            incident => incident.resolved
        );

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
                const now = (userSchedule && userSchedule.timezone
                    ? moment().tz(userSchedule.timezone)
                    : moment()
                ).format('HH:mm');
                const dayStart = moment().startOf('day');
                const dayEnd = moment().endOf('day');

                const startTime = moment(
                    (userSchedule &&
                        userSchedule.timezone &&
                        userSchedule.startTime) ||
                        dayStart
                ).format('HH:mm');

                const endTime = moment(
                    (userSchedule &&
                        userSchedule.timezone &&
                        userSchedule.endTime) ||
                        dayEnd
                ).format('HH:mm');

                let hours = Math.ceil(
                    moment(endTime, 'HH:mm').diff(
                        moment(startTime, 'HH:mm'),
                        'minutes'
                    ) / 60
                );
                hours = hours < 0 ? hours + 24 : hours;

                let hoursToStart = Math.ceil(
                    moment(startTime, 'HH:mm').diff(
                        moment(now, 'HH:mm'),
                        'minutes'
                    ) / 60
                );
                hoursToStart =
                    hoursToStart < 0 ? hoursToStart + 24 : hoursToStart;

                const hoursToEnd = hours + hoursToStart;

                let nowToEnd = Math.ceil(
                    moment(endTime, 'HH:mm').diff(
                        moment(now, 'HH:mm'),
                        'minutes'
                    ) / 60
                );
                nowToEnd = nowToEnd < 0 ? nowToEnd + 24 : nowToEnd;

                const isUserActive =
                    (hoursToEnd !== nowToEnd || hoursToStart <= 0) &&
                    nowToEnd > 0;

                const timezone = (userSchedule && userSchedule.timezone
                    ? moment(userSchedule.startTime || dayStart).tz(
                          userSchedule.timezone
                      )
                    : moment(userSchedule.startTime || dayStart)
                ).zoneAbbr();

                const isOnDutyAllTheTime =
                    userSchedule.startTime >= userSchedule.endTime;

                const tempObj = { ...userSchedule, isOnDutyAllTheTime };
                tempObj.startTime = startTime;
                tempObj.endTime = endTime;
                tempObj.timezone = timezone;

                if (isUserActive) {
                    activeSchedules.push(tempObj);
                } else {
                    hoursToStart =
                        hoursToStart <= 0 ? hoursToStart + 24 : hoursToStart;
                    if (hoursToStart < 24) {
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
                        />
                    </RenderIfUserInSubProject>
                );
            });
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
                        projectId={this.props.currentProjectId}
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

        return (
            <Dashboard
                showDeleteBtn={showDeleteBtn}
                close={this.closeAllIncidents}
                name="Home"
            >
                <Fade>
                    <BreadCrumbItem route={pathname} name="Home" />
                    <ShouldRender
                        if={
                            this.props.monitors &&
                            this.props.monitors.length > 0
                        }
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
                                                <span>
                                                    {this.renderComponentIssues()}
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
                                                                        activeSchedules &&
                                                                        activeSchedules.length >
                                                                            0
                                                                    }
                                                                >
                                                                    <OnCallSchedule
                                                                        status="active"
                                                                        schedules={
                                                                            activeSchedules
                                                                        }
                                                                        currentProjectId={
                                                                            this
                                                                                .props
                                                                                .currentProjectId
                                                                        }
                                                                    />
                                                                </ShouldRender>

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
                                                                        currentProjectId={
                                                                            this
                                                                                .props
                                                                                .currentProjectId
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
                                                                        currentProjectId={
                                                                            this
                                                                                .props
                                                                                .currentProjectId
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
                                                                    />

                                                                    {/* Here, check if atleast 1 component and monitor exists before deciding on incidents */}
                                                                    {this.props
                                                                        .components &&
                                                                    this.props
                                                                        .components
                                                                        .length >
                                                                        0 &&
                                                                    this.props
                                                                        .monitors &&
                                                                    this.props
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
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
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
    closeIncident: PropTypes.func,
    incidents: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null, undefined]),
    ]),
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
};

const mapStateToProps = (state, props) => {
    const { projectId } = props.match.params;
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
            closeIncident,
            fetchBreachedMonitorSla,
            closeBreachedMonitorSla,
            fetchDefaultMonitorSla,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(Home);
