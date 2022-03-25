import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
// import PerformanceView from '../components/performanceTracker/PerformanceView';
import WebTransactionsChart from '../components/performanceTracker/WebTransactionsChart';

import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import { fetchComponent } from '../actions/component';
import {
    fetchPerformanceTracker,
    removeQuickStart,
    resetPerformanceTrackerKeyReset,
} from '../actions/performanceTracker';
import {
    updateThroughputMetrics,
    updateTimeMetrics,
    updateErrorMetrics,
} from '../actions/performanceTrackerMetric';
import TransactionMetricsTable from '../components/performanceTracker/TransactionMetricsTable';
import QuickStart from '../components/performanceTracker/QuickStart';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import PerformanceTrackerHeader from '../components/performanceTracker/PerformanceTrackerHeader';
import { socket } from '../components/basic/Socket';

interface PerformanceTrackerViewProps {
    component?: {
        name?: any,
        slug?: any
    };
    location?: any;
    fetchComponent?: Function;
    componentSlug?: string;
    fetchPerformanceTracker?: Function;
    performanceTrackerSlug?: string;
    currentProject?: object;
    performanceTracker?: object;
    updateTimeMetrics?: Function;
    updateThroughputMetrics?: Function;
    removeQuickStart?: Function;
    trackerObj?: object;
    resetPerformanceTrackerKeyReset?: Function;
    resetTrackerObj?: object;
    updateErrorMetrics?: Function;
    switchToProjectViewerNav?: boolean;
}

class PerformanceTrackerView extends Component<PerformanceTrackerViewProps> {
    state = {
        tabIndex: 0,
        showQuickStart: true,
    };

    componentDidUpdate(prevProps: $TSFixMe) {
        const {

            currentProject,

            performanceTrackerSlug,

            fetchPerformanceTracker,

            fetchComponent,

            performanceTracker,

            updateTimeMetrics,

            updateThroughputMetrics,

            updateErrorMetrics,

            componentSlug,
        } = this.props;
        if (

            prevProps.currentProject !== this.props.currentProject ||

            prevProps.componentSlug !== this.props.componentSlug
        ) {
            currentProject && fetchComponent(currentProject._id, componentSlug);
            currentProject &&
                fetchPerformanceTracker({
                    projectId: currentProject._id,
                    slug: performanceTrackerSlug,
                });
        }

        if (
            JSON.stringify(prevProps.performanceTracker) !==
            JSON.stringify(performanceTracker)
        ) {
            if (performanceTracker) {
                this.removeListeners();

                socket.on(`timeMetrics-${performanceTracker._id}`, (data: $TSFixMe) => updateTimeMetrics(data)
                );
                socket.on(`throughputMetrics-${performanceTracker._id}`, (data: $TSFixMe) => updateThroughputMetrics(data)
                );
                socket.on(`errorMetrics-${performanceTracker._id}`, (data: $TSFixMe) => updateErrorMetrics(data)
                );
            }
        }
    }

    override componentDidMount() {
        const {

            componentSlug,

            fetchComponent,

            currentProject,

            performanceTrackerSlug,

            fetchPerformanceTracker,

            resetPerformanceTrackerKeyReset,

            performanceTracker,

            updateErrorMetrics,
        } = this.props;

        if (performanceTracker) {
            this.removeListeners();

            socket.on(`timeMetrics-${performanceTracker._id}`, (data: $TSFixMe) => updateTimeMetrics(data)
            );
            socket.on(`throughputMetrics-${performanceTracker._id}`, (data: $TSFixMe) => updateThroughputMetrics(data)
            );
            socket.on(`errorMetrics-${performanceTracker._id}`, (data: $TSFixMe) => updateErrorMetrics(data)
            );
        }

        currentProject && fetchComponent(currentProject._id, componentSlug);
        currentProject &&
            fetchPerformanceTracker({
                projectId: currentProject._id,
                slug: performanceTrackerSlug,
            });

        resetPerformanceTrackerKeyReset();
    }

    override componentWillUnmount() {
        this.removeListeners();
    }

    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    removeListeners = () => {

        const { performanceTracker } = this.props;
        if (performanceTracker) {
            socket.removeListener(`timeMetrics-${performanceTracker._id}`);
            socket.removeListener(
                `throughputMetrics-${performanceTracker._id}`
            );
            socket.removeListener(`errorMetrics-${performanceTracker._id}`);
        }
    };

    override render() {
        const {

            location: { pathname },

            component,

            performanceTracker,

            removeQuickStart,

            currentProject,

            trackerObj,

            resetTrackerObj,

            switchToProjectViewerNav,
        } = this.props;

        if (performanceTracker) {
            // join performance tracker room
            socket.emit('app_id_switch', performanceTracker._id);
        }

        const componentName = component ? component.name : '';
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <>
                    <BreadCrumbItem
                        route="/"
                        name={projectName}
                        projectId={projectId}
                        slug={currentProject ? currentProject.slug : null}

                        switchToProjectViewerNav={switchToProjectViewerNav}
                    />
                    <BreadCrumbItem
                        route={getParentRoute(
                            pathname,
                            null,
                            'component-tracker'
                        )}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={getParentRoute(
                            pathname,
                            null,
                            'performance-tracker'
                        )}
                        name="Performance Tracker"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name={performanceTracker && performanceTracker.name}
                        pageTitle="Performance Tracker"
                    />
                    {!trackerObj.requesting &&
                        performanceTracker &&
                        performanceTracker.showQuickStart &&
                        this.state.showQuickStart && (
                            <QuickStart

                                appId={performanceTracker._id}
                                appKey={
                                    (resetTrackerObj.performanceTracker &&
                                        resetTrackerObj.performanceTracker
                                            .key) ||
                                    performanceTracker.key
                                }
                                close={() =>
                                    removeQuickStart({
                                        projectId: currentProject._id,
                                        performanceTrackerId:
                                            performanceTracker._id,
                                    }).then(() =>
                                        this.setState({
                                            showQuickStart: false,
                                        })
                                    )
                                }
                            />
                        )}
                    {!trackerObj.requesting &&
                        performanceTracker &&
                        component && (
                            <PerformanceTrackerHeader
                                performanceTracker={performanceTracker}
                                componentSlug={component.slug}
                                project={currentProject}
                                component={component}
                            />
                        )}
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
                                <Tab className={'custom-tab custom-tab-2'}>
                                    Overview
                                </Tab>
                                <Tab className={'custom-tab custom-tab-2'}>
                                    Details
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-2"
                                ></div>
                            </TabList>
                        </div>
                        <ShouldRender if={trackerObj.requesting}>
                            <LoadingState />
                        </ShouldRender>
                        <TabPanel>
                            <Fade>
                                {!trackerObj.requesting && (
                                    <div className="Box-root Margin-bottom--12">
                                        <div>
                                            <div>
                                                {/* <PerformanceView /> */}
                                            </div>
                                        </div>
                                        <div>
                                            <div>
                                                <WebTransactionsChart

                                                    heading="Web Transactions Time"
                                                    title={[]}
                                                    subHeading="Average Response time of your HTTP Requests."
                                                    type="transactionTime"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <div>
                                                <WebTransactionsChart

                                                    heading="Throughput"
                                                    title={[]}
                                                    subHeading="Number of HTTP requests per minute your app serves."
                                                    type="throughput"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <div>
                                                <WebTransactionsChart

                                                    heading="Error Rate"
                                                    title={[]}
                                                    subHeading="Number of HTTP Error responses per minute served by your app."
                                                    type="errorRate"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <div>
                                                {/* <WebTransactionsChart
                                                        heading="Apdex Score"
                                                        title={[]}
                                                        subHeading="shows graph of satisfied requests against total requests"
                                                    /> */}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <div className="Box-root Margin-bottom--12">
                                    <div>
                                        <div>
                                            <TransactionMetricsTable

                                                heading="Incoming HTTP Requests"
                                                subHeading="Shows list of all incoming HTTP requests received by your app."
                                                type="incoming"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <div>
                                            <TransactionMetricsTable

                                                heading="Outgoing HTTP Requests"
                                                subHeading="Shows a list of all the HTTP requests your app made."
                                                type="outgoing"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </Fade>
                        </TabPanel>
                    </Tabs>
                </>
            </Fade>
        );
    }
}


PerformanceTrackerView.displayName = 'PerformanceTrackerView';
const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchComponent,
            fetchPerformanceTracker,
            updateTimeMetrics,
            updateThroughputMetrics,
            removeQuickStart,
            resetPerformanceTrackerKeyReset,
            updateErrorMetrics,
        },
        dispatch
    );
};
const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { componentSlug, performanceTrackerSlug } = ownProps.match.params;
    const currentProject = state.project.currentProject;
    return {
        currentProject,
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        performanceTrackerSlug,
        performanceTracker:
            state.performanceTracker.fetchPerformanceTracker &&
            state.performanceTracker.fetchPerformanceTracker.performanceTracker,
        trackerObj: state.performanceTracker.fetchPerformanceTracker,
        resetTrackerObj: state.performanceTracker.resetPerformanceTrackerKey,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

PerformanceTrackerView.propTypes = {
    component: PropTypes.shape({
        name: PropTypes.any,
        slug: PropTypes.any,
    }),
    location: PropTypes.any,
    fetchComponent: PropTypes.func,
    componentSlug: PropTypes.string,
    fetchPerformanceTracker: PropTypes.func,
    performanceTrackerSlug: PropTypes.string,
    currentProject: PropTypes.object,
    performanceTracker: PropTypes.object,
    updateTimeMetrics: PropTypes.func,
    updateThroughputMetrics: PropTypes.func,
    removeQuickStart: PropTypes.func,
    trackerObj: PropTypes.object,
    resetPerformanceTrackerKeyReset: PropTypes.func,
    resetTrackerObj: PropTypes.object,
    updateErrorMetrics: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
};
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PerformanceTrackerView);
