import React, { Component } from 'react';

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

import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';

import Fade from 'react-awesome-reveal/Fade';
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

            prevProps.projectId !== this.props.projectId ||

            prevProps.componentSlug !== this.props.componentSlug
        ) {
            const {

                getGitCredentials,

                projectId,

                fetchComponent,

                componentSlug,
            } = this.props;
            if (projectId) {
                getGitCredentials({ projectId });
                fetchComponent(projectId, componentSlug);
            }
        }
        if (

            prevProps.projectId !== this.props.projectId ||

            prevProps.componentId !== this.props.componentId
        ) {
            const {

                projectId,

                componentId,

                applicationSecuritySlug,

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

            prevProps.applicationSecurityId !== this.props.applicationSecurityId
        ) {
            const {

                projectId,

                componentId,

                applicationSecurityId,

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

        socket.removeListener(`security_${this.props.applicationSecurityId}`);

        socket.removeListener(

            `securityLog_${this.props.applicationSecurityId}`
        );
    }
    componentDidMount() {
        resetIdCounter();
        const {

            projectId,

            componentId,

            applicationSecuritySlug,

            getApplicationSecurityBySlug,

            getGitCredentials,

            fetchComponent,

            componentSlug,

            applicationSecurityId,

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

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

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

            currentProject,

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


ApplicationSecurityDetail.displayName = 'Application Security Detail';


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
