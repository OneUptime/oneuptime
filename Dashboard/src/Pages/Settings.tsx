import React, { Component } from 'react';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';
import ProjectSettings from '../components/settings/ProjectSettings';
import SubProjects from '../components/settings/SubProjects';
import RenderIfMember from '../components/basic/RenderIfMember';
import ExitProject from '../components/settings/ExitProject';
import PropTypes from 'prop-types';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';

interface SettingsProps {
    location?: {
        pathname?: string
    };
    currentProject: object;
    switchToProjectViewerNav?: boolean;
}

class Settings extends Component<ComponentProps> {
    override render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName: $TSFixMe = currentProject ? currentProject.name : '';
        const projectId: $TSFixMe = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem route={pathname} name="Project Settings" />
                <div className="Margin-vertical--12">
                    <div>
                        <div id="settingsPage">
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <ProjectSettings />

                                            <SubProjects />

                                            <RenderIfMember>
                                                <ExitProject />
                                            </RenderIfMember>
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


Settings.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};


Settings.displayName = 'Settings';

const mapStateToProps: Function = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

export default connect(mapStateToProps)(Settings);
