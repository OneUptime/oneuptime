import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import Dashboard from '../components/Dashboard';
import ContainerSecurityForm from '../components/security/ContainerSecurityForm';
import ContainerSecurity from '../components/security/ContainerSecurity';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import {
    getContainerSecurities,
    getContainerSecurityLogs,
} from '../actions/security';
import { LargeSpinner } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';

class Container extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        const {
            projectId,
            componentId,
            getContainerSecurities,
            getContainerSecurityLogs,
        } = this.props;

        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Container Security page Loaded');
        }

        // load container security logs
        getContainerSecurityLogs({ projectId, componentId });

        // load container security
        getContainerSecurities({ projectId, componentId });
    }

    render() {
        const {
            componentId,
            projectId,
            containerSecurities,
            gettingContainerSecurities,
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
                                        gettingContainerSecurities &&
                                        gettingSecurityLogs
                                    }
                                >
                                    <div style={{ textAlign: 'center' }}>
                                        <LargeSpinner />
                                    </div>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        !gettingContainerSecurities &&
                                        !gettingSecurityLogs
                                    }
                                >
                                    {containerSecurities.length > 0 &&
                                        containerSecurities.map(
                                            containerSecurity => {
                                                return (
                                                    <span
                                                        key={
                                                            containerSecurity._id
                                                        }
                                                    >
                                                        <div>
                                                            <div>
                                                                <ContainerSecurity
                                                                    name={
                                                                        containerSecurity.name
                                                                    }
                                                                    dockerRegistryUrl={
                                                                        containerSecurity.dockerRegistryUrl
                                                                    }
                                                                    imagePath={
                                                                        containerSecurity.imagePath
                                                                    }
                                                                    containerSecurityId={
                                                                        containerSecurity._id
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
                                            <ContainerSecurityForm
                                                componentId={componentId}
                                                projectId={projectId}
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

Container.displayName = 'Container Security Page';

Container.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    containerSecurities: PropTypes.array,
    getContainerSecurities: PropTypes.func,
    getContainerSecurityLogs: PropTypes.func,
    gettingSecurityLogs: PropTypes.bool,
    gettingContainerSecurities: PropTypes.bool,
};

const mapStateToProps = (state, ownProps) => {
    // ids from url
    const { componentId, projectId } = ownProps.match.params;

    return {
        projectId,
        componentId,
        containerSecurities: state.security.containerSecurities,
        gettingSecurityLogs: state.security.getContainerSecurityLog.requesting,
        gettingContainerSecurities: state.security.getContainer.requesting,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { getContainerSecurities, getContainerSecurityLogs },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(Container);
