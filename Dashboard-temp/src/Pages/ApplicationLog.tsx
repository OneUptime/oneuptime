import React, { Component } from 'react';

import { Fade } from 'react-awesome-reveal';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import NewApplicationLog from '../components/application/NewApplicationLog';
import getParentRoute from '../Utils/getParentRoute';
import { fetchApplicationLogs } from '../actions/applicationLog';
import { fetchComponent } from '../actions/component';
import { bindActionCreators, Dispatch } from 'redux';
import { loadPage } from '../actions/page';
import { ApplicationLogList } from '../components/application/ApplicationLogList';
import { LoadingState } from '../components/basic/Loader';
import sortByName from '../Utils/sortByName';
import { history } from '../store';
import { socket } from '../components/basic/Socket';

interface ApplicationLogProps {
    tutorialStat?: object;
    applicationLog?: object;
    location?: {
        pathname?: string
    };
    component?: {
        name?: string
    }[];
    componentId?: string;
    componentSlug?: string;
    loadPage?: Function;
    fetchComponent?: Function;
    fetchApplicationLogs?: Function;
    currentProject?: object;
    switchToProjectViewerNav?: boolean;
    activeProjectId?: string;
}

class ApplicationLog extends Component<ComponentProps> {
    state = {
        showNewLogContainerForm: false,
        page: 1,
        requesting: false,
    };

    prevClicked = (projectId: string, componentId: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) => {
        this.props

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

                            prevState.page === 1

                                ? prevState.page

                                : prevState.page - 1,
                    };
                });
            });
    };

    nextClicked = (projectId: string, componentId: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) => {
        this.props

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

                        page: prevState.page + 1,
                    };
                });
            });
    };

    override componentDidMount() {

        this.props.loadPage('Logs');
        this.setState({ requesting: true });

        const { currentProject, fetchComponent, componentSlug } = this.props;
        if (currentProject) {
            fetchComponent(currentProject._id, componentSlug).then(() => {
                this.ready();
            });
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (

            prevProps.currentProject !== this.props.currentProject ||

            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const {

                currentProject,

                fetchComponent,

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

        const componentId = this.props.componentId;
        const projectId =

            this.props.currentProject && this.props.currentProject._id;
        if (projectId && componentId) {
            // join component room
            socket.emit('component_switch', componentId);

            this.props

                .fetchApplicationLogs(projectId, componentId, 0, 5)
                .then(() => this.setState({ requesting: false }));
        }
    };
    override componentWillUnmount() {

        socket.removeListener(`createApplicationLog-${this.props.componentId}`);
    }
    toggleForm = () =>
        this.setState(prevState => ({

            showNewLogContainerForm: !prevState.showNewLogContainerForm,
        }));
    override render() {

        if (this.props.currentProject) {

            document.title = this.props.currentProject.name + ' Dashboard';
            socket.on(

                `createApplicationLog-${this.props.componentId}`,
                (data: $TSFixMe) => {
                    history.push(

                        `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/application-logs/${data.slug}`
                    );
                }
            );
        }
        const {

            location: { pathname },

            component,

            componentId,

            currentProject,

            switchToProjectViewerNav,

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

                                this.props.applicationLog.applicationLogs
                            }

                            componentSlug={this.props.componentSlug}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            skip={appLogs.skip}
                            limit={appLogs.limit}
                            count={appLogs.count}
                            page={this.state.page}

                            requesting={appLogs.requesting}
                            error={appLogs.error}

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

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem

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

                    addBtn={applicationLogsList}
                    btnText="Create New Log Container"
                    toggleForm={this.toggleForm}
                />
                <div>
                    <div>
                        <ShouldRender
                            if={

                                this.props.applicationLog.requesting ||
                                this.state.requesting
                            }
                        >
                            <LoadingState />
                        </ShouldRender>
                        <ShouldRender
                            if={

                                !this.props.applicationLog.requesting &&
                                !this.state.requesting
                            }
                        >
                            <div className="db-RadarRulesLists-page">
                                <ShouldRender
                                    if={

                                        this.props.tutorialStat.applicationLog
                                            .show
                                    }
                                >
                                    <TutorialBox
                                        type="applicationLog"
                                        currentProjectId={

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

                                        componentId={this.props.componentId}

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


ApplicationLog.displayName = 'ApplicationLog';

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchApplicationLogs,
            loadPage,
            fetchComponent,
        },
        dispatch
    );
};
const mapStateToProps = (state: RootState, props: $TSFixMe) => {
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
