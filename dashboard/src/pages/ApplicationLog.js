import React, { Component } from 'react';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import NewApplicationLog from '../components/application/NewApplicationLog';
import getParentRoute from '../utils/getParentRoute';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { fetchApplicationLogs } from '../actions/applicationLog';
import { bindActionCreators } from 'redux';
import { logEvent } from '../analytics';
import { loadPage } from '../actions/page';
import { ApplicationLogList } from '../components/application/ApplicationLogList';
import { LoadingState } from '../components/basic/Loader';
import sortByName from '../utils/sortByName';
import { API_URL } from '../config';
import io from 'socket.io-client';
import { history } from '../store';

const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});

class ApplicationLog extends Component {
    componentDidMount() {
        this.props.loadPage('Logs');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > LOG CONTAINER LIST'
            );
        }
    }
    ready = () => {
        const componentId = this.props.componentId;
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;

        this.props.fetchApplicationLogs(projectId, componentId);
    };
    componentWillUnmount() {
        socket.removeListener(`createApplicationLog-${this.props.componentId}`);
    }
    render() {
        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
            socket.on(
                `createApplicationLog-${this.props.componentId}`,
                data => {
                    history.push(
                        `/dashboard/project/${this.props.currentProject.slug}/${this.props.componentSlug}/application-logs/${data.slug}`
                    );
                }
            );
        }
        const {
            location: { pathname },
            component,
            componentId,
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
                    <BreadCrumbItem route={pathname} name="Logs" />
                    <div>
                        <div>
                            <ShouldRender
                                if={this.props.applicationLog.requesting}
                            >
                                <LoadingState />
                            </ShouldRender>
                            <ShouldRender
                                if={!this.props.applicationLog.requesting}
                            >
                                <div className="db-RadarRulesLists-page">
                                    <ShouldRender
                                        if={
                                            this.props.tutorialStat
                                                .applicationLog.show
                                        }
                                    >
                                        <TutorialBox
                                            type="applicationLog"
                                            currentProjectId={
                                                this.props.currentProject?._id
                                            }
                                        />
                                    </ShouldRender>
                                    {applicationLogsList}
                                    <NewApplicationLog
                                        index={2000}
                                        formKey="NewApplicationLogForm"
                                        componentId={this.props.componentId}
                                    />
                                </div>
                            </ShouldRender>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

ApplicationLog.displayName = 'ApplicationLog';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchApplicationLogs,
            loadPage,
        },
        dispatch
    );
};
const mapStateToProps = (state, props) => {
    const { componentSlug } = props.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const applicationLog = state.applicationLog.applicationLogsList;

    const currentProject = state.project.currentProject;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c.slug) === String(componentSlug)) {
                component = c;
            }
        });
    });

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
            state.component.currentComponent &&
            state.component.currentComponent._id,
        component,
        componentSlug,
        applicationLog,
        currentProject,
        tutorialStat,
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
    fetchApplicationLogs: PropTypes.func,
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
};
export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLog);
