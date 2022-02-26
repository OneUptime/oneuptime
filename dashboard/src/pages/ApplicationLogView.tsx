import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import {
    fetchApplicationLogs,
    editApplicationLog,
} from '../actions/applicationLog';
import { fetchComponent } from '../actions/component';
import ApplicationLogDetail from '../components/application/ApplicationLogDetail';
import ApplicationLogViewDeleteBox from '../components/application/ApplicationLogViewDeleteBox';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import LibraryList from '../components/application/LibraryList';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';

class ApplicationLogView extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            show: false,
            tabIndex: 0,
        };
    }
    componentDidMount() {
        this.ready();
    }

    ready = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchApplicationLogs' does not exist on ... Remove this comment to see the full error message
            fetchApplicationLogs,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logLimit' does not exist on type 'Readon... Remove this comment to see the full error message
            logLimit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logSkip' does not exist on type 'Readonl... Remove this comment to see the full error message
            logSkip,
        } = this.props;
        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject && this.props.currentProject._id;
        componentSlug && fetchComponent(projectId, componentSlug); // On Page Reload, the state is blank hence componentId is null. ComponentSlug present in URL bar is used to fetch component before the componentId is loaded alongside component.
        if (projectId && componentId) {
            componentId &&
                fetchApplicationLogs(projectId, componentId, logSkip, logLimit);
        }
    };

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.componentSlug) !==
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                String(this.props.componentSlug) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps.currentProject !== this.props.currentProject
        ) {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                this.props.componentSlug
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                this.props.fetchComponent(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                    this.props.componentSlug
                );
            }
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        if (prevProps.componentId !== this.props.componentId) {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.componentId
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchApplicationLogs' does not exist on ... Remove this comment to see the full error message
                this.props.fetchApplicationLogs(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                    this.props.componentId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'logSkip' does not exist on type 'Readonl... Remove this comment to see the full error message
                    this.props.logSkip,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'logLimit' does not exist on type 'Readon... Remove this comment to see the full error message
                    this.props.logLimit
                );
            }
        }
    }

    handleCloseQuickStart = () => {
        const postObj = { showQuickStart: false };
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
        const { applicationLog } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editApplicationLog' does not exist on ty... Remove this comment to see the full error message
        this.props.editApplicationLog(
            projectId,
            applicationLog[0].componentId._id,
            applicationLog[0]._id,
            postObj
        );
    };

    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');

        setTimeout(() => {
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        });
        this.setState({ tabIndex: index });
    };
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;

        const componentName = component ? component.name : '';
        const applicationLogName =
            applicationLog.length > 0 ? applicationLog[0].name : null;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'application-log')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'application-logs')}
                    name="Logs"
                />
                <BreadCrumbItem
                    route={pathname}
                    name={applicationLogName}
                    pageTitle="Logs"
                    containerType="Log Container"
                />
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                <ShouldRender if={!this.props.applicationLog[0]}>
                    <LoadingState />
                </ShouldRender>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                <ShouldRender if={this.props.applicationLog[0]}>
                    <Tabs
                        selectedTabClassName={'custom-tab-selected'}
                        onSelect={(tab: $TSFixMe) => this.tabSelected(tab)}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabIndex' does not exist on type 'Readon... Remove this comment to see the full error message
                        selectedIndex={this.state.tabIndex}
                    >
                        <div className="Flex-flex Flex-direction--columnReverse">
                            <TabList
                                id="customTabList"
                                className={'custom-tab-list'}
                            >
                                <Tab
                                    className={
                                        'custom-tab custom-tab-6 basic-tab bs-automate-tab'
                                    }
                                >
                                    Basic
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-6 advanced-options-tab bs-automate-tab'
                                    }
                                >
                                    Advanced Options
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-6 status-tab bs-automate-slider"
                                ></div>
                            </TabList>
                        </div>
                        <div className="Box-root">
                            <div>
                                <div>
                                    <div className="db-BackboneViewContainer">
                                        <div className="react-settings-view react-view">
                                            <span data-reactroot="">
                                                <div>
                                                    <div>
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                                                                    {applicationLog[0] &&
                                                                    applicationLog[0]
                                                                        .showQuickStart ? (
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .state
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'show' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                                    .show
                                                                            }
                                                                        >
                                                                            <LibraryList
                                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: string; type: string; applicationLo... Remove this comment to see the full error message
                                                                                title="Log Container"
                                                                                type="logs"
                                                                                applicationLog={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                                                                                        .applicationLog[0]
                                                                                }
                                                                                close={
                                                                                    this
                                                                                        .handleCloseQuickStart
                                                                                }
                                                                                setShow={() =>
                                                                                    this.setState(
                                                                                        {
                                                                                            show: false,
                                                                                        }
                                                                                    )
                                                                                }
                                                                            />
                                                                        </ShouldRender>
                                                                    ) : null}
                                                                    <ShouldRender
                                                                        if={
                                                                            !this
                                                                                .state
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'show' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                                .show
                                                                        }
                                                                    >
                                                                        <div>
                                                                            <ApplicationLogDetail
                                                                                componentId={
                                                                                    componentId
                                                                                }
                                                                                index={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                                                                                        .applicationLog[0]
                                                                                        ?._id
                                                                                }
                                                                                isDetails={
                                                                                    true
                                                                                }
                                                                                componentSlug={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                                                                                        .componentSlug
                                                                                }
                                                                                setShow={() =>
                                                                                    this.setState(
                                                                                        {
                                                                                            show: true,
                                                                                        }
                                                                                    )
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </ShouldRender>
                                                                </div>
                                                            </Fade>
                                                        </TabPanel>
                                                        <TabPanel>
                                                            <Fade>
                                                                <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <ApplicationLogViewDeleteBox
                                                                            componentId={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                    .componentId
                                                                            }
                                                                            applicationLog={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
                                                                                    .applicationLog[0]
                                                                            }
                                                                            componentSlug={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                                                                                    .componentSlug
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </Fade>
                                                        </TabPanel>
                                                    </div>
                                                </div>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Tabs>
                </ShouldRender>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ApplicationLogView.displayName = 'ApplicationLogView';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { fetchApplicationLogs, editApplicationLog, fetchComponent },
        dispatch
    );
};
const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const { componentSlug, applicationLogSlug } = props.match.params;
    const applicationLog = state.applicationLog.applicationLogsList.applicationLogs.filter(
        (applicationLog: $TSFixMe) => applicationLog.slug === applicationLogSlug
    );
    return {
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        applicationLog,
        componentSlug,
        component:
            state.component && state.component.currentComponent.component,
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        logSkip: state.applicationLog.applicationLogsList.skip || 0,
        logLimit: state.applicationLog.applicationLogsList.limit || 5,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ApplicationLogView.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    componentId: PropTypes.string,
    fetchComponent: PropTypes.func,
    componentSlug: PropTypes.string,
    fetchApplicationLogs: PropTypes.func,
    currentProject: PropTypes.object,
    applicationLog: PropTypes.arrayOf(
        PropTypes.shape({
            _id: PropTypes.string,
            name: PropTypes.string,
            showQuickStart: PropTypes.bool,
            componentId: PropTypes.object,
        })
    ),
    editApplicationLog: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
    logSkip: PropTypes.number,
    logLimit: PropTypes.number,
};

export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLogView);
