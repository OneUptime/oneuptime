import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { LargeSpinner } from '../basic/Loader';
import {
    getContainerSecurity,
    getContainerSecurityBySlug,
    getContainerSecurityLogBySlug,
    scanContainerSecuritySuccess,
    getContainerSecuritySuccess,
} from '../../actions/security';
import ContainerSecurityView from './ContainerSecurityView';
import ContainerSecurityDeleteBox from './ContainerSecurityDeleteBox';
import SecurityLog from './SecurityLog';
import { getDockerCredentials } from '../../actions/credential';
import BreadCrumbItem from '../breadCrumb/BreadCrumbItem';
import getParentRoute from '../../utils/getParentRoute';
import { API_URL } from '../../config';
import io from 'socket.io-client';

// Important: Below `/api` is also needed because `io` constructor strips out the path from the url.
const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});

class ContainerSecurityDetail extends Component {
    componentDidUpdate(prevProps) {
        if (prevProps.projectId !== this.props.projectId) {
            const {
                projectId,
                componentId,
                containerSecuritySlug,
                getContainerSecurityBySlug,
                getContainerSecurityLogBySlug,
                getDockerCredentials,
            } = this.props;

            // get a particular container security
            getContainerSecurityBySlug({
                projectId,
                componentId,
                containerSecuritySlug,
            });

            // get a container security log
            getContainerSecurityLogBySlug({
                projectId,
                componentId,
                containerSecuritySlug,
            });

            getDockerCredentials({ projectId });
        }
    }
    componentDidMount() {
        const {
            projectId,
            componentId,
            containerSecuritySlug,
            getContainerSecurityBySlug,
            getContainerSecurityLogBySlug,
            getDockerCredentials,
        } = this.props;

        // get a particular container security
        getContainerSecurityBySlug({
            projectId,
            componentId,
            containerSecuritySlug,
        });

        // get a container security log
        getContainerSecurityLogBySlug({
            projectId,
            componentId,
            containerSecuritySlug,
        });

        getDockerCredentials({ projectId });
    }

    render() {
        const {
            containerSecurity,
            projectId,
            componentId,
            componentSlug,
            containerSecurityId,
            containerSecuritySlug,
            isRequesting,
            getContainerError,
            containerSecurityLog,
            gettingSecurityLog,
            gettingCredentials,
            fetchCredentialError,
            fetchLogError,
            location: { pathname },
            components,
            scanContainerSecuritySuccess,
            getContainerSecuritySuccess,
        } = this.props;

        socket.on(`security_${containerSecurity._id}`, data => {
            getContainerSecuritySuccess(data);
        });

        socket.on(`securityLog_${containerSecurity._id}`, data => {
            scanContainerSecuritySuccess(data);
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
                        'containerSecurityId'
                    )}
                    name="Container Security"
                />
                <BreadCrumbItem
                    route={pathname}
                    name={containerSecurity.name || 'loading...'}
                    pageTitle="Container Detail"
                    containerType="Container Security"
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
                        containerSecurity.name &&
                        !gettingSecurityLog &&
                        !gettingCredentials
                    }
                >
                    <ContainerSecurityView
                        projectId={projectId}
                        componentId={componentId}
                        containerSecurityId={containerSecurityId}
                        containerSecuritySlug={containerSecuritySlug}
                        isRequesting={isRequesting}
                        containerSecurity={containerSecurity}
                        componentSlug={componentSlug}
                    />
                </ShouldRender>
                <ShouldRender
                    if={
                        containerSecurity.name &&
                        !gettingSecurityLog &&
                        !gettingCredentials
                    }
                >
                    <SecurityLog
                        type="Container"
                        containerSecurityLog={containerSecurityLog}
                    />
                </ShouldRender>
                <ShouldRender
                    if={
                        containerSecurity.name &&
                        !gettingSecurityLog &&
                        !gettingCredentials
                    }
                >
                    <ContainerSecurityDeleteBox 
                        projectId={projectId}
                        componentId={componentId}
                        containerSecurityId={containerSecurityId}
                        containerSecuritySlug={containerSecuritySlug}
                        componentSlug={componentSlug}
                    />
                </ShouldRender>
                <ShouldRender
                    if={
                        !isRequesting &&
                        !gettingSecurityLog &&
                        !gettingCredentials &&
                        (getContainerError ||
                            fetchLogError ||
                            fetchCredentialError)
                    }
                >
                    {getContainerError || fetchLogError || fetchCredentialError}
                </ShouldRender>
            </div>
        );
    }
}

ContainerSecurityDetail.displayName = 'Container Security Detail';

ContainerSecurityDetail.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    containerSecurityId: PropTypes.string,
    getContainerSecurityLogBySlug: PropTypes.func,
    getContainerSecurityBySlug: PropTypes.func,
    containerSecuritySlug: PropTypes.string,
    containerSecurity: PropTypes.object,
    isRequesting: PropTypes.bool,
    getContainerError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    containerSecurityLog: PropTypes.object,
    gettingSecurityLog: PropTypes.bool,
    getDockerCredentials: PropTypes.func,
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
    scanContainerSecuritySuccess: PropTypes.func,
    getContainerSecuritySuccess: PropTypes.func,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            getContainerSecurity,
            getContainerSecurityLogBySlug,
            getContainerSecurityBySlug,
            getDockerCredentials,
            scanContainerSecuritySuccess,
            getContainerSecuritySuccess,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const { componentSlug, containerSecuritySlug } = ownProps.match.params;
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

    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        componentId: components[0] && components[0]._id,
        componentSlug: components[0] && components[0].slug,
        containerSecuritySlug,
        containerSecurity: state.security.containerSecurity,
        isRequesting: state.security.getContainer.requesting,
        getContainerError: state.security.getContainer.error,
        containerSecurityLog: state.security.containerSecurityLog || {},
        gettingSecurityLog: state.security.getContainerSecurityLog.requesting,
        fetchLogError: state.security.getContainerSecurityLog.error,
        gettingCredentials: state.credential.getCredential.requesting,
        fetchCredentialError: state.credential.getCredential.error,
        components,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ContainerSecurityDetail)
);
