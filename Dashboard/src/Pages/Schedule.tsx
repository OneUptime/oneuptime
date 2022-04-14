import React, { Component } from 'react';

import { Fade } from 'react-awesome-reveal';
import DeleteBox from '../components/schedule/DeleteBox';
import MonitorBox from '../components/schedule/MonitorBox';
import RenameScheduleBox from '../components/schedule/RenameScheduleBox';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import OnCallAlertBox from '../components/schedule/OnCallAlertBox';
import PropTypes from 'prop-types';
import EscalationSummary from '../components/schedule/EscalationSummary';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { subProjectTeamLoading } from '../actions/team';
import { getEscalation } from '../actions/schedule';
import { teamLoading } from '../actions/team';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';
import ScheduleCalender from '../components/schedule/ScheduleCalender';

interface ScheduleProps {
    getEscalation: Function;
    subProjectTeamLoading: Function;
    subProjectId: string;
    scheduleId: string;
    teamLoading: Function;
    escalations: unknown[];
    teamMembers: unknown[];
    groups?: unknown[];
    location?: {
        pathname?: string
    };
    schedule?: {
        name?: string
    };
    requestingEscalations?: boolean;
    currentProject: object;
    switchToProjectViewerNav?: boolean;
    activeProjectId?: string;
    history?: object;
}

class Schedule extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { editSchedule: false, error: false };
    }

    async override componentDidMount() {
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
                this.handleError(e);
            }
        }
    }

    async componentDidUpdate(prevProps: $TSFixMe) {
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
                    this.handleError(e);
                }
            }
        }


        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            // navigate back to main section

            this.props.history.push(

                `/dashboard/project/${this.props.currentProject.slug}/on-call`
            );
        }
    }

    handleError = (e: $TSFixMe) => {
        this.setState({ error: e });
    };

    override render() {

        const { editSchedule, error } = this.state;
        const {

            escalations,

            teamMembers,

            subProjectId,

            location: { pathname },

            schedule,

            groups,

            requestingEscalations,

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const name = schedule ? schedule.name : null;
        if (error) {
            return <div></div>;
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
                                                <ScheduleCalender
                                                    escalations={escalations}
                                                    requestingEscalations={
                                                        requestingEscalations
                                                    }
                                                />
                                                <RenameScheduleBox />
                                                <MonitorBox
                                                    schedule={schedule}
                                                />

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
                                                            groups={groups}
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
            </Fade>
        );
    }
}

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    { getEscalation, subProjectTeamLoading, teamLoading },
    dispatch
);

const mapStateToProps: Function = (state: RootState, props: $TSFixMe) => {
    const { scheduleSlug } = props.match.params;

    let schedule =
        state.schedule.subProjectSchedules &&
        state.schedule.subProjectSchedules.map((subProjectSchedule: $TSFixMe) => {
            return subProjectSchedule.schedules.find(
                (schedule: $TSFixMe) => schedule.slug === scheduleSlug
            );
        });

    schedule = schedule.find(
        (schedule: $TSFixMe) => schedule && schedule.slug === scheduleSlug
    );
    const escalations = state.schedule.scheduleEscalations;
    return {
        schedule,
        escalations,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        subProjectId: schedule && schedule.projectId._id,
        scheduleId: schedule && schedule._id,
        teamMembers: state.team.teamMembers,
        groups: state.groups.oncallDuty?.groups,
        requestingEscalations: state.schedule.escalation.requesting,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject.activeSubProject,
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
    groups: PropTypes.array,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    schedule: PropTypes.shape({
        name: PropTypes.string,
    }),
    requestingEscalations: PropTypes.bool,
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
    activeProjectId: PropTypes.string,
    history: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(Schedule);
