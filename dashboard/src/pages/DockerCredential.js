import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { getDockerCredentials } from '../actions/credential';
import DockerCredentialForm from '../components/credential/DockerCredentialForm';
import DockerCredentialList from '../components/credential/DockerCredentialList';

class DockerCredential extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        const { projectId, getDockerCredentials } = this.props;

        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Docker Credential page Loaded');
        }

        // load all the Docker Credentials
        getDockerCredentials({ projectId });
    }

    render() {
        const { projectId, dockerCredentials, getError } = this.props;

        return (
            <Dashboard>
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span>
                                    <DockerCredentialList
                                        dockerCredentials={dockerCredentials}
                                        error={getError}
                                    />
                                </span>
                                <span>
                                    <div>
                                        <div>
                                            <DockerCredentialForm
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

DockerCredential.displayName = 'Docker Credential Page';

DockerCredential.propTypes = {
    projectId: PropTypes.string,
    getDockerCredentials: PropTypes.func,
    dockerCredentials: PropTypes.array,
    getError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = (state, ownProps) => {
    const { projectId } = ownProps.match.params;

    return {
        projectId,
        dockerCredentials: state.credential.dockerCredentials,
        getError: state.credential.getDockerCredential.error,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getDockerCredentials }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(DockerCredential);
