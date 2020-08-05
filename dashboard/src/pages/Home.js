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
        }
    }

    render() {
        const {
            escalations,
            location: { pathname },
        } = this.props;

        const userSchedules = _.flattenDeep(
            escalations.map(escalation => {
                return escalation.teams.map(team => {
                    const schedule = team.teamMembers
                        .map(teamMember => teamMember)
                        .filter(user => user.userId === this.props.user.id)
                        .pop();
                    schedule.scheduleId = escalation.scheduleId;
                    return schedule;
                });
            })
        );

        const activeSchedules = [];
        const upcomingSchedules = [];
        const inactiveSchedules = [];

        if (userSchedules) {
            userSchedules.forEach(userSchedule => {
                const startTime = moment(userSchedule.startTime)
                    .tz(userSchedule.timezone)
                    .format('HH:mm');
                const endTime = moment(userSchedule.endTime)
                    .tz(userSchedule.timezone)
                    .format('HH:mm');
                const now = moment()
                    .tz(userSchedule.timezone)
                    .format('HH:mm');
                const isUserActive =
                    moment(now, 'HH:mm').isAfter(moment(startTime, 'HH:mm')) &&
                    moment(now, 'HH:mm').isBefore(moment(endTime, 'HH:mm'));
                const timezone = moment(userSchedule.startTime)
                    .tz(userSchedule.timezone)
                    .zoneAbbr();
                const tempObj = { ...userSchedule };
                tempObj.startTime = startTime;
                tempObj.endTime = endTime;
                tempObj.timezone = timezone;

                if (isUserActive) {
                    activeSchedules.push(tempObj);
                } else {
                    inactiveSchedules.push(tempObj);
                }
            });
        }

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Home" />
                    <AlertDisabledWarning page="Home" />
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
    user: PropTypes.string.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    loadPage: PropTypes.func,
    userScheduleRequest: PropTypes.func,
    fetchUserSchedule: PropTypes.func,
    escalation: PropTypes.object,
    escalations: PropTypes.array,
};

const mapStateToProps = (state, props) => {
    const { projectId } = props.match.params;

    return {
        currentProjectId: projectId,
        user: state.profileSettings.profileSetting.data,
        escalation: state.schedule.escalation,
        escalations: state.schedule.escalations,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            loadPage,
            userScheduleRequest,
            fetchUserSchedule,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(Home);
