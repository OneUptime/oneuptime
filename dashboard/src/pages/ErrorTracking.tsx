import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import { connect } from 'react-redux';
import PropsType from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import NewErrorTracker from '../components/errorTracker/NewErrorTracker';
import { fetchErrorTrackers } from '../actions/errorTracker';
import { fetchComponent } from '../actions/component';
import { bindActionCreators } from 'redux';
import { LoadingState } from '../components/basic/Loader';
import sortByName from '../utils/sortByName';
import { ErrorTrackerList } from '../components/errorTracker/ErrorTrackerList';

import { history } from '../store';
import { socket } from '../components/basic/Socket';

class ErrorTracking extends Component {
    state = {
        showNewErrorTrackerForm: false,
        page: 1,
        requesting: false,
    };

    prevClicked = (projectId: $TSFixMe, componentId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        page: prevState.page + 1,
                    };
                });
            });
    };

    componentDidMount() {
        this.ready();
    }
    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        socket.removeListener(`createErrorTracker-${this.props.componentId}`);
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.componentSlug) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            String(this.props.componentSlug) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps.currentProject !== this.props.currentProject
        ) {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                this.props.componentSlug
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                this.props.fetchComponent(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                    this.props.componentSlug
                );
            }
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        if (String(prevProps.componentId) !== String(this.props.componentId)) {
            this.setRequesting();
            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
                .fetchErrorTrackers(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                    this.props.componentId,
                    0,
                    5
                )
                .then(() => this.setState({ requesting: false }));
        }
    }
    setRequesting = () => this.setState({ requesting: true });
    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
        const { componentSlug, fetchComponent, componentId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : null;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }

        this.setState({ requesting: true });
        if (projectId && componentId) {
            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
                .fetchErrorTrackers(projectId, componentId, 0, 5)
                .then(() => this.setState({ requesting: false }));
        }
    };
    toggleForm = () =>
        this.setState(prevState => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showNewErrorTrackerForm' does not exist ... Remove this comment to see the full error message
            showNewErrorTrackerForm: !prevState.showNewErrorTrackerForm,
        }));
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            document.title = this.props.currentProject.name + ' Dashboard';

            // join the room
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            socket.emit('component_switch', this.props.componentId);

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            socket.on(`createErrorTracker-${this.props.componentId}`, (data: $TSFixMe) => {
                history.push(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/error-trackers/${data.slug}`
                );
            });
        }
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
                                this.props.errorTracker.errorTrackers
                            }
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            skip={errorTracker.skip}
                            limit={errorTracker.limit}
                            count={errorTracker.count}
                            page={this.state.page}
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; errorTrackers: any; prev... Remove this comment to see the full error message
                            requesting={errorTracker.requesting}
                            error={errorTracker.error}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
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
                    pageTitle="Error Tracking"
                    name={
                        this.state.showNewErrorTrackerForm || !errorTrackersList
                            ? 'New Error Tracker'
                            : 'Error Tracking'
                    }
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: any; pageTitle: string; name: strin... Remove this comment to see the full error message
                    addBtn={errorTrackersList}
                    btnText="Create New Error Tracker"
                    toggleForm={this.toggleForm}
                />
                <div>
                    <div>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
                                this.props.errorTracker.requesting ||
                                this.state.requesting
                            }
                        >
                            <LoadingState />
                        </ShouldRender>
                        <ShouldRender
                            if={
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
                                !this.props.errorTracker.requesting &&
                                !this.state.requesting
                            }
                        >
                            <div className="db-RadarRulesLists-page">
                                <ShouldRender
                                    if={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                        this.props.tutorialStat.errorTracker
                                            .show
                                    }
                                >
                                    <TutorialBox
                                        type="errorTracking"
                                        currentProjectId={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                    componentId={this.props.componentId}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ErrorTracking.displayName = 'ErrorTracking';
const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchErrorTrackers,
            fetchComponent,
        },
        dispatch
    );
};
const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { componentSlug } = ownProps.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const currentProject = state.project.currentProject;

    const errorTracker = state.errorTracker.errorTrackersList;

    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        errorTracker: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
