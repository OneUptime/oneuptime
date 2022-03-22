import React, { Component } from 'react';

import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { LargeSpinner } from '../basic/Loader';
import {
    getContainerSecurityBySlug,
    scanContainerSecuritySuccess,
    getContainerSecuritySuccess,
    getContainerSecurityLog,
} from '../../actions/security';
import ContainerSecurityView from './ContainerSecurityView';
import ContainerSecurityDeleteBox from './ContainerSecurityDeleteBox';
import SecurityLog from './SecurityLog';
import { getDockerCredentials } from '../../actions/credential';
import { fetchComponent } from '../../actions/component';
import BreadCrumbItem from '../breadCrumb/BreadCrumbItem';
import getParentRoute from '../../utils/getParentRoute';

import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';

import { Fade } from 'react-awesome-reveal';
import { socket } from '../basic/Socket';

class ContainerSecurityDetail extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            tabIndex: 0,
        };
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (

            prevProps.projectId !== this.props.projectId ||

            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const {

                getDockerCredentials,

                projectId,

                fetchComponent,

                componentSlug,
            } = this.props;
            if (projectId) {
                fetchComponent(projectId, componentSlug);
                getDockerCredentials({ projectId });
            }
        }

        if (prevProps.componentId !== this.props.componentId) {
            const {

                projectId,

                componentId,

                containerSecuritySlug,

                getContainerSecurityBySlug,
            } = this.props;
            if (projectId && componentId) {
                // get a particular container security
                getContainerSecurityBySlug({
                    projectId,
                    componentId,
                    containerSecuritySlug,
                });
            }
        }

        if (prevProps.containerSecurityId !== this.props.containerSecurityId) {
            const {

                projectId,

                componentId,

                containerSecurityId,

                getContainerSecurityLog,
            } = this.props;
            if (containerSecurityId) {
                // get a container security log
                getContainerSecurityLog({
                    projectId,
                    componentId,
                    containerSecurityId,
                });
            }
        }
    }
    componentWillUnMount() {

        socket.removeListener(`security_${this.props.containerSecurity._id}`);

        socket.removeListener(

            `securityLog_${this.props.containerSecurity._id}`
        );
    }

    componentDidMount() {
        resetIdCounter();
        const {

            fetchComponent,

            componentSlug,

            projectId,

            componentId,

            containerSecuritySlug,

            getContainerSecurityBySlug,

            containerSecurityId,

            getContainerSecurityLog,
        } = this.props;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }
        if (projectId && componentId) {
            // get a particular container security
            getContainerSecurityBySlug({
                projectId,
                componentId,
                containerSecuritySlug,
            });
        }
        if (projectId) {
            getDockerCredentials({ projectId });
        }
        if (containerSecurityId) {
            // get a container security log
            getContainerSecurityLog({
                projectId,
                componentId,
                containerSecurityId,
            });
        }
    }

    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

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

            currentProject,

            switchToProjectViewerNav,
        } = this.props;

        if (containerSecurity) {
            // join room
            socket.emit('security_switch', containerSecurity._id);

            socket.on(`security_${containerSecurity._id}`, (data: $TSFixMe) => {
                getContainerSecuritySuccess(data);
            });

            socket.on(`securityLog_${containerSecurity._id}`, (data: $TSFixMe) => {
                scanContainerSecuritySuccess(data);
            });
        }

        const componentName =
            components.length > 0 ? components[0].name : 'loading...';
        const projectName = currentProject ? currentProject.name : '';

        return (
            <div className="Box-root Margin-bottom--12">
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
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
                <Tabs
                    selectedTabClassName={'custom-tab-selected'}
                    onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)}

                    selectedIndex={this.state.tabIndex}
                >
                    <div className="Flex-flex Flex-direction--columnReverse">
                        <TabList
                            id="customTabList"
                            className={'custom-tab-list'}
                        >
                            <Tab
                                className={'custom-tab custom-tab-2 basic-tab'}
                            >
                                Basic
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-2 advanced-options-tab'
                                }
                            >
                                Advanced Options
                            </Tab>
                            <div id="tab-slider" className="custom-tab-2"></div>
                        </TabList>
                    </div>
                    <TabPanel>
                        <Fade>
                            <ShouldRender
                                if={
                                    isRequesting &&
                                    gettingSecurityLog &&
                                    gettingCredentials
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
                                    containerSecuritySlug={
                                        containerSecuritySlug
                                    }

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
                                    !isRequesting &&
                                    !gettingSecurityLog &&
                                    !gettingCredentials &&
                                    (getContainerError ||
                                        fetchLogError ||
                                        fetchCredentialError)
                                }
                            >
                                {getContainerError ||
                                    fetchLogError ||
                                    fetchCredentialError}
                            </ShouldRender>
                        </Fade>
                    </TabPanel>
                    <TabPanel>
                        <Fade>
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
                                    containerSecuritySlug={
                                        containerSecuritySlug
                                    }
                                    componentSlug={componentSlug}
                                />
                            </ShouldRender>
                        </Fade>
                    </TabPanel>
                </Tabs>
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
    fetchComponent: PropTypes.func,
    getContainerSecurityLog: PropTypes.func,
    containerSecuritySlug: PropTypes.string,
    containerSecurity: PropTypes.object,
    isRequesting: PropTypes.bool,
    getContainerError: PropTypes.string,
    containerSecurityLog: PropTypes.object,
    gettingSecurityLog: PropTypes.bool,
    getDockerCredentials: PropTypes.func,
    getContainerSecurityBySlug: PropTypes.func,
    gettingCredentials: PropTypes.bool,
    fetchLogError: PropTypes.string,
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
    currentProject: PropTypes.object.isRequired,
    switchToProjectViewerNav: PropTypes.bool,
    fetchCredentialError: PropTypes.func,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        getDockerCredentials,
        scanContainerSecuritySuccess,
        getContainerSecuritySuccess,
        getContainerSecurityLog,
        fetchComponent,
        getContainerSecurityBySlug,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { componentSlug, containerSecuritySlug } = ownProps.match.params;
    const components: $TSFixMe = [];
    // filter to get the actual component
    state.component.componentList.components.map((item: $TSFixMe) => item.components.map((component: $TSFixMe) => {
        if (String(component.slug) === String(componentSlug)) {
            components.push(component);
        }
        return component;
    })
    );
    return {
        projectId:
            state.project.currentProject && state.project.currentProject._id,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        componentSlug,
        containerSecuritySlug,
        containerSecurity: state.security.containerSecurity,
        containerSecurityId: state.security.containerSecurity._id,
        isRequesting: state.security.getContainer.requesting,
        getContainerError: state.security.getContainer.error,
        containerSecurityLog: state.security.containerSecurityLog || {},
        gettingSecurityLog: state.security.getContainerSecurityLog.requesting,
        fetchLogError: state.security.getContainerSecurityLog.error,
        gettingCredentials: state.credential.getCredential.requesting,
        fetchCredentialError: state.credential.getCredential.error,
        components,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ContainerSecurityDetail)
);
