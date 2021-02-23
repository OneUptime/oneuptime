import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import Dashboard from '../components/Dashboard';
import getParentRoute from '../utils/getParentRoute';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import PropsType from 'prop-types';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import NewErrorTracker from '../components/errorTracker/NewErrorTracker';
import { fetchErrorTrackers } from '../actions/errorTracker';
import { bindActionCreators } from 'redux';
import { LoadingState } from '../components/basic/Loader';
import sortByName from '../utils/sortByName';
import { ErrorTrackerList } from '../components/errorTracker/ErrorTrackerList';
import { SHOULD_LOG_ANALYTICS, API_URL } from '../config';
import { logEvent } from '../analytics';
import io from 'socket.io-client';
import { history } from '../store';

const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});

class ErrorTracking extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > ERROR TRACKING LIST'
            );
        }
    }
    componentWillUnmount() {
        socket.removeListener(`createErrorTracker-${this.props.componentId}`);
    }
    ready = () => {
        const { componentId } = this.props.match.params;
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;
        if (projectId && componentId) {
            this.props.fetchErrorTrackers(projectId, componentId);
        }
    };
    render() {
        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
            socket.on(`createErrorTracker-${this.props.componentId}`, data => {
                history.push(
                    `/dashboard/project/${this.props.currentProject.slug}/${this.props.componentId}/error-trackers/${data._id}`
                );
            });
        }
        const {
            location: { pathname },
            component,
            errorTracker,
            componentId,
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
                        />
                    </div>
                </div>
            ) : (
                false
            );

        const componentName = component ? component.name : '';
        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name={componentName}
                    />
                    <BreadCrumbItem route={pathname} name="Error Tracking" />
                    <div>
                        <div>
                            <ShouldRender
                                if={this.props.errorTracker.requesting}
                            >
                                <LoadingState />
                            </ShouldRender>
                            <ShouldRender
                                if={!this.props.errorTracker.requesting}
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
                                {errorTrackersList}
                                <NewErrorTracker
                                    componentId={this.props.componentId}
                                />
                            </ShouldRender>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

ErrorTracking.displayName = 'ErrorTracking';
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchErrorTrackers,
        },
        dispatch
    );
};
const mapStateToProps = (state, ownProps) => {
    const { componentId } = ownProps.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const currentProject = state.project.currentProject;

    const errorTracker = state.errorTracker.errorTrackersList;

    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });

    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
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
        component,
        componentId,
        errorTracker,
        tutorialStat,
    };
};
ErrorTracking.propTypes = {
    component: PropsType.object,
    currentProject: PropsType.object,
    location: PropsType.object,
    componentId: PropsType.string,
    fetchErrorTrackers: PropsType.func,
    tutorialStat: PropsType.object,
    errorTracker: PropsType.object,
    match: PropsType.object,
};
export default connect(mapStateToProps, mapDispatchToProps)(ErrorTracking);
