import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import { Fade } from 'react-awesome-reveal';

import { getDockerCredentials } from '../actions/credential';
import DockerCredentialList from '../components/credential/DockerCredentialList';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import TutorialBox from '../components/tutorial/TutorialBox';

class DockerCredential extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
    }

    componentDidUpdate(prevProps: $TSFixMe) {

        if (prevProps.projectId !== this.props.projectId) {

            const { projectId, getDockerCredentials } = this.props;
            // load all the Docker Credentials
            getDockerCredentials({ projectId });
        }
    }

    componentDidMount() {

        const { projectId, getDockerCredentials } = this.props;
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

            currentProject,

            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
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

                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="Docker Credentials" />
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
                                        dockerCredentials={dockerCredentials}
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
        );
    }
}


DockerCredential.displayName = 'Docker Credential Page';


DockerCredential.propTypes = {
    projectId: PropTypes.string,
    getDockerCredentials: PropTypes.func,
    dockerCredentials: PropTypes.array,
    getError: PropTypes.string,
    isRequesting: PropTypes.bool,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        dockerCredentials: state.credential.dockerCredentials,
        getError: state.credential.getCredential.error,
        isRequesting: state.credential.getCredential.requesting,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ getDockerCredentials }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(DockerCredential);
