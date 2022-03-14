import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import DeleteBox from '../components/schedule/DeleteBox';
import MonitorBox from '../components/schedule/MonitorBox';
import RenameScheduleBox from '../components/schedule/RenameScheduleBox';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import OnCallAlertBox from '../components/schedule/OnCallAlertBox';
import PropTypes from 'prop-types';
import EscalationSummary from '../components/schedule/EscalationSummary';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { subProjectTeamLoading } from '../actions/team';
import { getEscalation } from '../actions/schedule';
import { teamLoading } from '../actions/team';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import ScheduleCalender from '../components/schedule/ScheduleCalender';
class Schedule extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { editSchedule: false, error: false };
    }

    async componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleId' does not exist on type 'Read... Remove this comment to see the full error message
            scheduleId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getEscalation' does not exist on type 'R... Remove this comment to see the full error message
            getEscalation,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            subProjectTeamLoading,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamLoading' does not exist on type 'Rea... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'schedule' does not exist on type 'Readon... Remove this comment to see the full error message
            prevProps.schedule !== this.props.schedule ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            prevProps.subProjectId !== this.props.subProjectId
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                subProjectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleId' does not exist on type 'Read... Remove this comment to see the full error message
                scheduleId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getEscalation' does not exist on type 'R... Remove this comment to see the full error message
                getEscalation,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
                subProjectTeamLoading,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamLoading' does not exist on type 'Rea... Remove this comment to see the full error message
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

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            // navigate back to main section
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.history.push(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                `/dashboard/project/${this.props.currentProject.slug}/on-call`
            );
        }
    }

    handleError = (e: $TSFixMe) => {
        this.setState({ error: e });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editSchedule' does not exist on type 'Re... Remove this comment to see the full error message
        const { editSchedule, error } = this.state;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'escalations' does not exist on type 'Rea... Remove this comment to see the full error message
            escalations,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMembers' does not exist on type 'Rea... Remove this comment to see the full error message
            teamMembers,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'schedule' does not exist on type 'Readon... Remove this comment to see the full error message
            schedule,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'groups' does not exist on type 'Readonly... Remove this comment to see the full error message
            groups,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingEscalations' does not exist on... Remove this comment to see the full error message
            requestingEscalations,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
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
                                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ onEditClicked: () => void; escalations: an... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    { getEscalation, subProjectTeamLoading, teamLoading },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Schedule.displayName = 'Schedule';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
