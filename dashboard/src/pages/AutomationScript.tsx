import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import PropTypes from 'prop-types';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { fetchAutomatedScript } from '../actions/automatedScript';

import NewScript from '../components/automationScript/NewScript';
import AutomatedTabularList from '../components/automationScript/AutomatedTabularList';

interface AutomationScriptProps {
    projectId?: string;
    fetchAutomatedScript: Function;
    location?: {
        pathname?: string
    };
    currentProject?: object;
    switchToProjectViewerNav?: boolean;
    activeProject?: string;
    subProjects?: unknown[];
}

class AutomationScript extends Component<AutomationScriptProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            toggleNewScript: false,
        };
    }
    componentDidMount() {

        const projectId = this.props.activeProject;
        if (projectId) {

            this.props.fetchAutomatedScript(projectId, 0, 10);
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {

        if (prevProps.activeProject !== this.props.activeProject) {

            const projectId = this.props.activeProject;

            this.props.fetchAutomatedScript(projectId, 0, 10);
        }
    }

    render() {
        const {

            location: { pathname },

            currentProject,

            switchToProjectViewerNav,

            subProjects,

            activeProject,
        } = this.props;

        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';

        const subProjectName =
            subProjects.find((obj: $TSFixMe) => obj._id === activeProject)?.name ||
            currentProject.name;

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
                    route={pathname}
                    name={

                        this.state.toggleNewScript
                            ? 'New Automation Script'
                            : 'Automation Scripts'
                    }
                    pageTitle="Automation Scripts"
                />
                <div id="automationScriptsPage">

                    <ShouldRender if={!this.state.toggleNewScript}>

                        <AutomatedTabularList
                            {...this.props}
                            toggleNewScript={() =>
                                this.setState({
                                    toggleNewScript: !this.state

                                        .toggleNewScript,
                                })
                            }
                            subProjectName={subProjectName}
                            showProjectName={
                                currentProject?._id !== activeProject
                            }
                        />
                    </ShouldRender>
                </div>

                <ShouldRender if={this.state.toggleNewScript}>
                    <div className="Box-root">
                        <div>
                            <div>
                                <div className="db-BackboneViewContainer">
                                    <div className="dashboard-home-view react-view">
                                        <div>
                                            <div>
                                                <span>
                                                    <ShouldRender if={true}>
                                                        <NewScript
                                                            toggleNewScript={() =>
                                                                this.setState({
                                                                    toggleNewScript: !this
                                                                        .state

                                                                        .toggleNewScript,
                                                                })
                                                            }
                                                        />
                                                    </ShouldRender>

                                                    <ShouldRender if={false}>
                                                        <LoadingState />
                                                    </ShouldRender>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchAutomatedScript,
        },
        dispatch
    );
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
        currentProject: state.project.currentProject,
        activeProject: state.subProject.activeSubProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        subProjects,
    };
};


AutomationScript.propTypes = {
    projectId: PropTypes.string,
    fetchAutomatedScript: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
    activeProject: PropTypes.string,
    subProjects: PropTypes.array,
};


AutomationScript.displayName = 'AutomationScript';

export default connect(mapStateToProps, mapDispatchToProps)(AutomationScript);
