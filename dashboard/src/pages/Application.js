import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import ApplicationSecurityForm from '../components/security/ApplicationSecurityForm';
import ApplicationSecurity from '../components/security/ApplicationSecurity';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS, API_URL } from '../config';
import {
    getApplicationSecurities,
    getApplicationSecurityLogs,
    scanApplicationSecuritySuccess,
    getApplicationSecuritySuccess,
} from '../actions/security';
import { LargeSpinner } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import io from 'socket.io-client';
import sortByName from '../utils/sortByName';
import { history } from '../store';

// Important: Below `/api` is also needed because `io` constructor strips out the path from the url.
const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});

class Application extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Application Security page Loaded');
        }
    }

    ready = () => {
        const {
            componentId,
            projectId,
            getApplicationSecurities,
            getApplicationSecurityLogs,
        } = this.props;

        // load all the available logs
        getApplicationSecurityLogs({ projectId, componentId });

        // load all the application securities
        getApplicationSecurities({ projectId, componentId });
    };

    render() {
        const {
            projectId,
            componentId,
            applicationSecurities: appSecurities,
            gettingApplicationSecurities,
            gettingSecurityLogs,
            location: { pathname },
            component,
            scanApplicationSecuritySuccess,
            getApplicationSecuritySuccess,
        } = this.props;

        socket.on(`createApplicationSecurity-${componentId}`, data => {
            history.push(
                `/dashboard/project/${this.props.slug}/${componentId}/security/application/${data._id}`
            );
        });
        const applicationSecurities = appSecurities
            ? sortByName(appSecurities)
            : [];

        applicationSecurities.length > 0 &&
            applicationSecurities.forEach(applicationSecurity => {
                socket.on(`security_${applicationSecurity._id}`, data => {
                    getApplicationSecuritySuccess(data);
                });

                socket.on(`securityLog_${applicationSecurity._id}`, data => {
                    scanApplicationSecuritySuccess(data);
                });
            });

        const componentName = component ? component.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname, null, 'component')}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name="Application Security"
                        pageTitle="Application"
                    />
                    <div className="Margin-vertical--12">
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <ShouldRender
                                        if={
                                            gettingApplicationSecurities &&
                                            gettingSecurityLogs
                                        }
                                    >
                                        <div style={{ textAlign: 'center' }}>
                                            <LargeSpinner />
                                        </div>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={
                                            !gettingApplicationSecurities &&
                                            !gettingSecurityLogs
                                        }
                                    >
                                        {applicationSecurities.length > 0 &&
                                            applicationSecurities.map(
                                                applicationSecurity => {
                                                    return (
                                                        <span
                                                            key={
                                                                applicationSecurity._id
                                                            }
                                                        >
                                                            <div>
                                                                <div>
                                                                    <ApplicationSecurity
                                                                        name={
                                                                            applicationSecurity.name
                                                                        }
                                                                        applicationSecurityId={
                                                                            applicationSecurity._id
                                                                        }
                                                                        projectId={
                                                                            projectId
                                                                        }
                                                                        componentId={
                                                                            componentId
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                        </span>
                                                    );
                                                }
                                            )}
                                    </ShouldRender>
                                    <span>
                                        <div>
                                            <div>
                                                <ApplicationSecurityForm
                                                    projectId={projectId}
                                                    componentId={componentId}
                                                />
                                            </div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

Application.displayName = 'Application Security Page';

Application.propTypes = {
    componentId: PropTypes.string,
    slug: PropTypes.string,
    projectId: PropTypes.string,
    getApplicationSecurities: PropTypes.func,
    applicationSecurities: PropTypes.array,
    getApplicationSecurityLogs: PropTypes.func,
    gettingSecurityLogs: PropTypes.bool,
    gettingApplicationSecurities: PropTypes.bool,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    scanApplicationSecuritySuccess: PropTypes.func,
    getApplicationSecuritySuccess: PropTypes.func,
};

const mapStateToProps = (state, ownProps) => {
    const { componentId, projectId } = ownProps.match.params;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });

    return {
        componentId,
        projectId,
        slug:
            state.project.currentProject !== null &&
            state.project.currentProject.slug,
        applicationSecurities: state.security.applicationSecurities,
        gettingSecurityLogs:
            state.security.getApplicationSecurityLog.requesting,
        gettingApplicationSecurities: state.security.getApplication.requesting,
        component,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getApplicationSecurities,
            getApplicationSecurityLogs,
            scanApplicationSecuritySuccess,
            getApplicationSecuritySuccess,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Application);
