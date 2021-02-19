import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { getDockerCredentials } from '../actions/credential';
import DockerCredentialList from '../components/credential/DockerCredentialList';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import TutorialBox from '../components/tutorial/TutorialBox';

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
        const {
            projectId,
            dockerCredentials,
            getError,
            isRequesting,
            location: { pathname },
        } = this.props;

        return (
            <Dashboard>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name="Project Settings"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name="Docker Credentials"
                    />
                    <div className="Margin-vertical--12">
                        <TutorialBox
                            type="dockerCredentials"
                            currentProjectId={projectId}
                        />
                        <div>
                            <div
                                id="dockerCredentialPage"
                                className="db-BackboneViewContainer"
                            >
                                <div className="react-settings-view react-view">
                                    <span>
                                        <DockerCredentialList
                                            dockerCredentials={
                                                dockerCredentials
                                            }
                                            error={getError}
                                            projectId={projectId}
                                            isRequesting={isRequesting}
                                        />
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

DockerCredential.displayName = 'Docker Credential Page';

DockerCredential.propTypes = {
    projectId: PropTypes.string,
    getDockerCredentials: PropTypes.func,
    dockerCredentials: PropTypes.array,
    getError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    isRequesting: PropTypes.bool,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

const mapStateToProps = state => {
    return {
        projectId:
        state.project.currentProject &&
            state.project.currentProject._id,
        dockerCredentials: state.credential.dockerCredentials,
        getError: state.credential.getCredential.error,
        isRequesting: state.credential.getCredential.requesting,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getDockerCredentials }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(DockerCredential);
