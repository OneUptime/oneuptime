import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';

import Fade from 'react-awesome-reveal/Fade';

import { getGitCredentials } from '../actions/credential';
import GitCredentialList from '../components/credential/GitCredentialList';
import GitSshList from '../components/credential/GitSshList';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import TutorialBox from '../components/tutorial/TutorialBox';

class GitCredential extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
    }

    componentDidUpdate(prevProps: $TSFixMe) {

        if (prevProps.projectId !== this.props.projectId) {

            const { projectId, getGitCredentials } = this.props;

            // load all the Docker Credentials
            getGitCredentials({ projectId });
        }
    }

    componentDidMount() {

        const { projectId, getGitCredentials } = this.props;

        // load all the Git Credentials
        getGitCredentials({ projectId });
    }

    render() {
        const {

            projectId,

            gitCredentials,

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
                <BreadCrumbItem route={pathname} name="Git Credentials" />
                <div className="Margin-vertical--12">
                    <div>
                        <TutorialBox
                            type="gitCredentials"
                            currentProjectId={projectId}
                        />
                        <div
                            id="gitCredentialPage"
                            className="db-BackboneViewContainer"
                        >
                            <div className="react-settings-view react-view">
                                <span>
                                    <GitCredentialList
                                        gitCredentials={gitCredentials}
                                        error={getError}
                                        projectId={projectId}
                                        isRequesting={isRequesting}
                                    />
                                </span>
                            </div>
                        </div>
                        <div
                            id="gitCredentialPage"
                            className="db-BackboneViewContainer"
                        >
                            <div className="react-settings-view react-view">
                                <span>
                                    <GitSshList
                                        gitSsh={gitCredentials}
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


GitCredential.displayName = 'Git Credential Page';


GitCredential.propTypes = {
    projectId: PropTypes.string,
    getGitCredentials: PropTypes.func,
    gitCredentials: PropTypes.array,
    getError: PropTypes.string,
    isRequesting: PropTypes.bool,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        gitCredentials: state.credential.gitCredentials,
        getError: state.credential.getCredential.error,
        isRequesting: state.credential.getCredential.requesting,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ getGitCredentials }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(GitCredential);
