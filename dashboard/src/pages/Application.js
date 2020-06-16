import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import ApplicationSecurityForm from '../components/security/ApplicationSecurityForm';
import ApplicationSecurity from '../components/security/ApplicationSecurity';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import {
    getApplicationSecurities,
    getApplicationSecurityLogs,
} from '../actions/security';
import { LargeSpinner } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';

class Application extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        const {
            componentId,
            projectId,
            getApplicationSecurities,
            getApplicationSecurityLogs,
        } = this.props;

        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Application Security page Loaded');
        }
        // load all the available logs
        getApplicationSecurityLogs({ projectId, componentId });

        // load all the application securities
        getApplicationSecurities({ projectId, componentId });
    }

    render() {
        const {
            projectId,
            componentId,
            applicationSecurities,
            gettingApplicationSecurities,
            gettingSecurityLogs,
        } = this.props;

        return (
            <Dashboard>
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
            </Dashboard>
        );
    }
}

Application.displayName = 'Application Security Page';

Application.propTypes = {
    componentId: PropTypes.string,
    projectId: PropTypes.string,
    getApplicationSecurities: PropTypes.func,
    applicationSecurities: PropTypes.array,
    getApplicationSecurityLogs: PropTypes.func,
    gettingSecurityLogs: PropTypes.bool,
    gettingApplicationSecurities: PropTypes.bool,
};

const mapStateToProps = (state, ownProps) => {
    const { componentId, projectId } = ownProps.match.params;

    return {
        componentId,
        projectId,
        applicationSecurities: state.security.applicationSecurities,
        gettingSecurityLogs:
            state.security.getApplicationSecurityLog.requesting,
        gettingApplicationSecurities: state.security.getApplication.requesting,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getApplicationSecurities, getApplicationSecurityLogs },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Application);
