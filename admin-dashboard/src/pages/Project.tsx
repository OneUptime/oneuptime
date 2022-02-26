import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import ProjectDetails from '../components/project/ProjectDetails';
import ProjectDeleteBox from '../components/project/ProjectDeleteBox';
import ProjectRestoreBox from '../components/project/ProjectRestoreBox';
import ProjectBlockBox from '../components/project/ProjectBlockBox';
import ProjectAlertLimitBox from '../components/project/ProjectAlertLimitBox';
import ProjectUnblockBox from '../components/project/ProjectUnblockBox';
import ProjectUsers from '../components/project/ProjectUsers';
import ProjectUpgrade from '../components/project/ProjectUpgrade';
import AdminNotes from '../components/adminNote/AdminNotes';
import { addProjectNote, fetchProject, paginate } from '../actions/project';
import { IS_SAAS_SERVICE } from '../config';
import { fetchProjectTeam } from '../actions/project';
import ProjectBalance from '../components/project/ProjectBalance';
import ProjectDomain from '../components/project/ProjectDomain';

class Project extends Component {
    componentDidMount = async () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProject' does not exist on type 'Re... Remove this comment to see the full error message
        this.props.fetchProject(this.props.slug);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (this.props.project._id) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectTeam' does not exist on type... Remove this comment to see the full error message
            this.props.fetchProjectTeam(this.props.project._id);
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProject' does not exist on type 'Re... Remove this comment to see the full error message
        const { fetchProject, slug, fetchProjectTeam, project } = this.props;
        fetchProject(slug);
        if (project._id) {
            fetchProjectTeam(project._id);
        }
    };

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (prevProps.project._id !== this.props.project._id) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            if (this.props.project._id) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectTeam' does not exist on type... Remove this comment to see the full error message
                this.props.fetchProjectTeam(this.props.project._id);
            }
        }
    }

    render() {
        return (
            <div className="Box-root Margin-vertical--12">
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span data-reactroot="">
                                    <div>
                                        <div className="Box-root Margin-bottom--12">
                                            <ProjectDetails />
                                        </div>
                                        <div className="Box-root Margin-bottom--12">
                                            <AdminNotes
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ id: any; addNote: any; initialValues: any;... Remove this comment to see the full error message
                                                id={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project._id
                                                }
                                                addNote={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addProjectNote' does not exist on type '... Remove this comment to see the full error message
                                                    this.props.addProjectNote
                                                }
                                                initialValues={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                                    this.props.initialValues
                                                }
                                            />
                                        </div>
                                        <div className="Box-root Margin-bottom--12">
                                            <ProjectUsers
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ paginate: any; projectName: any; users: an... Remove this comment to see the full error message
                                                paginate={this.props.paginate}
                                                projectName={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project.name
                                                }
                                                users={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers.team
                                                }
                                                projectId={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project._id
                                                }
                                                pages={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers.page
                                                }
                                                membersPerPage={10}
                                                count={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers
                                                        .team &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers.team
                                                        .count
                                                }
                                                page={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers.page
                                                }
                                                canPaginateBackward={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers
                                                        .page > 1
                                                        ? true
                                                        : false
                                                }
                                                canPaginateForward={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers
                                                        .team &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.projectUsers.team
                                                        .count >
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectUsers' does not exist on type 'Re... Remove this comment to see the full error message
                                                        this.props.projectUsers
                                                            .page *
                                                            10
                                                        ? true
                                                        : false
                                                }
                                            />
                                        </div>
                                        <div className="Box-root Margin-bottom--12">
                                            <ProjectDomain
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; }' is not assignable to ty... Remove this comment to see the full error message
                                                projectId={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project._id
                                                }
                                            />
                                        </div>
                                        <div className="Box-root Margin-bottom--12">
                                            <ProjectBalance
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ balance: any; projectId: any; }' is not as... Remove this comment to see the full error message
                                                balance={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project.balance
                                                }
                                                projectId={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.project._id
                                                }
                                            />
                                        </div>
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                !this.props.project.deleted &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                !this.props.project.isBlocked &&
                                                IS_SAAS_SERVICE
                                            }
                                        >
                                            <div className="Box-root Margin-bottom--12">
                                                <ProjectUpgrade />
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                !this.props.project.deleted &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                !this.props.project.isBlocked
                                            }
                                        >
                                            <div className="Box-root Margin-bottom--12">
                                                <ProjectBlockBox />
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project
                                                    .alertLimitReached
                                            }
                                        >
                                            <div className="Box-root Margin-bottom--12">
                                                <ProjectAlertLimitBox />
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                !this.props.project.deleted &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project.isBlocked
                                            }
                                        >
                                            <div className="Box-root Margin-bottom--12">
                                                <ProjectUnblockBox />
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                !this.props.project.deleted
                                            }
                                        >
                                            <div className="Box-root Margin-bottom--12">
                                                <ProjectDeleteBox />
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                this.props.project.deleted
                                            }
                                        >
                                            <div className="Box-root Margin-bottom--12">
                                                <ProjectRestoreBox />
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            addProjectNote,
            fetchProject,
            fetchProjectTeam,
            paginate,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const project = state.project.project.project || {};
    const projectUsers = state.project.projectTeam;
    const { slug } = props.match.params;
    return {
        project,
        slug,
        projectUsers,
        adminNote: state.adminNote,
        initialValues: { adminNotes: project.adminNotes || [] },
    };
};

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
Project.contextTypes = {};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Project.propTypes = {
    addProjectNote: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
    fetchProject: PropTypes.func.isRequired,
    project: PropTypes.object.isRequired,
    fetchProjectTeam: PropTypes.func.isRequired,
    projectUsers: PropTypes.object.isRequired,
    paginate: PropTypes.func.isRequired,
    slug: PropTypes.string,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Project.displayName = 'Project';

export default connect(mapStateToProps, mapDispatchToProps)(Project);
