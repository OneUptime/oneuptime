import React, { Component } from 'react';
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

    async componentDidMount() {
        this.setState({ isLoading: true });

        const { subProjectId, scheduleId } = this.props;
        try {
            await Promise.all([
                this.props.getEscalation(subProjectId, scheduleId),
                this.props.subProjectTeamLoading(subProjectId),
                this.props.teamLoading(subProjectId),
            ]);

            this.setState({ isLoading: false, error: null });
        } catch (e) {
            this.setState({ error: e, isLoading: false });
        }
    }

    render() {
        const { editSchedule, isLoading, error } = this.state;

        const {
            escalations,
            teamMembers,
            subProjectId,
            location: { pathname },
            schedule,
        } = this.props;
        const name = schedule ? schedule.name : null;

        if (isLoading) {
            return <div></div>;
        }

        if (error) {
            return <div></div>;
        }

        return (
            <Dashboard>
                <BreadCrumbItem
                    route={getParentRoute(pathname)}
                    name="Call Schedules"
                />
                <BreadCrumbItem route={pathname} name={name} />
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <div>
                                                <RenameScheduleBox />

                                                <MonitorBox />

                                                {!editSchedule &&
                                                    escalations.length > 0 && (
                                                        <EscalationSummary
                                                            onEditClicked={() => {
                                                                this.setState({
                                                                    editSchedule: true,
                                                                });
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
                                                    subProjectId={subProjectId}
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
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getEscalation, subProjectTeamLoading, teamLoading },
        dispatch
    );

const mapStateToProps = (state, props) => {
    const { scheduleId } = props.match.params;

    let schedule = state.schedule.subProjectSchedules.map(
        subProjectSchedule => {
            return subProjectSchedule.schedules.find(
                schedule => schedule._id === scheduleId
            );
        }
    );

    schedule = schedule.find(
        schedule => schedule && schedule._id === scheduleId
    );
    const escalations = state.schedule.escalations;
    const { projectId } = props.match.params;

    const { subProjectId } = props.match.params;
    return {
        schedule,
        escalations,
        projectId,
        subProjectId,
        scheduleId,
        teamMembers: state.team.teamMembers,
    };
};

Schedule.displayName = 'Schedule';

Schedule.propTypes = {
    getEscalation: PropTypes.func.isRequired,
    subProjectTeamLoading: PropTypes.func.isRequired,
    subProjectId: PropTypes.string.isRequired,
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
