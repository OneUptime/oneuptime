import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Dashboard from '../components/Dashboard';
import GroupList from '../components/settings/GroupList';
import PropTypes from 'prop-types';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import getParentRoute from '../utils/getParentRoute';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { getGroups } from '../actions/group';
import { User } from '../config.js';
import { subProjectTeamLoading } from '../actions/team';

class Groups extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > SETTINGS');
        }
        this.props.getGroups();
        this.props.subProjectTeamLoading(User.getCurrentProjectId());
    }
    renderSubProjectGroups = () => {
        return (
            this.props.projectGroups &&
            this.props.projectGroups.map(project => {
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
            })
        );
    };

    renderProjectGroups = () => {
        return (
            this.props.projectGroups &&
            this.props.projectGroups.map(project => {
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
                        />
                    );
                } else {
                    return null;
                }
            })
        );
    };
    render;
    render() {
        const {
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem route={pathname} name="Groups" />
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
            </Dashboard>
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
};

Groups.displayName = 'Groups';

const mapStateToProps = state => {
    return {
        team: state.team,
        currentProject: state.project.currentProject,
        projectGroups: state.groups.groups,
        modalList: state.modal.modals,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getGroups, subProjectTeamLoading }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(Groups);
