import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';

import { fetchErrorTrackers, editErrorTracker } from '../actions/errorTracker';
import { fetchComponent } from '../actions/component';
import { bindActionCreators, Dispatch } from 'redux';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import ErrorTrackerDetail from '../components/errorTracker/ErrorTrackerDetail';
import ErrorTrackerViewDeleteBox from '../components/errorTracker/ErrorTrackerViewDeleteBox';
import LibraryList from '../components/application/LibraryList';

interface ErrorTrackingViewProps {
    component?: object;
    currentProject?: object;
    location?: object;
    fetchErrorTrackers?: Function;
    componentSlug?: string;
    fetchComponent?: Function;
    errorTracker?: unknown[];
    editErrorTracker?: Function;
    componentId?: string;
    switchToProjectViewerNav?: boolean;
    trackerLimit?: number;
    trackerSkip?: number;
}

class ErrorTrackingView extends Component<ComponentProps> {
    override componentDidMount() {
        this.ready();
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

            this.props.fetchErrorTrackers(

                this.props.currentProject._id,

                this.props.componentId,

                this.props.trackerSkip,

                this.props.trackerLimit
            );
        }
    }
    ready = () => {
        const {

            componentSlug,

            fetchComponent,

            componentId,

            trackerLimit,

            trackerSkip,
        } = this.props;

        const projectId = this.props.currentProject

            ? this.props.currentProject._id
            : null;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }
        if (projectId && componentId) {

            this.props.fetchErrorTrackers(
                projectId,
                componentId,
                trackerSkip,
                trackerLimit
            );
        }
    };
    handleCloseQuickStart = () => {
        const postObj = { showQuickStart: false };

        const { errorTracker, editErrorTracker } = this.props;

        const projectId = this.props.currentProject

            ? this.props.currentProject._id
            : null;
        editErrorTracker(
            projectId,
            errorTracker[0].componentId._id,
            errorTracker[0]._id,
            postObj
        );
    };
    override render() {
        const {

            location: { pathname },

            component,

            errorTracker,

            currentProject,

            switchToProjectViewerNav,
        } = this.props;

        const componentName = component ? component.name : '';
        const errorTrackerName =
            errorTracker.length > 0 ? errorTracker[0].name : null;
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
                    route={getParentRoute(pathname, null, 'error-tracker')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'error-trackers')}
                    name="Error Tracking"
                />
                <BreadCrumbItem
                    route={pathname}
                    name={errorTrackerName}
                    pageTitle="Error Tracking"
                    containerType="Error Tracker Container"
                />
                <ShouldRender if={!errorTracker[0]}>
                    <LoadingState />
                </ShouldRender>
                <ShouldRender if={errorTracker && errorTracker[0]}>
                    {errorTracker &&
                        errorTracker[0] &&
                        errorTracker[0].showQuickStart ? (
                        <LibraryList

                            title="Error Tracking"
                            type="errorTracking"
                            errorTracker={errorTracker[0]}
                            close={this.handleCloseQuickStart}
                        />
                    ) : null}
                    <div>
                        <ErrorTrackerDetail
                            componentId={component?._id}
                            index={errorTracker[0]?._id}
                            isDetails={true}
                            componentSlug={component?.slug}
                        />
                    </div>

                    <div className="Box-root Margin-bottom--12">
                        <ErrorTrackerViewDeleteBox
                            componentId={component?._id}
                            errorTracker={errorTracker[0]}
                        />
                    </div>
                </ShouldRender>
            </Fade>
        );
    }
}


ErrorTrackingView.displayName = 'ErrorTrackingView';
const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchErrorTrackers,
            editErrorTracker,
            fetchComponent,
        },
        dispatch
    );
};
const mapStateToProps: Function = (state: RootState, ownProps: $TSFixMe) => {
    const { errorTrackerSlug, componentSlug } = ownProps.match.params;
    const currentProject = state.project.currentProject;
    const errorTracker = state.errorTracker.errorTrackersList.errorTrackers.filter(
        (errorTracker: $TSFixMe) => errorTracker.slug === errorTrackerSlug
    );
    return {
        currentProject,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        component:
            state.component && state.component.currentComponent.component,
        errorTracker,
        componentSlug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        trackerSkip: state.errorTracker.errorTrackersList.skip || 0,
        trackerLimit: state.errorTracker.errorTrackersList.limit || 5,
    };
};

ErrorTrackingView.propTypes = {
    component: PropsType.object,
    currentProject: PropsType.object,
    location: PropsType.object,
    fetchErrorTrackers: PropsType.func,
    componentSlug: PropsType.string,
    fetchComponent: PropsType.func,
    errorTracker: PropsType.array,
    editErrorTracker: PropsType.func,
    componentId: PropsType.string,
    switchToProjectViewerNav: PropsType.bool,
    trackerLimit: PropsType.number,
    trackerSkip: PropsType.number,
};
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTrackingView);
