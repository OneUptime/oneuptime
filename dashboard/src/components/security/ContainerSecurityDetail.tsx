import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
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
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            prevProps.projectId !== this.props.projectId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getDockerCredentials' does not exist on ... Remove this comment to see the full error message
                getDockerCredentials,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                fetchComponent,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                componentSlug,
            } = this.props;
            if (projectId) {
                fetchComponent(projectId, componentSlug);
                getDockerCredentials({ projectId });
            }
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        if (prevProps.componentId !== this.props.componentId) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecuritySlug' does not exist on... Remove this comment to see the full error message
                containerSecuritySlug,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurityBySlug' does not exi... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurityId' does not exist on t... Remove this comment to see the full error message
        if (prevProps.containerSecurityId !== this.props.containerSecurityId) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurityId' does not exist on t... Remove this comment to see the full error message
                containerSecurityId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurityLog' does not exist ... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurity' does not exist on typ... Remove this comment to see the full error message
        socket.removeListener(`security_${this.props.containerSecurity._id}`);

        socket.removeListener(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurity' does not exist on typ... Remove this comment to see the full error message
            `securityLog_${this.props.containerSecurity._id}`
        );
    }

    componentDidMount() {
        resetIdCounter();
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecuritySlug' does not exist on... Remove this comment to see the full error message
            containerSecuritySlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurityBySlug' does not exi... Remove this comment to see the full error message
            getContainerSecurityBySlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurityId' does not exist on t... Remove this comment to see the full error message
            containerSecurityId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecurityLog' does not exist ... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurity' does not exist on typ... Remove this comment to see the full error message
            containerSecurity,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurityId' does not exist on t... Remove this comment to see the full error message
            containerSecurityId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecuritySlug' does not exist on... Remove this comment to see the full error message
            containerSecuritySlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerError' does not exist on typ... Remove this comment to see the full error message
            getContainerError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerSecurityLog' does not exist on ... Remove this comment to see the full error message
            containerSecurityLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gettingSecurityLog' does not exist on ty... Remove this comment to see the full error message
            gettingSecurityLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gettingCredentials' does not exist on ty... Remove this comment to see the full error message
            gettingCredentials,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCredentialError' does not exist on ... Remove this comment to see the full error message
            fetchCredentialError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLogError' does not exist on type 'R... Remove this comment to see the full error message
            fetchLogError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'components' does not exist on type 'Read... Remove this comment to see the full error message
            components,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scanContainerSecuritySuccess' does not e... Remove this comment to see the full error message
            scanContainerSecuritySuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getContainerSecuritySuccess' does not ex... Remove this comment to see the full error message
            getContainerSecuritySuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabIndex' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; componentId: any; containe... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: string; containerSecurityLog: any; }... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; componentId: any; containe... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ContainerSecurityDetail.displayName = 'Container Security Detail';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
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
