import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { LargeSpinner } from '../basic/Loader';
import ApplicationSecurityView from './ApplicationSecurityView';
import {
    getApplicationSecurityBySlug,
    scanApplicationSecuritySuccess,
    getApplicationSecuritySuccess,
    getApplicationSecurityLog,
} from '../../actions/security';
import { fetchComponent } from '../../actions/component';
import ApplicationSecurityDeleteBox from './ApplicationSecurityDeleteBox';
import SecurityLog from './SecurityLog';
import { getGitCredentials } from '../../actions/credential';
import BreadCrumbItem from '../breadCrumb/BreadCrumbItem';
import getParentRoute from '../../utils/getParentRoute';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import { socket } from '../basic/Socket';

class ApplicationSecurityDetail extends Component {
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getGitCredentials' does not exist on typ... Remove this comment to see the full error message
                getGitCredentials,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                fetchComponent,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                componentSlug,
            } = this.props;
            if (projectId) {
                getGitCredentials({ projectId });
                fetchComponent(projectId, componentSlug);
            }
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            prevProps.projectId !== this.props.projectId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            prevProps.componentId !== this.props.componentId
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecuritySlug' does not exist ... Remove this comment to see the full error message
                applicationSecuritySlug,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurityBySlug' does not e... Remove this comment to see the full error message
                getApplicationSecurityBySlug,
            } = this.props;
            if (projectId && componentId) {
                // get a particular container security
                getApplicationSecurityBySlug({
                    projectId,
                    componentId,
                    applicationSecuritySlug,
                });
            }
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurityId' does not exist on... Remove this comment to see the full error message
            prevProps.applicationSecurityId !== this.props.applicationSecurityId
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurityId' does not exist on... Remove this comment to see the full error message
                applicationSecurityId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurityLog' does not exis... Remove this comment to see the full error message
                getApplicationSecurityLog,
            } = this.props;
            if (applicationSecurityId) {
                // get a container security log
                getApplicationSecurityLog({
                    projectId,
                    componentId,
                    applicationSecurityId,
                });
            }
        }
    }
    componentWillUnMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurityId' does not exist on... Remove this comment to see the full error message
        socket.removeListener(`security_${this.props.applicationSecurityId}`);

        socket.removeListener(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurityId' does not exist on... Remove this comment to see the full error message
            `securityLog_${this.props.applicationSecurityId}`
        );
    }
    componentDidMount() {
        resetIdCounter();
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecuritySlug' does not exist ... Remove this comment to see the full error message
            applicationSecuritySlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurityBySlug' does not e... Remove this comment to see the full error message
            getApplicationSecurityBySlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getGitCredentials' does not exist on typ... Remove this comment to see the full error message
            getGitCredentials,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurityId' does not exist on... Remove this comment to see the full error message
            applicationSecurityId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecurityLog' does not exis... Remove this comment to see the full error message
            getApplicationSecurityLog,
        } = this.props;
        if (projectId) {
            getGitCredentials({ projectId });
            fetchComponent(projectId, componentSlug);
        }
        if (projectId && componentId) {
            // get a particular container security
            getApplicationSecurityBySlug({
                projectId,
                componentId,
                applicationSecuritySlug,
            });
        }
        if (applicationSecurityId) {
            // get a container security log
            getApplicationSecurityLog({
                projectId,
                componentId,
                applicationSecurityId,
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurity' does not exist on t... Remove this comment to see the full error message
            applicationSecurity,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurityId' does not exist on... Remove this comment to see the full error message
            applicationSecurityId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecuritySlug' does not exist ... Remove this comment to see the full error message
            applicationSecuritySlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationError' does not exist on t... Remove this comment to see the full error message
            getApplicationError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'gettingSecurityLog' does not exist on ty... Remove this comment to see the full error message
            gettingSecurityLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationSecurityLog' does not exist o... Remove this comment to see the full error message
            applicationSecurityLog,
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scanApplicationSecuritySuccess' does not... Remove this comment to see the full error message
            scanApplicationSecuritySuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getApplicationSecuritySuccess' does not ... Remove this comment to see the full error message
            getApplicationSecuritySuccess,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;

        if (applicationSecurityId) {
            // join room
            socket.emit('security_switch', applicationSecurityId);

            socket.on(`security_${applicationSecurityId}`, (data: $TSFixMe) => {
                getApplicationSecuritySuccess(data);
            });

            socket.on(`securityLog_${applicationSecurityId}`, (data: $TSFixMe) => {
                scanApplicationSecuritySuccess(data);
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
                    projectId={projectId || ''}
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
                                    applicationSecurity.name &&
                                    !gettingSecurityLog &&
                                    !gettingCredentials
                                }
                            >
                                <ApplicationSecurityView
                                    projectId={projectId}
                                    componentId={componentId}
                                    applicationSecurityId={
                                        applicationSecurityId
                                    }
                                    applicationSecuritySlug={
                                        applicationSecuritySlug
                                    }
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; componentId: any; applicat... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: string; applicationSecurityLog: any;... Remove this comment to see the full error message
                                    type="Application"
                                    applicationSecurityLog={
                                        applicationSecurityLog
                                    }
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
                        </Fade>
                    </TabPanel>
                    <TabPanel>
                        <Fade>
                            <ShouldRender
                                if={
                                    applicationSecurity.name &&
                                    !gettingSecurityLog &&
                                    !gettingCredentials
                                }
                            >
                                <ApplicationSecurityDeleteBox
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ projectId: any; componentId: any; applicat... Remove this comment to see the full error message
                                    projectId={projectId}
                                    componentId={componentId}
                                    applicationSecurityId={
                                        applicationSecurityId
                                    }
                                    applicationSecuritySlug={
                                        applicationSecuritySlug
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
ApplicationSecurityDetail.displayName = 'Application Security Detail';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ApplicationSecurityDetail.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    applicationSecurityId: PropTypes.string,
    fetchComponent: PropTypes.func,
    getApplicationSecurityLog: PropTypes.func,
    applicationSecuritySlug: PropTypes.string,
    getApplicationSecurityBySlug: PropTypes.func,
    applicationSecurity: PropTypes.object,
    isRequesting: PropTypes.bool,
    getApplicationError: PropTypes.string,
    gettingSecurityLog: PropTypes.bool,
    applicationSecurityLog: PropTypes.object,
    getGitCredentials: PropTypes.func,
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
    scanApplicationSecuritySuccess: PropTypes.func,
    getApplicationSecuritySuccess: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
    currentProject: PropTypes.object,
    fetchCredentialError: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        getGitCredentials,
        scanApplicationSecuritySuccess,
        getApplicationSecuritySuccess,
        getApplicationSecurityLog,
        fetchComponent,
        getApplicationSecurityBySlug,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { componentSlug, applicationSecuritySlug } = ownProps.match.params;
    const components: $TSFixMe = [];
    // filter to get the actual component
    state.component.componentList.components.map((item: $TSFixMe) => item.components.map((component: $TSFixMe) => {
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
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,

        componentSlug,
        applicationSecuritySlug,
        applicationSecurityId: state.security.applicationSecurity._id,
        applicationSecurity: state.security.applicationSecurity,
        isRequesting: state.security.getApplication.requesting,
        getApplicationError: state.security.getApplication.error,
        gettingSecurityLog: state.security.getApplicationSecurityLog.requesting,
        applicationSecurityLog: state.security.applicationSecurityLog || {},
        gettingCredentials: state.credential.getCredential.requesting,
        fetchLogError: state.security.getApplicationSecurityLog.error,
        fetchCredentialError: state.credential.getCredential.error,
        components,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        currentProject: state.project.currentProject,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(ApplicationSecurityDetail)
);
