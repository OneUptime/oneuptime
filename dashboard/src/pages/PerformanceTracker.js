import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import getParentRoute from '../utils/getParentRoute';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { bindActionCreators } from 'redux';
import { logEvent } from '../analytics';
import { loadPage } from '../actions/page';
import { LoadingState } from '../components/basic/Loader';
import { fetchPerformanceTrackers } from '../actions/performanceTracker';
import NewPerformanceTracker from '../components/performanceTracker/NewPerformanceTracker';
import { fetchComponent } from '../actions/component';
import PerformanceTrackerList from '../components/performanceTracker/PerformanceTrackerList';

class PerformanceTracker extends Component {
    state = {
        showNewPerformanceTrackerForm: false,
    };
    componentDidMount() {
        this.props.loadPage('Performance Tracker');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > PERFORMANCE MONITOR LIST'
            );
        }
        const { currentProject, fetchComponent, componentSlug } = this.props;
        if (currentProject) {
            fetchComponent(currentProject._id, componentSlug).then(() => {
                this.ready();
            });
        }
    }

    componentDidUpdate(prevProps) {
        if (
            prevProps.currentProject !== this.props.currentProject ||
            prevProps.componentId !== this.props.componentId ||
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const componentId = this.props.componentId;
            const projectId =
                this.props.currentProject && this.props.currentProject._id;
            if (projectId) {
                this.props.fetchComponent(projectId, this.props.componentSlug);
            }
            if (projectId && componentId) {
                fetchPerformanceTrackers({
                    projectId,
                    componentId,
                    skip: 0,
                    limit: 10,
                });
            }
        }
    }

    ready = () => {
        const componentId = this.props.componentId;
        const projectId =
            this.props.currentProject && this.props.currentProject._id;
        if (projectId && componentId) {
            this.props.fetchPerformanceTrackers({
                projectId,
                componentId,
                skip: 0,
                limit: 10,
            });
        }
    };

    renderPerformanceTrackerList = () => {
        const {
            performanceTrackerList,
            componentSlug,
            projectSlug,
            component,
        } = this.props;
        return performanceTrackerList.performanceTrackers.map(
            performanceTracker => (
                <PerformanceTrackerList
                    key={performanceTracker.name}
                    performanceTracker={performanceTracker}
                    componentSlug={componentSlug}
                    projectSlug={projectSlug}
                    projectId={component.projectId._id || component.projectId}
                />
            )
        );
    };

    toggleForm = () =>
        this.setState(prevState => ({
            showNewPerformanceTrackerForm: !prevState.showNewPerformanceTrackerForm,
        }));

    render() {
        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
        }
        const {
            location: { pathname },
            component,
            currentProject,
            switchToProjectViewerNav,
        } = this.props;

        const componentName = component ? component.name : '';
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';

        const isEmpty =
            this.props.performanceTrackerList.performanceTrackers.length === 0;
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
                    route={getParentRoute(pathname, null, 'component-tracker')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={pathname}
                    name="Performance Tracker"
                    addBtn={!isEmpty}
                    btnText="Create New Performance Tracker"
                    toggleForm={this.toggleForm}
                />
                <div>
                    <div>
                        <ShouldRender
                            if={this.props.performanceTrackerList.requesting}
                        >
                            <LoadingState />
                        </ShouldRender>
                        {!this.state.showNewPerformanceTrackerForm &&
                            !isEmpty &&
                            this.renderPerformanceTrackerList()}
                        <ShouldRender
                            if={!this.props.performanceTrackerList.requesting}
                        >
                            <div className="db-RadarRulesLists-page">
                                <ShouldRender
                                    if={
                                        this.state
                                            .showNewPerformanceTrackerForm ||
                                        isEmpty
                                    }
                                >
                                    <NewPerformanceTracker
                                        index={2000}
                                        formKey="NewPerformanceTrackerForm"
                                        componentId={this.props.componentId}
                                        componentSlug={this.props.componentSlug}
                                        toggleForm={this.toggleForm}
                                        showCancelBtn={!isEmpty}
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

PerformanceTracker.displayName = 'PerformanceTracker';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchPerformanceTrackers,
            loadPage,
            fetchComponent,
        },
        dispatch
    );
};

const mapStateToProps = (state, ownProps) => {
    const currentProject = state.project.currentProject;
    const { componentSlug, slug } = ownProps.match.params;

    return {
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        projectSlug: slug,
        currentProject,
        performanceTrackerList: state.performanceTracker.performanceTrackerList,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

PerformanceTracker.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.object,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    loadPage: PropTypes.func,
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    fetchPerformanceTrackers: PropTypes.func,
    performanceTrackerList: PropTypes.object,
    fetchComponent: PropTypes.func,
    projectSlug: PropTypes.string,
    switchToProjectViewerNav: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(PerformanceTracker);
