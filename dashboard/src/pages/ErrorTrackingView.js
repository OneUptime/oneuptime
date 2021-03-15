import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import Dashboard from '../components/Dashboard';
import getParentRoute from '../utils/getParentRoute';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import PropsType from 'prop-types';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import { fetchErrorTrackers } from '../actions/errorTracker';
import { bindActionCreators } from 'redux';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import ErrorTrackerDetail from '../components/errorTracker/ErrorTrackerDetail';
import ErrorTrackerViewDeleteBox from '../components/errorTracker/ErrorTrackerViewDeleteBox';
import LibraryList from '../components/application/LibraryList';

class ErrorTrackingView extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > ERROR TRACKING > ERROR TRACKING DETAIL PAGE'
            );
        }
    }
    ready = () => {
        const componentId = this.props.match.params.componentId
            ? this.props.match.params.componentId
            : null;
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;

        this.props.fetchErrorTrackers(projectId, componentId);
    };
    render() {
        const {
            location: { pathname },
            component,
            errorTracker,
        } = this.props;

        const componentName = component ? component.name : '';
        const errorTrackerName =
            errorTracker.length > 0 ? errorTracker[0].name : null;
        return (
            <Dashboard ready={this.ready}>
                <Fade>
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
                        <LibraryList
                            title="Error Tracking"
                            type="errorTracking"
                            errorTracker={errorTracker[0]}
                        />
                        <div>
                            <ErrorTrackerDetail
                                componentId={component?._id}
                                index={errorTracker[0]?._id}
                                isDetails={true}
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
            </Dashboard>
        );
    }
}

ErrorTrackingView.displayName = 'ErrorTrackingView';
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchErrorTrackers,
        },
        dispatch
    );
};
const mapStateToProps = (state, ownProps) => {
    const { componentId, errorTrackerSlug } = ownProps.match.params;
    const currentProject = state.project.currentProject;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    const errorTracker = state.errorTracker.errorTrackersList.errorTrackers.filter(
        errorTracker => errorTracker.slug === errorTrackerSlug
    );
    return {
        currentProject,
        component,
        errorTracker,
    };
};
ErrorTrackingView.propTypes = {
    component: PropsType.object,
    currentProject: PropsType.object,
    location: PropsType.object,
    match: PropsType.object,
    fetchErrorTrackers: PropsType.func,
    errorTracker: PropsType.array,
};
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTrackingView);
