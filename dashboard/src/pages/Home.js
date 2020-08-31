import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import { loadPage } from '../actions/page';
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
import { fetchOngoingScheduledEvents } from '../actions/scheduledEvent';
import ScheduledEventDescription from '../components/scheduledEvent/ScheduledEventDescription';
import RenderIfOwnerOrAdmin from '../components/basic/RenderIfOwnerOrAdmin';
import { subProjectTeamLoading } from '../actions/team';
import QuickTipBox from '../components/basic/QuickTipBox';
import { tutorials } from '../config';
import FeatureList from '../components/basic/FeatureList';
import uuid from 'uuid';
class Home extends Component {
    componentDidMount() {
        this.props.loadPage('Home');
        if (IS_SAAS_SERVICE) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > HOME');
        }
        this.props.userScheduleRequest();
        if (this.props.currentProjectId && this.props.user.id) {
            this.props.fetchUserSchedule(
                this.props.currentProjectId,
                this.props.user.id
            );
            this.props.fetchOngoingScheduledEvents(this.props.currentProjectId);
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
            this.props.fetchOngoingScheduledEvents(this.props.currentProjectId);
        }
    }
    getDescription(type) {
        return tutorials.getTutorials().filter(note => note.id === type);
    }
    renderFeatures(features) {
        if (features) {
            return features.map(feature => (
                <FeatureList key={uuid.v4()} content={feature} />
            ));
        }
        return null;
    }

    render() {
        const {
            escalations,
            location: { pathname },
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
                const now = (userSchedule && userSchedule.timezone
                    ? moment().tz(userSchedule.timezone)
                    : moment()
                ).format('HH:mm');
                const dayStart = moment().startOf('day');
                const dayEnd = moment().endOf('day');

                const startTime = (userSchedule && userSchedule.timezone
                    ? moment(userSchedule.startTime || dayStart).tz(
                          userSchedule.timezone
                      )
                    : moment(userSchedule.startTime || dayStart)
                ).format('HH:mm');
                const endTime = (userSchedule && userSchedule.timezone
                    ? moment(userSchedule.endTime || dayEnd).tz(
                          userSchedule.timezone
                      )
                    : moment(userSchedule.endTime || dayEnd)
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

                const tempObj = { ...userSchedule };
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
                        />
                    </RenderIfUserInSubProject>
                );
            });
        }

        let ongoingEventList;
        if (
            this.props.ongoingScheduledEvent.events &&
            this.props.ongoingScheduledEvent.events.length > 0
        ) {
            ongoingEventList = this.props.ongoingScheduledEvent.events.map(
                event => {
                    return (
                        <RenderIfUserInSubProject
                            key={event._id}
                            subProjectId={
                                event.projectId._id || event.projectId
                            }
                        >
                            <ScheduledEventDescription
                                scheduledEvent={event}
                                isOngoing={true}
                            />
                        </RenderIfUserInSubProject>
                    );
                }
            );
        }

        return (
            <Dashboard>
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

                                                                <div className="Box-root Margin-bottom--12">
                                                                    {/* Here, component and monitor notifier */}

                                                                    {this.props
                                                                        .components &&
                                                                    this.props
                                                                        .components
                                                                        .length <
                                                                        1 ? (
                                                                        <div>
                                                                            {/* No Component Notifier */}
                                                                            <QuickTipBox
                                                                                header="Create your first Component"
                                                                                title="Create your first component."
                                                                                icon={
                                                                                    this.getDescription(
                                                                                        'component'
                                                                                    )[0]
                                                                                        .icon
                                                                                }
                                                                                content={
                                                                                    <div>
                                                                                        {
                                                                                            this.getDescription(
                                                                                                'component'
                                                                                            )[0]
                                                                                                .description
                                                                                        }

                                                                                        <div>
                                                                                            <br />
                                                                                            <p>
                                                                                                Components
                                                                                                help
                                                                                                you
                                                                                                to:{' '}
                                                                                            </p>
                                                                                            <ul>
                                                                                                {this.renderFeatures(
                                                                                                    this.getDescription(
                                                                                                        'component'
                                                                                                    )[0]
                                                                                                        .features
                                                                                                )}
                                                                                            </ul>
                                                                                        </div>
                                                                                    </div>
                                                                                }
                                                                                callToActionLink={`/dashboard/project/${this.props.currentProjectId}/components`}
                                                                                callToAction="Create Component"
                                                                            />
                                                                        </div>
                                                                    ) : this
                                                                          .props
                                                                          .monitors &&
                                                                      this.props
                                                                          .monitors
                                                                          .length <
                                                                          1 ? (
                                                                        <div>
                                                                            {/* No Monitor Notifier */}
                                                                            <QuickTipBox
                                                                                header="Create a Monitor"
                                                                                title="Create a Monitor"
                                                                                icon={
                                                                                    this.getDescription(
                                                                                        'monitor'
                                                                                    )[0]
                                                                                        .icon
                                                                                }
                                                                                content={
                                                                                    <div>
                                                                                        {
                                                                                            this.getDescription(
                                                                                                'monitor'
                                                                                            )[0]
                                                                                                .description
                                                                                        }

                                                                                        <div>
                                                                                            <br />
                                                                                            <p>
                                                                                                Monitors
                                                                                                help
                                                                                                you
                                                                                                to:{' '}
                                                                                            </p>
                                                                                            <ul>
                                                                                                {this.renderFeatures(
                                                                                                    this.getDescription(
                                                                                                        'monitor'
                                                                                                    )[0]
                                                                                                        .features
                                                                                                )}
                                                                                            </ul>
                                                                                        </div>
                                                                                    </div>
                                                                                }
                                                                                callToActionLink={`/dashboard/project/${this.props.currentProjectId}/components`}
                                                                                callToAction="Create Monitor"
                                                                            />
                                                                        </div>
                                                                    ) : null}

                                                                    {/* Here, check if atleast organization has just 1 member before rendering */}

                                                                    <RenderIfOwnerOrAdmin>
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .props
                                                                                    .projectTeamMembers &&
                                                                                this
                                                                                    .props
                                                                                    .projectTeamMembers
                                                                                    .length ===
                                                                                    1
                                                                            }
                                                                        >
                                                                            <QuickTipBox
                                                                                header="Invite your Team"
                                                                                title="Invite your Team"
                                                                                icon={
                                                                                    this.getDescription(
                                                                                        'teamMember'
                                                                                    )[0]
                                                                                        .icon
                                                                                }
                                                                                content={
                                                                                    <div>
                                                                                        {
                                                                                            this.getDescription(
                                                                                                'teamMember'
                                                                                            )[0]
                                                                                                .description
                                                                                        }

                                                                                        <div>
                                                                                            <br />
                                                                                            <p>
                                                                                                Inviting
                                                                                                your
                                                                                                team
                                                                                                members
                                                                                                would
                                                                                                help
                                                                                                you
                                                                                                to:{' '}
                                                                                            </p>
                                                                                            <ul>
                                                                                                {this.renderFeatures(
                                                                                                    this.getDescription(
                                                                                                        'teamMember'
                                                                                                    )[0]
                                                                                                        .features
                                                                                                )}
                                                                                            </ul>
                                                                                        </div>
                                                                                    </div>
                                                                                }
                                                                                callToActionLink={`/dashboard/project/${this.props.currentProjectId}/team`}
                                                                                callToAction="Invite Team Member"
                                                                            />
                                                                        </ShouldRender>
                                                                    </RenderIfOwnerOrAdmin>

                                                                    {/* Here, check if atleast 1 componentsand monitor exists before deciding on incidents */}
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

                                                                <div className="Box-root Margin-bottom--12">
                                                                    {ongoingEventList &&
                                                                        ongoingEventList.length >
                                                                            0 &&
                                                                        ongoingEventList}
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
    incidents: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null, undefined]),
    ]),
    fetchOngoingScheduledEvents: PropTypes.func,
    ongoingScheduledEvent: PropTypes.object,
    projectTeamMembers: PropTypes.array,
    subProjectTeamLoading: PropTypes.func,
    monitors: PropTypes.array,
    components: PropTypes.array,
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

    return {
        currentProjectId: projectId,
        user: state.profileSettings.profileSetting.data,
        escalation: state.schedule.escalation,
        escalations: state.schedule.escalations,
        incidents: state.incident.unresolvedincidents.incidents,
        ongoingScheduledEvent: state.scheduledEvent.ongoingScheduledEvent,
        projectTeamMembers,
        components,
        monitors,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            loadPage,
            userScheduleRequest,
            fetchUserSchedule,
            fetchOngoingScheduledEvents,
            subProjectTeamLoading,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(Home);
