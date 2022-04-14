import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import NewErrorTracker from '../components/errorTracker/NewErrorTracker';
import { fetchErrorTrackers } from '../actions/errorTracker';
import { fetchComponent } from '../actions/component';
import { bindActionCreators, Dispatch } from 'redux';
import { LoadingState } from '../components/basic/Loader';
import sortByName from '../Utils/sortByName';
import { ErrorTrackerList } from '../components/errorTracker/ErrorTrackerList';

import { history } from '../store';
import { socket } from '../components/basic/Socket';

interface ErrorTrackingProps {
    component?: object;
    currentProject?: object;
    location?: object;
    componentId?: string;
    componentSlug?: string;
    fetchErrorTrackers?: Function;
    fetchComponent?: Function;
    tutorialStat?: object;
    errorTracker?: object;
    switchToProjectViewerNav?: boolean;
    activeProjectId?: string;
}

class ErrorTracking extends Component<ComponentProps> {
    state = {
        showNewErrorTrackerForm: false,
        page: 1,
        requesting: false,
    };

    prevClicked = (projectId: string, componentId: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) => {
        this.props

            .fetchErrorTrackers(
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

            .fetchErrorTrackers(
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
        this.ready();
    }
    override componentWillUnmount() {

        socket.removeListener(`createErrorTracker-${this.props.componentId}`);
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.componentSlug) !==

            String(this.props.componentSlug) ||

            prevProps.currentProject !== this.props.currentProject
        ) {
            if (

                this.props.currentProject &&

                this.props.currentProject._id &&

                this.props.componentSlug
            ) {

                this.props.fetchComponent(

                    this.props.currentProject._id,

                    this.props.componentSlug
                );
            }
        }


        if (String(prevProps.componentId) !== String(this.props.componentId)) {
            this.setRequesting();
            this.props

                .fetchErrorTrackers(

                    this.props.currentProject._id,

                    this.props.componentId,
                    0,
                    5
                )
                .then(() => this.setState({ requesting: false }));
        }
    }
    setRequesting = () => this.setState({ requesting: true });
    ready = () => {

        const { componentSlug, fetchComponent, componentId } = this.props;

        const projectId = this.props.currentProject

            ? this.props.currentProject._id
            : null;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }

        this.setState({ requesting: true });
        if (projectId && componentId) {
            this.props

                .fetchErrorTrackers(projectId, componentId, 0, 5)
                .then(() => this.setState({ requesting: false }));
        }
    };
    toggleForm = () =>
        this.setState(prevState => ({

            showNewErrorTrackerForm: !prevState.showNewErrorTrackerForm,
        }));
    override render() {

        if (this.props.currentProject) {

            document.title = this.props.currentProject.name + ' Dashboard';

            // join the room

            socket.emit('component_switch', this.props.componentId);


            socket.on(`createErrorTracker-${this.props.componentId}`, (data: $TSFixMe) => {
                history.push(

                    `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/error-trackers/${data.slug}`
                );
            });
        }
        const {

            location: { pathname },

            component,

            errorTracker,

            componentId,

            currentProject,

            switchToProjectViewerNav,
        } = this.props;

        const errorTrackers =
            errorTracker && errorTracker.errorTrackers
                ? sortByName(errorTracker.errorTrackers)
                : [];
        const errorTrackersList =
            errorTrackers && errorTrackers.length > 0 ? (
                <div
                    id={`box_${componentId}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <ErrorTrackerList
                            componentId={componentId}
                            errorTrackers={

                                this.props.errorTracker.errorTrackers
                            }
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            skip={errorTracker.skip}
                            limit={errorTracker.limit}
                            count={errorTracker.count}
                            page={this.state.page}

                            requesting={errorTracker.requesting}
                            error={errorTracker.error}

                            projectId={this.props.activeProjectId}
                            fetchingPage={errorTracker.fetchingPage}
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
                    pageTitle="Error Tracking"
                    name={
                        this.state.showNewErrorTrackerForm || !errorTrackersList
                            ? 'New Error Tracker'
                            : 'Error Tracking'
                    }

                    addBtn={errorTrackersList}
                    btnText="Create New Error Tracker"
                    toggleForm={this.toggleForm}
                />
                <div>
                    <div>
                        <ShouldRender
                            if={

                                this.props.errorTracker.requesting ||
                                this.state.requesting
                            }
                        >
                            <LoadingState />
                        </ShouldRender>
                        <ShouldRender
                            if={

                                !this.props.errorTracker.requesting &&
                                !this.state.requesting
                            }
                        >
                            <div className="db-RadarRulesLists-page">
                                <ShouldRender
                                    if={

                                        this.props.tutorialStat.errorTracker
                                            .show
                                    }
                                >
                                    <TutorialBox
                                        type="errorTracking"
                                        currentProjectId={

                                            this.props.currentProject?._id
                                        }
                                    />
                                </ShouldRender>
                            </div>
                            {!this.state.showNewErrorTrackerForm &&
                                errorTrackersList &&
                                errorTrackersList}

                            <ShouldRender
                                if={
                                    this.state.showNewErrorTrackerForm ||
                                    !errorTrackersList
                                }
                            >
                                <NewErrorTracker

                                    componentId={this.props.componentId}

                                    componentSlug={this.props.componentSlug}
                                    toggleForm={this.toggleForm}
                                    showCancelBtn={errorTrackersList}
                                />
                            </ShouldRender>
                        </ShouldRender>
                    </div>
                </div>
            </Fade>
        );
    }
}


ErrorTracking.displayName = 'ErrorTracking';
const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchErrorTrackers,
            fetchComponent,
        },
        dispatch
    );
};
const mapStateToProps: Function = (state: RootState, ownProps: $TSFixMe) => {
    const { componentSlug } = ownProps.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const currentProject = state.project.currentProject;

    const errorTracker = state.errorTracker.errorTrackersList;

    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat: $TSFixMe = {
        errorTracker: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {

            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        currentProject,
        componentSlug,
        component:
            state.component && state.component.currentComponent.component,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        errorTracker,
        tutorialStat,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject.activeSubProject,
    };
};

ErrorTracking.propTypes = {
    component: PropsType.object,
    currentProject: PropsType.object,
    location: PropsType.object,
    componentId: PropsType.string,
    componentSlug: PropsType.string,
    fetchErrorTrackers: PropsType.func,
    fetchComponent: PropsType.func,
    tutorialStat: PropsType.object,
    errorTracker: PropsType.object,
    switchToProjectViewerNav: PropsType.bool,
    activeProjectId: PropsType.string,
};
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTracking);
