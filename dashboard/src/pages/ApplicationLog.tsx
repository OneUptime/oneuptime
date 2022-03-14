import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import NewApplicationLog from '../components/application/NewApplicationLog';
import getParentRoute from '../utils/getParentRoute';
import { fetchApplicationLogs } from '../actions/applicationLog';
import { fetchComponent } from '../actions/component';
import { bindActionCreators } from 'redux';
import { loadPage } from '../actions/page';
import { ApplicationLogList } from '../components/application/ApplicationLogList';
import { LoadingState } from '../components/basic/Loader';
import sortByName from '../utils/sortByName';
import { history } from '../store';
import { socket } from '../components/basic/Socket';

class ApplicationLog extends Component {
    state = {
        showNewLogContainerForm: false,
        page: 1,
        requesting: false,
    };

    prevClicked = (projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchApplicationLogs' does not exist on ... Remove this comment to see the full error message
            .fetchApplicationLogs(
                projectId,
                componentId,
                (skip || 0) > (limit || 5) ? skip - limit : 0,
                limit,
                true
            )
            .then(() => {
                this.setState(prevState => {
                    return {
                        page:
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            prevState.page === 1
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                ? prevState.page
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                : prevState.page - 1,
                    };
                });
            });
    };

    nextClicked = (projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchApplicationLogs' does not exist on ... Remove this comment to see the full error message
            .fetchApplicationLogs(
                projectId,
                componentId,
                skip + limit,
                limit,
                true
            )
            .then(() => {
                this.setState(prevState => {
                    return {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        page: prevState.page + 1,
                    };
                });
            });
    };

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'loadPage' does not exist on type 'Readon... Remove this comment to see the full error message
        this.props.loadPage('Logs');
        this.setState({ requesting: true });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, fetchComponent, componentSlug } = this.props;
        if (currentProject) {
            fetchComponent(currentProject._id, componentSlug).then(() => {
                this.ready();
            });
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps.currentProject !== this.props.currentProject ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                currentProject,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                fetchComponent,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                componentSlug,
            } = this.props;
            if (currentProject) {
                this.setRequesting();

                fetchComponent(currentProject._id, componentSlug).then(() => {
                    this.ready();
                });
            }
        }
    }
    setRequesting = () => this.setState({ requesting: true });
    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        const componentId = this.props.componentId;
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject && this.props.currentProject._id;
        if (projectId && componentId) {
            // join component room
            socket.emit('component_switch', componentId);

            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchApplicationLogs' does not exist on ... Remove this comment to see the full error message
                .fetchApplicationLogs(projectId, componentId, 0, 5)
                .then(() => this.setState({ requesting: false }));
        }
    };
    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        socket.removeListener(`createApplicationLog-${this.props.componentId}`);
    }
    toggleForm = () =>
        this.setState(prevState => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showNewLogContainerForm' does not exist ... Remove this comment to see the full error message
            showNewLogContainerForm: !prevState.showNewLogContainerForm,
        }));
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            document.title = this.props.currentProject.name + ' Dashboard';
            socket.on(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                `createApplicationLog-${this.props.componentId}`,
                (data: $TSFixMe) => {
                    history.push(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                        `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/application-logs/${data.slug}`
                    );
                }
            );
        }
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog: appLogs,
        } = this.props;

        const applicationLogs =
            appLogs && appLogs.applicationLogs
                ? sortByName(appLogs.applicationLogs)
                : [];
        const applicationLogsList =
            applicationLogs && applicationLogs.length > 0 ? (
                <div
                    id={`box_${componentId}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <ApplicationLogList
                            componentId={componentId}
                            applicationLogs={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                                this.props.applicationLog.applicationLogs
                            }
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                            componentSlug={this.props.componentSlug}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            skip={appLogs.skip}
                            limit={appLogs.limit}
                            count={appLogs.count}
                            page={this.state.page}
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; applicationLogs: any; co... Remove this comment to see the full error message
                            requesting={appLogs.requesting}
                            error={appLogs.error}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
                            projectId={this.props.activeProjectId}
                            fetchingPage={appLogs.paginatedRequest}
                        />
                    </div>
                </div>
            ) : (
                false
            );

        const componentName = component ? component.name : '';
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
                    name={componentName}
                />
                <BreadCrumbItem
                    route={pathname}
                    pageTitle="Logs"
                    name={
                        this.state.showNewLogContainerForm ||
                            !applicationLogsList
                            ? 'New Log Container'
                            : 'Logs'
                    }
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: any; pageTitle: string; name: strin... Remove this comment to see the full error message
                    addBtn={applicationLogsList}
                    btnText="Create New Log Container"
                    toggleForm={this.toggleForm}
                />
                <div>
                    <div>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                                this.props.applicationLog.requesting ||
                                this.state.requesting
                            }
                        >
                            <LoadingState />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                                !this.props.applicationLog.requesting &&
                                !this.state.requesting
                            }
                        >
                            <div className="db-RadarRulesLists-page">
                                <ShouldRender
                                    if={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                        this.props.tutorialStat.applicationLog
                                            .show
                                    }
                                >
                                    <TutorialBox
                                        type="applicationLog"
                                        currentProjectId={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                            this.props.currentProject?._id
                                        }
                                    />
                                </ShouldRender>
                                {!this.state.showNewLogContainerForm &&
                                    applicationLogsList &&
                                    applicationLogsList}

                                <ShouldRender
                                    if={
                                        this.state.showNewLogContainerForm ||
                                        !applicationLogsList
                                    }
                                >
                                    <NewApplicationLog
                                        index={2000}
                                        formKey="NewApplicationLogForm"
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                        componentId={this.props.componentId}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                                        componentSlug={this.props.componentSlug}
                                        toggleForm={this.toggleForm}
                                        showCancelBtn={applicationLogsList}
                                    />
                                </ShouldRender>
                            </div>
                        </ShouldRender>
                    </div>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ApplicationLog.displayName = 'ApplicationLog';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchApplicationLogs,
            loadPage,
            fetchComponent,
        },
        dispatch
    );
};
const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const { componentSlug } = props.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const applicationLog = state.applicationLog.applicationLogsList;

    const currentProject = state.project.currentProject;

    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        applicationLog: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        applicationLog,
        currentProject,
        tutorialStat,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject.activeSubProject,
    };
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ApplicationLog.propTypes = {
    tutorialStat: PropTypes.object,
    applicationLog: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    loadPage: PropTypes.func,
    fetchComponent: PropTypes.func,
    fetchApplicationLogs: PropTypes.func,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
    activeProjectId: PropTypes.string,
};
export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLog);
