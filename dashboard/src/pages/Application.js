import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import ApplicationSecurityForm from '../components/security/ApplicationSecurityForm';
import ApplicationSecurity from '../components/security/ApplicationSecurity';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { getApplicationSecurities } from '../actions/security';

class Application extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        const { componentId, projectId, getApplicationSecurities } = this.props;

        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Application Security page Loaded');
        }

        // load all the application securities
        getApplicationSecurities({ projectId, componentId });
    }

    render() {
        const { projectId, componentId, applicationSecurities } = this.props;

        return (
            <Dashboard>
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
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
};

const mapStateToProps = (state, ownProps) => {
    const { componentId, projectId } = ownProps.match.params;

    return {
        componentId,
        projectId,
        applicationSecurities: state.security.applicationSecurities,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getApplicationSecurities }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(Application);
