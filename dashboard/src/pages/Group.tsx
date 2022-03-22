import React, { Component } from 'react';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import GroupList from '../components/settings/GroupList';
import PropTypes from 'prop-types';

import getParentRoute from '../utils/getParentRoute';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { getGroups } from '../actions/group';
import { User } from '../config.js';
import { subProjectTeamLoading } from '../actions/team';

class Groups extends Component {
    componentDidMount() {

        this.props.getGroups();

        this.props.subProjectTeamLoading(User.getCurrentProjectId());
    }
    renderSubProjectGroups = () => {

        return this.props.projectGroups &&

            this.props.projectGroups.map((project: $TSFixMe) => {
                if (project.project.id === User.getCurrentProjectId()) {
                    return null;
                } else {
                    return (
                        <GroupList
                            key={project.project.id}

                            groups={project.groups && project.groups.groups}
                            count={project.groups.count}
                            project={project.project}
                            skip={project.groups.skip}
                            limit={project.groups.limit}
                        />
                    );
                }
            });
    };

    renderProjectGroups = () => {

        return this.props.projectGroups &&

            this.props.projectGroups.map((project: $TSFixMe) => {
                if (project.project.id === User.getCurrentProjectId()) {
                    return (
                        <GroupList
                            key={project.project.id}

                            groups={project.groups && project.groups.groups}
                            count={project.groups.count}
                            skip={project.groups.skip}
                            limit={project.groups.limit}
                            project={project.project}
                            parentProject={true}
                            subProjects={

                                this.props.projectGroups &&

                                this.props.projectGroups.length > 1
                            }
                        />
                    );
                } else {
                    return null;
                }
            });
    };

    render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
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
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Team Groups" />
                <div className="Margin-vertical--12">
                    <div>
                        <div id="settingsPage">
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            {this.renderProjectGroups()}
                                            {this.renderSubProjectGroups()}
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


Groups.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    getGroups: PropTypes.func,
    projectGroups: PropTypes.object,
    subProjectTeamLoading: PropTypes.func,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};


Groups.displayName = 'Groups';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        team: state.team,
        currentProject: state.project.currentProject,
        projectGroups: state.groups.groups,
        modalList: state.modal.modals,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ getGroups, subProjectTeamLoading }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(Groups);
