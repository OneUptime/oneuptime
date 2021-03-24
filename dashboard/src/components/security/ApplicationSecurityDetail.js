import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { LargeSpinner } from '../basic/Loader';
import ApplicationSecurityView from './ApplicationSecurityView';
import {
    getApplicationSecurity,
    getApplicationSecurityLogBySlug,
    getApplicationSecurityBySlug,
    scanApplicationSecuritySuccess,
    getApplicationSecuritySuccess,
} from '../../actions/security';
import ApplicationSecurityDeleteBox from './ApplicationSecurityDeleteBox';
import SecurityLog from './SecurityLog';
import { getGitCredentials } from '../../actions/credential';
import BreadCrumbItem from '../breadCrumb/BreadCrumbItem';
import getParentRoute from '../../utils/getParentRoute';
import { API_URL } from '../../config';
import io from 'socket.io-client';

// Important: Below `/api` is also needed because `io` constructor strips out the path from the url.
const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});

class ApplicationSecurityDetail extends Component {
    componentDidUpdate(prevProps) {
        if (prevProps.projectId !== this.props.projectId) {
            const {
                projectId,
                componentId,
                applicationSecuritySlug,
                getApplicationSecurityBySlug,
                getApplicationSecurityLogBySlug,
                getGitCredentials,
            } = this.props;
            // get a particular application security
            getApplicationSecurityBySlug({
                projectId,
                componentId,
                applicationSecuritySlug,
            });
            getApplicationSecurityLogBySlug({
                projectId,
                componentId,
                applicationSecuritySlug,
            });
            getGitCredentials({ projectId });
        }
    }
    componentDidMount() {
        const {
            projectId,
            componentId,
            applicationSecuritySlug,
            getApplicationSecurityBySlug,
            getApplicationSecurityLogBySlug,
            getGitCredentials,
        } = this.props;
        // get a particular application security
        getApplicationSecurityBySlug({
            projectId,
            componentId,
            applicationSecuritySlug,
        });
        getApplicationSecurityLogBySlug({
            projectId,
            componentId,
            applicationSecuritySlug,
        });
        getGitCredentials({ projectId });
    }

    render() {
        const {
            applicationSecurity,
            projectId,
            componentId,
            componentSlug,
            applicationSecurityId,
            applicationSecuritySlug,
            isRequesting,
            getApplicationError,
            gettingSecurityLog,
            applicationSecurityLog,
            gettingCredentials,
            fetchCredentialError,
            fetchLogError,
            location: { pathname },
            components,
            scanApplicationSecuritySuccess,
            getApplicationSecuritySuccess,
        } = this.props;

        socket.on(`security_${applicationSecurityId}`, data => {
            getApplicationSecuritySuccess(data);
        });

        socket.on(`securityLog_${applicationSecurityId}`, data => {
            scanApplicationSecuritySuccess(data);
        });

        const componentName =
            components.length > 0 ? components[0].name : 'loading...';

        return (
            <div className="Box-root Margin-bottom--12">
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'component')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={getParentRoute(
                        pathname,
                        null,
                        'applicationSecurityId'
                    )}
                    name="Application Security"
                />
                <BreadCrumbItem
                    route={pathname}
                    name={applicationSecurity.name || 'loading...'}
                    pageTitle="Application Detail"
                    containerType="Application Security"
                />
                <ShouldRender
                    if={
                        isRequesting && gettingSecurityLog && gettingCredentials
                    }
                >
                    <div style={{ textAlign: 'center' }}>
                        <LargeSpinner />
                    </div>
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
                        applicationSecuritySlug={applicationSecuritySlug}
                        isRequesting={isRequesting}
                        applicationSecurity={applicationSecurity}
                        componentSlug={componentSlug}
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
                        applicationSecuritySlug={applicationSecuritySlug}
                        componentSlug={componentSlug}
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
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    applicationSecurityId: PropTypes.string,
    applicationSecuritySlug: PropTypes.string,
    applicationSecurity: PropTypes.object,
    isRequesting: PropTypes.bool,
    getApplicationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    gettingSecurityLog: PropTypes.bool,
    applicationSecurityLog: PropTypes.object,
    getApplicationSecurityLogBySlug: PropTypes.func,
    getApplicationSecurityBySlug: PropTypes.func,
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
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    components: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    scanApplicationSecuritySuccess: PropTypes.func,
    getApplicationSecuritySuccess: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getApplicationSecurity,
            getApplicationSecurityLogBySlug,
            getApplicationSecurityBySlug,
            getGitCredentials,
            scanApplicationSecuritySuccess,
            getApplicationSecuritySuccess,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const { componentSlug, applicationSecuritySlug } = ownProps.match.params;
    const components = [];
    // filter to get the actual component
    state.component.componentList.components.map(item =>
        item.components.map(component => {
            if (String(component.slug) === String(componentSlug)) {
                components.push(component);
            }
            return component;
        })
    );
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    return {
        projectId,
        componentId: components[0] && components[0]._id,
        componentSlug: components[0] && components[0].slug,
        applicationSecuritySlug,
        applicationSecurity: state.security.applicationSecurity,
        isRequesting: state.security.getApplication.requesting,
        getApplicationError: state.security.getApplication.error,
        gettingSecurityLog: state.security.getApplicationSecurityLog.requesting,
        applicationSecurityLog: state.security.applicationSecurityLog || {},
        gettingCredentials: state.credential.getCredential.requesting,
        fetchLogError: state.security.getApplicationSecurityLog.error,
        fetchCredentialError: state.credential.getCredential.error,
        components,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ApplicationSecurityDetail)
);
