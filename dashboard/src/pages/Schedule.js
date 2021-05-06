import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import DeleteBox from '../components/schedule/DeleteBox';
import MonitorBox from '../components/schedule/MonitorBox';
import RenameScheduleBox from '../components/schedule/RenameScheduleBox';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import OnCallAlertBox from '../components/schedule/OnCallAlertBox';
import PropTypes from 'prop-types';
import EscalationSummary from '../components/schedule/EscalationSummary';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchSubProject } from '../actions/subProject';
import { withRouter } from 'react-router';
import { subProjectTeamLoading } from '../actions/team';
import { getEscalation } from '../actions/schedule';
import { teamLoading } from '../actions/team';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
class Schedule extends Component {
    constructor(props) {
        super(props);
        this.state = { editSchedule: false };
    }
    componentDidMount() {
        this.props.fetchSubProject(this.props.subProjectSlug);
    }
    async componentDidUpdate(prevProps) {
        if (
            prevProps.schedule !== this.props.schedule ||
            prevProps.subProjectId !== this.props.subProjectId
        ) {
            const {
                subProjectId,
                scheduleId,
                getEscalation,
                subProjectTeamLoading,
                teamLoading,
            } = this.props;
            if (scheduleId && subProjectId) {
                try {
                    await Promise.all([
                        getEscalation(subProjectId, scheduleId),
                        subProjectTeamLoading(subProjectId),
                        teamLoading(subProjectId),
                    ]);
                } catch (e) {
                    this.setState({ error: e });
                }
            }
        }
    }

    render() {
        const { editSchedule, error } = this.state;
        const {
            escalations,
            teamMembers,
            subProjectId,
            location: { pathname },
            schedule,
        } = this.props;
        const name = schedule ? schedule.name : null;
        if (error) {
            return <div></div>;
        }

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="On-Call Duty"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name={name}
                        pageTitle="Schedule"
                        containerType="Call Duty"
                    />
                    <div className="Box-root">
                        <div>
                            <div>
                                <div className="db-BackboneViewContainer">
                                    <div className="react-settings-view react-view">
                                        <span>
                                            <div>
                                                <div>
                                                    <RenameScheduleBox />
                                                    <MonitorBox
                                                        schedule={schedule}
                                                    />

                                                    {!editSchedule &&
                                                        escalations.length >
                                                            0 && (
                                                            <EscalationSummary
                                                                onEditClicked={() => {
                                                                    this.setState(
                                                                        {
                                                                            editSchedule: true,
                                                                        }
                                                                    );
                                                                }}
                                                                escalations={
                                                                    escalations
                                                                }
                                                                teamMembers={
                                                                    teamMembers
                                                                }
                                                            />
                                                        )}

                                                    {(editSchedule ||
                                                        escalations.length ===
                                                            0) && (
                                                        <OnCallAlertBox
                                                            afterSave={() => {
                                                                this.setState({
                                                                    editSchedule: false,
                                                                });
                                                            }}
                                                        />
                                                    )}

                                                    <RenderIfSubProjectAdmin
                                                        subProjectId={
                                                            subProjectId
                                                        }
                                                    >
                                                        <DeleteBox />
                                                    </RenderIfSubProjectAdmin>
                                                </div>
                                            </div>
                                        </span>
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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getEscalation, subProjectTeamLoading, teamLoading, fetchSubProject },
        dispatch
    );

const mapStateToProps = (state, props) => {
    const { scheduleSlug, subProjectSlug } = props.match.params;

    let schedule = state.schedule.subProjectSchedules.map(
        subProjectSchedule => {
            return subProjectSchedule.schedules.find(
                schedule => schedule.slug === scheduleSlug
            );
        }
    );

    schedule = schedule.find(
        schedule => schedule && schedule.slug === scheduleSlug
    );
    const escalations = state.schedule.scheduleEscalations;
    return {
        schedule,
        escalations,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        subProjectId:
            state.subProject.currentSubProject.subProject &&
            state.subProject.currentSubProject.subProject._id,
        scheduleId: schedule && schedule._id,
        subProjectSlug,
        teamMembers: state.team.teamMembers,
    };
};

Schedule.displayName = 'Schedule';

Schedule.propTypes = {
    getEscalation: PropTypes.func.isRequired,
    subProjectTeamLoading: PropTypes.func.isRequired,
    subProjectId: PropTypes.string.isRequired,
    subProjectSlug: PropTypes.string.isRequired,
    fetchSubProject: PropTypes.func.isRequired,
    scheduleId: PropTypes.string.isRequired,
    teamLoading: PropTypes.func.isRequired,
    escalations: PropTypes.array.isRequired,
    teamMembers: PropTypes.array.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    schedule: PropTypes.shape({
        name: PropTypes.string,
    }),
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(Schedule)
);
