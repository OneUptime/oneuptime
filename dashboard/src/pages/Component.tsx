import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { destroy } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import NewComponent from '../components/component/NewComponent';
import ComponentList from '../components/component/ComponentList';
import ShouldRender from '../components/basic/ShouldRender';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import RenderIfSubProjectMember from '../components/basic/RenderIfSubProjectMember';
import { LoadingState } from '../components/basic/Loader';
import TutorialBox from '../components/tutorial/TutorialBox';
import PropTypes from 'prop-types';
import {
    fetchMonitors,
    fetchMonitorsIncidents,
    fetchMonitorLogs,
} from '../actions/monitor';
import { loadPage } from '../actions/page';
import { getSmtpConfig } from '../actions/smsTemplates';
import IsUserInSubProject from '../components/basic/IsUserInSubProject';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import AlertDisabledWarning from '../components/settings/AlertDisabledWarning';
import CustomTutorial from '../components/tutorial/CustomTutorial';
import {
    fetchComponents,
    fetchPaginatedComponents,
} from '../actions/component';

class ComponentDashboardView extends Component {
    state = {
        showNewComponentForm: false,
        page: {},
    };

    prevClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPaginatedComponents' does not exist... Remove this comment to see the full error message
            .fetchPaginatedComponents({
                projectId,
                skip: (skip || 0) > (limit || 3) ? skip - limit : 0,
                limit,
            })
            .then(() => {
                this.setState(prevState => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    const updatedPage = prevState.page;
                    updatedPage[projectId] =
                        !updatedPage[projectId] || updatedPage[projectId] === 1
                            ? 1
                            : updatedPage[projectId] - 1;

                    return { page: updatedPage };
                });
            });
    };

    nextClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPaginatedComponents' does not exist... Remove this comment to see the full error message
            .fetchPaginatedComponents({
                projectId,
                skip: skip + limit,
                limit,
            })
            .then(() => {
                this.setState(prevState => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    const updatedPage = prevState.page;
                    updatedPage[projectId] = !updatedPage[projectId]
                        ? 2
                        : updatedPage[projectId] + 1;

                    return { page: updatedPage };
                });
            });
    };

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'loadPage' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.loadPage('Components');

        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (prevProps?.activeProjectId !== this.props?.activeProjectId) {
            this.ready();
        }
    }

    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'destroy' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.props.destroy('NewComponent');
    }

    toggleForm = () => {
        this.setState(prevState => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showNewComponentForm' does not exist on ... Remove this comment to see the full error message
            showNewComponentForm: !prevState.showNewComponentForm,
        }));
    };

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        const { activeProjectId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const currentProjectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponents' does not exist on type ... Remove this comment to see the full error message
        this.props.fetchComponents({ projectId: activeProjectId });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getSmtpConfig' does not exist on type 'R... Remove this comment to see the full error message
        this.props.getSmtpConfig(currentProjectId);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
        this.props.fetchMonitors(activeProjectId).then(() => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor.monitorsList.monitors.forEach((subProject: $TSFixMe) => {
                if (subProject.monitors.length > 0) {
                    subProject.monitors.forEach((monitor: $TSFixMe) => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorLogs' does not exist on type... Remove this comment to see the full error message
                        this.props.fetchMonitorLogs(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
                            this.props.startDate,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
                            this.props.endDate
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsIncidents' does not exist o... Remove this comment to see the full error message
                        this.props.fetchMonitorsIncidents(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            0,
                            1
                        );
                    });
                }
            });
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            document.title = this.props.currentProject.name + ' Dashboard';
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'components' does not exist on type 'Read... Remove this comment to see the full error message
        if (this.props.components.length) {
            const scriptElement = document.createElement('script');
            scriptElement.type = 'text/javascript';
            scriptElement.src = '/dashboard/assets/js/landing.base.js';
            document.head.appendChild(scriptElement);
        }

        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            activeProjectId,
        } = this.props;
        const currentProjectId = activeProjectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
        let allComponents = this.props.component.componentList.components
            .map((component: $TSFixMe) => component.components)
            .flat();

        // Add Project Components to Components List
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
        let projectComponent = this.props.component.componentList.components.find(
            (subProjectComponent: $TSFixMe) => String(subProjectComponent._id) === String(currentProjectId)
        );
        allComponents = IsUserInSubProject(currentProject)
            ? allComponents
            : allComponents.filter(
                (component: $TSFixMe) => component.projectId !== currentProject._id ||
                    component.projectId._id !== currentProject._id
            );
        projectComponent =
            projectComponent && projectComponent.components.length > 0 ? (
                <div
                    id={`box_${currentProject.name}`}
                    key={`box_${currentProject.name}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <ComponentList
                            shouldRenderProjectType={false}
                            projectId={currentProjectId}
                            projectType={'project'}
                            projectName={'Project'}
                            components={projectComponent.components}
                            skip={projectComponent.skip}
                            count={projectComponent.count}
                            limit={projectComponent.limit}
                            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                            page={this.state.page[currentProjectId]}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            requestErrorObject={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                this.props.component.componentList[
                                currentProjectId
                                ]
                            }
                        />
                    </div>
                </div>
            ) : (
                false
            );

        const components = projectComponent && [projectComponent];
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
                    route={pathname}
                    name={
                        this.state.showNewComponentForm ||
                            !components ||
                            components.length === 0 ||
                            components[0] === false
                            ? 'New Component Form'
                            : 'Components'
                    }
                    pageTitle="Components"
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: any; name: string; pageTitle: strin... Remove this comment to see the full error message
                    addBtn={components.length > 0 && components[0] !== false}
                    btnText="Create New Component"
                    toggleForm={this.toggleForm}
                />
                <ShouldRender
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
                    if={this.props.monitors && this.props.monitors.length > 0}
                >
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{page: string; }' is not assignable to type... Remove this comment to see the full error message
                    <AlertDisabledWarning page="Component" />
                </ShouldRender>
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="dashboard-home-view react-view">
                                    <div>
                                        <div>
                                            <span>
                                                <ShouldRender
                                                    if={
                                                        !(
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                            this.props.component
                                                                .componentList
                                                                .requesting ||
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorListRequesting' does not exist on... Remove this comment to see the full error message
                                                                .monitorListRequesting ||
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsRequesting' does not exist on ty... Remove this comment to see the full error message
                                                                .monitorsRequesting
                                                        )
                                                    }
                                                >
                                                    {/* Here, component notifier */}
                                                    <CustomTutorial
                                                        components={
                                                            allComponents
                                                        }
                                                        tutorialStat={
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                                                .tutorialStat
                                                        }
                                                        currentProjectId={
                                                            currentProjectId
                                                        }
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        slug={this.props.slug}
                                                        hideActionButton={true}
                                                    />
                                                    <ShouldRender
                                                        if={
                                                            (!this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                                                .tutorialStat
                                                                .componentCustom
                                                                .show ||
                                                                allComponents.length >
                                                                0) &&
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                                                .tutorialStat
                                                                .component.show
                                                        }
                                                    >
                                                        <TutorialBox
                                                            type="component"
                                                            currentProjectId={
                                                                currentProjectId
                                                            }
                                                        />
                                                    </ShouldRender>

                                                    {!this.state
                                                        .showNewComponentForm &&
                                                        components &&
                                                        components.length > 0 &&
                                                        components}

                                                    <RenderIfSubProjectAdmin>
                                                        <ShouldRender
                                                            if={
                                                                this.state
                                                                    .showNewComponentForm ||
                                                                !components ||
                                                                components.length ===
                                                                0 ||
                                                                components[0] ===
                                                                false
                                                            }
                                                        >
                                                            <NewComponent
                                                                index={1000}
                                                                formKey="NewComponentForm"
                                                                toggleForm={
                                                                    this
                                                                        .toggleForm
                                                                }
                                                                showCancelBtn={
                                                                    components.length >
                                                                    0 &&
                                                                    components[0] !==
                                                                    false
                                                                }
                                                            />
                                                        </ShouldRender>
                                                    </RenderIfSubProjectAdmin>

                                                    <RenderIfSubProjectMember>
                                                        <ShouldRender
                                                            if={
                                                                !this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                    .component
                                                                    .componentList
                                                                    .requesting &&
                                                                allComponents.length ===
                                                                0
                                                            }
                                                        >
                                                            <div className="Box-root ">
                                                                <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                                                    <div className="Box-root Card-shadow--medium Border-radius--4">
                                                                        <div
                                                                            className="bs-ContentSection-content Box-root Padding-horizontal--20 Padding-vertical--12"
                                                                            style={{
                                                                                paddingBottom:
                                                                                    '100px',
                                                                                paddingTop:
                                                                                    '100px',
                                                                            }}
                                                                        >
                                                                            <div
                                                                                className="db-SideNav-icon db-SideNav-icon--square "
                                                                                style={{
                                                                                    backgroundRepeat:
                                                                                        'no-repeat',
                                                                                    backgroundSize:
                                                                                        'contain',
                                                                                    backgroundPosition:
                                                                                        'center',
                                                                                    height:
                                                                                        '40px',
                                                                                    width:
                                                                                        '40px',
                                                                                    marginRight:
                                                                                        '50%',
                                                                                    marginLeft:
                                                                                        '50%',
                                                                                }}
                                                                            ></div>
                                                                            <div
                                                                                style={{
                                                                                    width:
                                                                                        '100%',
                                                                                    padding:
                                                                                        '10px',
                                                                                    textAlign:
                                                                                        'center',
                                                                                }}
                                                                            >
                                                                                No
                                                                                components
                                                                                are
                                                                                added
                                                                                to
                                                                                this
                                                                                project.
                                                                                Please
                                                                                contact
                                                                                your
                                                                                project
                                                                                admin.
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                    </RenderIfSubProjectMember>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                        this.props.component
                                                            .componentList
                                                            .requesting ||
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorListRequesting' does not exist on... Remove this comment to see the full error message
                                                            .monitorListRequesting ||
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsRequesting' does not exist on ty... Remove this comment to see the full error message
                                                            .monitorsRequesting
                                                    }
                                                >
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
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            destroy,
            fetchMonitors,
            loadPage,
            fetchMonitorsIncidents,
            fetchMonitorLogs,
            getSmtpConfig,
            fetchComponents,
            fetchPaginatedComponents,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    // removal of unused props
    const component = state.component;
    let subProjects = state.subProject.subProjects.subProjects;
    let monitors: $TSFixMe = [];

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map((subProject: $TSFixMe) => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map((name: $TSFixMe) => subProjects.find((subProject: $TSFixMe) => subProject.name === name)
        );
    state.monitor.monitorsList.monitors.map((monitor: $TSFixMe) => {
        monitors = monitors.concat(...monitor.monitors);
        return monitor;
    });

    const projectId =
        state.project.currentProject && state.project.currentProject._id;

    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        componentCustom: { show: true },
        component: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        component,
        currentProject: state.project.currentProject,
        incidents: state.incident.unresolvedincidents.incidents,
        components: state.component.componentList.components,
        subProjects,
        slug: state.project.currentProject && state.project.currentProject.slug,
        monitor: state.monitor,
        startDate: state.monitor.monitorsList.startDate,
        endDate: state.monitor.monitorsList.endDate,
        monitors,
        tutorialStat,
        monitorListRequesting: state.monitor.monitorsList.requesting,
        monitorsRequesting: state.monitor.monitorsList.monitors.requesting,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject?.activeSubProject,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ComponentDashboardView.propTypes = {
    currentProject: PropTypes.object,
    component: PropTypes.object,
    components: PropTypes.array,
    loadPage: PropTypes.func,
    destroy: PropTypes.func.isRequired,
    fetchMonitors: PropTypes.func.isRequired,
    slug: PropTypes.string,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    fetchMonitorsIncidents: PropTypes.func,
    fetchMonitorLogs: PropTypes.func,
    monitor: PropTypes.object,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    monitors: PropTypes.array,
    tutorialStat: PropTypes.object,
    getSmtpConfig: PropTypes.func.isRequired,
    fetchComponents: PropTypes.func,
    monitorListRequesting: PropTypes.bool,
    monitorsRequesting: PropTypes.bool,
    switchToProjectViewerNav: PropTypes.bool,
    fetchPaginatedComponents: PropTypes.func,
    activeProjectId: PropTypes.string,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ComponentDashboardView.displayName = 'ComponentDashboardView';

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ComponentDashboardView);
