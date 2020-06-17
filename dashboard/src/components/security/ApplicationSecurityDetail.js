import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import ApplicationSecurityView from './ApplicationSecurityView';
import {
    getApplicationSecurity,
    getApplicationSecurityLog,
} from '../../actions/security';
import ApplicationSecurityDeleteBox from './ApplicationSecurityDeleteBox';
import SecurityLog from './SecurityLog';
import { getGitCredentials } from '../../actions/credential';

class ApplicationSecurityDetail extends Component {
    componentDidMount() {
        const {
            projectId,
            componentId,
            applicationSecurityId,
            getApplicationSecurity,
            getApplicationSecurityLog,
            getGitCredentials,
        } = this.props;

        // get a particular application security
        getApplicationSecurity({
            projectId,
            componentId,
            applicationSecurityId,
        });

        getApplicationSecurityLog({
            projectId,
            componentId,
            applicationSecurityId,
        });

        getGitCredentials({ projectId });
    }

    render() {
        const {
            applicationSecurity,
            projectId,
            componentId,
            applicationSecurityId,
            isRequesting,
            getApplicationError,
            gettingSecurityLog,
            applicationSecurityLog,
            gettingCredentials,
            fetchCredentialError,
            fetchLogError,
        } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <ShouldRender
                    if={
                        isRequesting && gettingSecurityLog && gettingCredentials
                    }
                >
                    <ListLoader />
                </ShouldRender>
                <ShouldRender
                    if={
                        applicationSecurity.name &&
                        !gettingSecurityLog &&
                        !gettingCredentials
                    }
                >
                    <ApplicationSecurityView
                        projectId={projectId}
                        componentId={componentId}
                        applicationSecurityId={applicationSecurityId}
                        isRequesting={isRequesting}
                        applicationSecurity={applicationSecurity}
                    />
                </ShouldRender>
                <ShouldRender
                    if={
                        applicationSecurity.name &&
                        !gettingSecurityLog &&
                        !gettingCredentials
                    }
                >
                    <SecurityLog
                        type="Application"
                        applicationSecurityLog={applicationSecurityLog}
                    />
                </ShouldRender>
                <ShouldRender
                    if={
                        applicationSecurity.name &&
                        !gettingSecurityLog &&
                        !gettingCredentials
                    }
                >
                    <ApplicationSecurityDeleteBox
                        projectId={projectId}
                        componentId={componentId}
                        applicationSecurityId={applicationSecurityId}
                    />
                </ShouldRender>
                <ShouldRender
                    if={
                        !isRequesting &&
                        !gettingSecurityLog &&
                        !gettingCredentials &&
                        (getApplicationError ||
                            fetchCredentialError ||
                            fetchLogError)
                    }
                >
                    {getApplicationError ||
                        fetchCredentialError ||
                        fetchLogError}
                </ShouldRender>
            </div>
        );
    }
}

ApplicationSecurityDetail.displayName = 'Application Security Detail';

ApplicationSecurityDetail.propTypes = {
    getApplicationSecurity: PropTypes.func,
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationSecurityId: PropTypes.string,
    applicationSecurity: PropTypes.object,
    isRequesting: PropTypes.bool,
    getApplicationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    gettingSecurityLog: PropTypes.bool,
    applicationSecurityLog: PropTypes.object,
    getApplicationSecurityLog: PropTypes.func,
    getGitCredentials: PropTypes.func,
    gettingCredentials: PropTypes.bool,
    fetchLogError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    fetchCredentialError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getApplicationSecurity,
            getApplicationSecurityLog,
            getGitCredentials,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const {
        projectId,
        componentId,
        applicationSecurityId,
    } = ownProps.match.params;

    return {
        projectId,
        componentId,
        applicationSecurityId,
        applicationSecurity: state.security.applicationSecurity,
        isRequesting: state.security.getApplication.requesting,
        getApplicationError: state.security.getApplication.error,
        gettingSecurityLog: state.security.getApplicationSecurityLog.requesting,
        applicationSecurityLog: state.security.applicationSecurityLog || {},
        gettingCredentials: state.credential.getCredential.requesting,
        fetchLogError: state.security.getApplicationSecurityLog.error,
        fetchCredentialError: state.credential.getCredential.error,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ApplicationSecurityDetail)
);
