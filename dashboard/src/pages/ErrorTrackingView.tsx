import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import PropsType from 'prop-types';

import { fetchErrorTrackers, editErrorTracker } from '../actions/errorTracker';
import { fetchComponent } from '../actions/component';
import { bindActionCreators } from 'redux';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import ErrorTrackerDetail from '../components/errorTracker/ErrorTrackerDetail';
import ErrorTrackerViewDeleteBox from '../components/errorTracker/ErrorTrackerViewDeleteBox';
import LibraryList from '../components/application/LibraryList';

class ErrorTrackingView extends Component {
    componentDidMount() {
        this.ready();
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
            this.props.fetchErrorTrackers(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerSkip' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.trackerSkip,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerLimit' does not exist on type 'Re... Remove this comment to see the full error message
                this.props.trackerLimit
            );
        }
    }
    ready = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerLimit' does not exist on type 'Re... Remove this comment to see the full error message
            trackerLimit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerSkip' does not exist on type 'Rea... Remove this comment to see the full error message
            trackerSkip,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : null;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }
        if (projectId && componentId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
        const { errorTracker, editErrorTracker } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : null;
        editErrorTracker(
            projectId,
            errorTracker[0].componentId._id,
            errorTracker[0]._id,
            postObj
        );
    };
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
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
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: string; type: string; errorTracker:... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ErrorTrackingView.displayName = 'ErrorTrackingView';
const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchErrorTrackers,
            editErrorTracker,
            fetchComponent,
        },
        dispatch
    );
};
const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
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
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
