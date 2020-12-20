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
import { withRouter } from 'react-router';
import { subProjectTeamLoading } from '../actions/team';
import { getEscalation } from '../actions/schedule';
import { teamLoading } from '../actions/team';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
class Schedule extends Component {
    constructor(props) {
        super(props);
        this.state = { editSchedule: false, escalationPromise: null };
    }

    async componentDidMount() {
        const { subProjectId, scheduleId } = this.props;
        try {
            const response = await Promise.all([
                this.props.getEscalation(subProjectId, scheduleId),
                this.props.subProjectTeamLoading(subProjectId),
                this.props.teamLoading(subProjectId),
            ]);
            const result = response.slice(0, 1)[0].data.data;
            this.setState({ escalationPromise: result });
        } catch (e) {
            this.setState({ error: e });
        }
    }

    render() {
        const { editSchedule, error, escalationPromise } = this.state;
        const {
            escalations,
            teamMembers,
            subProjectId,
            location: { pathname },
            schedule,
            ifSchedule,
            sample
        } = this.props;
        const name = schedule ? schedule.name : null;
        const ifScheduleIsPresent = ifSchedule
            ? ifSchedule.escalationIds.length
            : null;
        if (error) {
            return <div></div>;
        }
        console.log('Escalation promise is: ',escalationPromise)
        console.log('Escalation: ',escalations)
        console.log('If schedule is: ',ifSchedule)
        console.log('Schedule State: ',sample)
        let mySchedule;
        if (
            ifScheduleIsPresent !== 0 ||
            editSchedule !== false ||
            escalations.length > 0
        ) {
            mySchedule = (
                <EscalationSummary
                    onEditClicked={() => {
                        this.setState({
                            editSchedule: true,
                        });
                    }}
                    escalations={escalationPromise}
                    teamMembers={teamMembers}
                />
            );
        } else {
            mySchedule = (
                <OnCallAlertBox
                    afterSave={() => {
                        this.setState({
                            editSchedule: false,
                        });
                    }}
                />
            );
        }
        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="On-Call Schedules"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name={name}
                        pageTitle="Schedule"
                        containerType="Call Schedule"
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
                                                    <MonitorBox />

                                                    {mySchedule}

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
    let ifSchedule;
    state.schedule.subProjectSchedules.forEach(item => {
        item.schedules.forEach(item => {
            if (scheduleId === item._id) {
                ifSchedule = item;
            }
        });
    });
    let sample = state.schedule;
    
    const escalations = state.schedule.escalations;
    const { projectId } = props.match.params;

    const { subProjectId } = props.match.params;
    return {
        sample,
        ifSchedule,
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
    ifSchedule: PropTypes.object,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(Schedule)
);
