import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import {
    subProjectTeamLoading,
    subProjectTeamLoadingRequest,
    subProjectTeamLoadingSuccess,
    subProjectTeamLoadingError,
    paginate,
} from '../actions/team';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import TeamMemberProjectBox from '../components/team/TeamMemberProjectBox';
import PropTypes from 'prop-types';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

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

LoadingState.displayName = 'LoadingState';

const LoadedTeam = (props: $TSFixMe) => {
    const {
        pages,
        inviteModalId,
        team,
        subProjects,
        currentProjectId,
        modalList,
    } = props;
    const membersPerPage = 10;

    // Add Project TeamMembers to All TeamMembers List
    let projectTeamMembers = team.subProjectTeamMembers.find(
        (subProjectTeamMember: $TSFixMe) => subProjectTeamMember._id === currentProjectId
    );
    const projectMembers = Object.assign({}, projectTeamMembers);
    const subProjectName =
        (props.subProjects &&
            props.subProjects.find((obj: $TSFixMe) => obj._id === currentProjectId)
                ?.name) ||
        props.currentProject?.name;
    projectTeamMembers =
        projectTeamMembers && projectTeamMembers.teamMembers ? (
            <RenderIfUserInSubProject
                subProjectId={currentProjectId}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '() => any' is not assignable to type 'Key | ... Remove this comment to see the full error message
                key={() => uuidv4()}
            >
                <div className="bs-BIM">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <TeamMemberProjectBox
                                paginate={props.paginate}
                                canPaginateBackward={
                                    pages[currentProjectId] &&
                                    pages[currentProjectId] > 1
                                        ? true
                                        : false
                                }
                                canPaginateForward={
                                    projectMembers.count &&
                                    projectMembers.count >
                                        (pages[currentProjectId] || 1) *
                                            membersPerPage
                                        ? true
                                        : false
                                }
                                teamMembers={projectTeamMembers}
                                team={props.team}
                                subProjectName={subProjectName}
                                showProjectName={
                                    props.currentProject?._id !==
                                    currentProjectId
                                }
                                currentProjectId={currentProjectId}
                                inviteModalId={inviteModalId}
                                openModal={props.openModal}
                                pages={pages}
                                membersPerPage={membersPerPage}
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ paginate: any; canPaginateBackward: boolea... Remove this comment to see the full error message
                                subProjects={subProjects}
                                allTeamLength={
                                    team.subProjectTeamMembers.length
                                }
                                modalList={modalList}
                            />
                        </div>
                    </div>
                </div>
            </RenderIfUserInSubProject>
        ) : (
            false
        );

    const allTeamMembers = projectTeamMembers && [projectTeamMembers];
    return allTeamMembers;
};

LoadedTeam.displayName = 'LoadedTeam';

LoadedTeam.propTypes = {
    team: PropTypes.object.isRequired,
    rowData: PropTypes.array.isRequired,
    pages: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
    paginate: PropTypes.func.isRequired,
    inviteModalId: PropTypes.string.isRequired,
    subProjects: PropTypes.array.isRequired,
    modalList: PropTypes.array,
};

class TeamApp extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { inviteModalId: uuidv4() };
    }

    getTableHeaders() {
        return [
            {
                title: 'User',
            },
            {
                title: 'Role',
            },
            {
                title: 'Status',
            },
        ];
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (this.props.activeProjectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            this.props.subProjectTeamLoading(this.props.activeProjectId);
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
            this.props.subProjectTeamLoading(this.props.activeProjectId);
        }
    }

    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.paginate('reset');
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.closeModal({ id: this.state.inviteModalId });
                return true;
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            team: { teamLoading, teamMembers, pages },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'inviteModalId' does not exist on type 'R... Remove this comment to see the full error message
        const { inviteModalId } = this.state;
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
                <BreadCrumbItem route={pathname} name="Team Members" />
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="Margin-vertical--12"
                >
                    <div>
                        <div id="teamMemberPage">
                            <div className="db-BackboneViewContainer">
                                <div
                                    className="customers-list-view react-view popover-container"
                                    style={{
                                        position: 'relative',
                                        overflow: 'visible',
                                    }}
                                >
                                    {teamLoading.requesting ? (
                                        <LoadingState />
                                    ) : (
                                        <LoadedTeam
                                            inviteModalId={inviteModalId}
                                            rowData={teamMembers}
                                            header={this.getTableHeaders()}
                                            {...this.props}
                                            pages={pages}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
                                            paginate={this.props.paginate}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                                            subProjects={this.props.subProjects}
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ pages: any; paginate: any; subProjects: an... Remove this comment to see the full error message
                                            currentProjectId={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
                                                this.props.activeProjectId
                                            }
                                            parent={pathname}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalList' does not exist on type 'Reado... Remove this comment to see the full error message
                                            modalList={this.props.modalList}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TeamApp.propTypes = {
    team: PropTypes.object.isRequired,
    subProjectTeamLoading: PropTypes.func.isRequired,
    currentProject: PropTypes.oneOfType([PropTypes.object]),
    closeModal: PropTypes.func.isRequired,
    paginate: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    modalList: PropTypes.array,
    switchToProjectViewerNav: PropTypes.bool,
    activeProjectId: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe) => {
    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map((subProject: $TSFixMe) => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map((name: $TSFixMe) => subProjects.find((subProject: $TSFixMe) => subProject.name === name)
        );
    return {
        team: state.team,
        currentProject: state.project.currentProject,
        subProjects,
        modalList: state.modal.modals,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject.activeSubProject,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        subProjectTeamLoading,
        subProjectTeamLoadingRequest,
        subProjectTeamLoadingSuccess,
        subProjectTeamLoadingError,
        openModal,
        closeModal,
        paginate,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
TeamApp.displayName = 'TeamMembers';

export default connect(mapStateToProps, mapDispatchToProps)(TeamApp);
