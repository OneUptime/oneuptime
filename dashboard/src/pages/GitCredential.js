import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import Dashboard from '../components/Dashboard';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { getGitCredentials } from '../actions/credential';
import GitCredentialForm from '../components/credential/GitCredentialForm';
import GitCredentialList from '../components/credential/GitCredentialList';

class GitCredential extends Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        const { projectId, getGitCredentials } = this.props;

        if (SHOULD_LOG_ANALYTICS) {
            logEvent('Git Credential page Loaded');
        }

        // load all the Git Credentials
        getGitCredentials({ projectId });
    }

    render() {
        const { projectId, gitCredentials, getError } = this.props;

        return (
            <Dashboard>
                <div className="Margin-vertical--12">
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span>
                                    <GitCredentialList
                                        gitCredentials={gitCredentials}
                                        error={getError}
                                    />
                                </span>
                                <span>
                                    <div>
                                        <div>
                                            <GitCredentialForm
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

GitCredential.displayName = 'Git Credential Page';

GitCredential.propTypes = {
    projectId: PropTypes.string,
    getGitCredentials: PropTypes.func,
    gitCredentials: PropTypes.array,
    getError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = (state, ownProps) => {
    const { projectId } = ownProps.match.params;

    return {
        projectId,
        gitCredentials: state.credential.gitCredentials,
        getError: state.credential.getGitCredential.error,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getGitCredentials }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(GitCredential);
