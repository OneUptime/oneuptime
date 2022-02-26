import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import GroupList from '../components/settings/GroupList';
import PropTypes from 'prop-types';

import getParentRoute from '../utils/getParentRoute';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { getGroups } from '../actions/group';
import { User } from '../config.js';
import { subProjectTeamLoading } from '../actions/team';

class Groups extends Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getGroups' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getGroups();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectTeamLoading' does not exist on... Remove this comment to see the full error message
        this.props.subProjectTeamLoading(User.getCurrentProjectId());
    }
    renderSubProjectGroups = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectGroups' does not exist on type 'R... Remove this comment to see the full error message
        return this.props.projectGroups &&
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectGroups' does not exist on type 'R... Remove this comment to see the full error message
        this.props.projectGroups.map((project: $TSFixMe) => {
            if (project.project.id === User.getCurrentProjectId()) {
                return null;
            } else {
                return (
                    <GroupList
                        key={project.project.id}
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ key: any; groups: any; count: any; project... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectGroups' does not exist on type 'R... Remove this comment to see the full error message
        return this.props.projectGroups &&
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectGroups' does not exist on type 'R... Remove this comment to see the full error message
        this.props.projectGroups.map((project: $TSFixMe) => {
            if (project.project.id === User.getCurrentProjectId()) {
                return (
                    <GroupList
                        key={project.project.id}
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ key: any; groups: any; count: any; skip: a... Remove this comment to see the full error message
                        groups={project.groups && project.groups.groups}
                        count={project.groups.count}
                        skip={project.groups.skip}
                        limit={project.groups.limit}
                        project={project.project}
                        parentProject={true}
                        subProjects={
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectGroups' does not exist on type 'R... Remove this comment to see the full error message
                            this.props.projectGroups &&
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectGroups' does not exist on type 'R... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ getGroups, subProjectTeamLoading }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(Groups);
