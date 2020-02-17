import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import { subProjectTeamLoading, subProjectTeamLoadingRequest, subProjectTeamLoadingSuccess, subProjectTeamLoadingError, paginate } from '../actions/team';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import uuid from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import TeamMemberProjectBox from '../components/team/TeamMemberProjectBox';
import PropTypes from 'prop-types';
import Badge from '../components/common/Badge';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject'
import ShouldRender from '../components/basic/ShouldRender';
import { logEvent } from '../analytics';
import { IS_DEV } from '../config';
import { history } from '../store';

const LoadingState = () => (
    <div className="Box-root Margin-bottom--12">
        <div className="bs-ContentSection Card-root Card-shadow--medium">
            <div className="Box-root">
                <div className="ContentState Box-root">
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--48">
                        <div className="Box-root Flex-flex Flex-alignItems--center Flex-direction--column Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-bottom--12">
                                <div className="Box-root">
                                    <div className="Spinner bs-SpinnerLegacy Spinner--size--large Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center">
                                        <svg
                                            viewBox="0 0 24 24"
                                            xmlns="http://www.w3.org/2000/svg"
                                            className="Spinner-svg"
                                        >
                                            <ellipse
                                                cx={12}
                                                cy={12}
                                                rx={10}
                                                ry={10}
                                                className="Spinner-ellipse"
                                            />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                            <div className="Box-root">
                                <div className="Box-root">
                                    <span className="ContentState-title Text-align--center Text-color--secondary Text-display--block Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>Loading</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

LoadingState.displayName = 'LoadingState'

const LoadedTeam = props => {
    const {pages, inviteModalId, team, subProjects, currentProjectId } = props;
    const membersPerPage = 20;

    // SubProject TeamMembers List
    const allTeamMembers = subProjects && subProjects.map((subProject, i) => {
        const teamMembers = team.subProjectTeamMembers.find(subProjectTeamMember => subProjectTeamMember._id === subProject._id)
        return teamMembers && teamMembers.teamMembers ? (
            <RenderIfUserInSubProject subProjectId={teamMembers._id} key={i}>
                <div className="bs-BIM" key={i}>
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <ShouldRender if={subProjects.length > 0}>
                                <div className="Box-root Padding-top--20 Padding-left--20">
                                    <Badge color={'blue'}>{subProject.name}</Badge>
                                </div>
                            </ShouldRender>
                            <TeamMemberProjectBox
                                paginate={props.paginate}
                                canPaginateBackward={pages[teamMembers._id] && pages[teamMembers._id] > 1 ? true : false}
                                canPaginateForward={teamMembers.count && teamMembers.count > (pages[teamMembers._id] || 1) * membersPerPage ? true : false}
                                teamMembers={teamMembers}
                                team={props.team}
                                subProjectName={subProject.name}
                                currentProjectId={currentProjectId}
                                inviteModalId={inviteModalId}
                                openModal={props.openModal}
                                pages={pages}
                                membersPerPage={membersPerPage}
                            />
                        </div>
                    </div>
                </div>
            </RenderIfUserInSubProject>
        ) : false;
    });

    // Add Project TeamMembers to All TeamMembers List
    let projectTeamMembers = team.subProjectTeamMembers.find(subProjectTeamMember => subProjectTeamMember._id === currentProjectId)
    const projectMembers = Object.assign({},projectTeamMembers);
    projectTeamMembers = projectTeamMembers && projectTeamMembers.teamMembers ? (
        <RenderIfUserInSubProject subProjectId={currentProjectId} key={() => uuid.v4()}>
            <div className="bs-BIM">
                <div className="Box-root Margin-bottom--12">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <ShouldRender if={subProjects.length > 0}>
                            <div className="Box-root Padding-top--20 Padding-left--20">
                                <Badge color={'red'}>Project</Badge>
                            </div>
                        </ShouldRender>
                        <TeamMemberProjectBox
                            paginate={props.paginate}
                            canPaginateBackward={pages[currentProjectId] && pages[currentProjectId] > 1 ? true : false}
                            canPaginateForward={projectMembers.count && projectMembers.count > (pages[currentProjectId] || 1) * membersPerPage ? true : false}
                            teamMembers={projectTeamMembers}
                            team={props.team}
                            subProjectName={props.currentProject ? props.currentProject.name : null}
                            currentProjectId={currentProjectId}
                            inviteModalId={inviteModalId}
                            openModal={props.openModal}
                            pages={pages}
                            membersPerPage={membersPerPage}
                            subProjects={subProjects}
                        />
                    </div>
                </div>
            </div>
        </RenderIfUserInSubProject>
    ) : false;

    allTeamMembers && allTeamMembers.unshift(projectTeamMembers)
    return allTeamMembers;
}

LoadedTeam.displayName = 'LoadedTeam'

LoadedTeam.propTypes = {
    team: PropTypes.object.isRequired,
    rowData: PropTypes.array.isRequired,
    pages: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
    paginate: PropTypes.func.isRequired,
    inviteModalId: PropTypes.string.isRequired,
    subProjects: PropTypes.array.isRequired,
}

class TeamApp extends Component {

    constructor(props) {
        super(props)
        this.state = { inviteModalId: uuid.v4() }
    }

    getTableHeaders() {
        return [
            {
                title: 'User'
            },
            {
                title: 'Role'
            },
            {
                title: 'Status'
            }
        ];
    }

    componentDidMount() {
        if (!this.props.currentProject) {
            const projectId = history.location.pathname.split('project/')[1].split('/')[0];
            this.props.subProjectTeamLoading(projectId);
        } else {
            this.props.subProjectTeamLoading(this.props.currentProject._id);
        }
        if (!IS_DEV) {
            logEvent('Team members page Loaded');
        }
    }
    componentWillUnmount() {
        this.props.paginate('reset');
    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                this.props.closeModal({ id: this.state.inviteModalId })
                return true;
            default:
                return false;
        }
    }

    render() {

        const { subProjectTeamLoading, teamMembers, pages } = this.props.team;
        const { inviteModalId } = this.state
        return (
            <Dashboard>
                <div onKeyDown={this.handleKeyBoard} className="Margin-vertical--12">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div
                                    className="customers-list-view react-view popover-container"
                                    style={{ position: 'relative', overflow: 'visible' }}
                                >
                                    {
                                        subProjectTeamLoading.requesting ? (
                                            <LoadingState />
                                        ) : (
                                                <LoadedTeam
                                                    inviteModalId={inviteModalId}
                                                    rowData={teamMembers}
                                                    header={this.getTableHeaders()}
                                                    {...this.props}
                                                    pages={pages}
                                                    paginate={this.props.paginate}
                                                    subProjects={this.props.subProjects}
                                                    currentProjectId={this.props.currentProject ? this.props.currentProject._id : null}
                                                />
                                            )
                                    }
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

TeamApp.propTypes = {
    team: PropTypes.object.isRequired,
    subProjectTeamLoading: PropTypes.func.isRequired,
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
    ]),
    closeModal: PropTypes.func.isRequired,
    paginate: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired
}

const mapStateToProps = state => {
    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames = subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects = subProjectNames && subProjectNames.map(name => subProjects.find(subProject => subProject.name === name))
    return {
        team: state.team,
        currentProject: state.project.currentProject,
        subProjects,
    }
};

const mapDispatchToProps = dispatch => (
    bindActionCreators(
        {
            subProjectTeamLoading, subProjectTeamLoadingRequest, subProjectTeamLoadingSuccess, subProjectTeamLoadingError, openModal, closeModal, paginate
        },
        dispatch
    )
);

TeamApp.displayName = 'TeamMembers'

export default connect(mapStateToProps, mapDispatchToProps)(TeamApp);