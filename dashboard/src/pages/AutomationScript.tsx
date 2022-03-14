import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import PropTypes from 'prop-types';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { fetchAutomatedScript } from '../actions/automatedScript';
// @ts-expect-error ts-migrate(1192) FIXME: Module '"/home/nawazdhandala/Projects/OneUptime/ap... Remove this comment to see the full error message
import NewScript from '../components/automationScript/NewScript';
import AutomatedTabularList from '../components/automationScript/AutomatedTabularList';

class AutomationScript extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            toggleNewScript: false,
        };
    }
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProject' does not exist on type 'R... Remove this comment to see the full error message
        const projectId = this.props.activeProject;
        if (projectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAutomatedScript' does not exist on ... Remove this comment to see the full error message
            this.props.fetchAutomatedScript(projectId, 0, 10);
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProject' does not exist on type 'R... Remove this comment to see the full error message
        if (prevProps.activeProject !== this.props.activeProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProject' does not exist on type 'R... Remove this comment to see the full error message
            const projectId = this.props.activeProject;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAutomatedScript' does not exist on ... Remove this comment to see the full error message
            this.props.fetchAutomatedScript(projectId, 0, 10);
        }
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProject' does not exist on type 'R... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={pathname}
                    name={
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'toggleNewScript' does not exist on type ... Remove this comment to see the full error message
                        this.state.toggleNewScript
                            ? 'New Automation Script'
                            : 'Automation Scripts'
                    }
                    pageTitle="Automation Scripts"
                />
                <div id="automationScriptsPage">
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'toggleNewScript' does not exist on type ... Remove this comment to see the full error message
                    <ShouldRender if={!this.state.toggleNewScript}>
                        // @ts-expect-error ts-migrate(2741) FIXME: Property 'history' is missing in type '{toggleNew... Remove this comment to see the full error message
                        <AutomatedTabularList
                            {...this.props}
                            toggleNewScript={() =>
                                this.setState({
                                    toggleNewScript: !this.state
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'toggleNewScript' does not exist on type ... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'toggleNewScript' does not exist on type ... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'toggleNewScript' does not exist on type ... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AutomationScript.displayName = 'AutomationScript';

export default connect(mapStateToProps, mapDispatchToProps)(AutomationScript);
