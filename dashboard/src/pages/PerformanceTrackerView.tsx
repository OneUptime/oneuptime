import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
// import PerformanceView from '../components/performanceTracker/PerformanceView';
import WebTransactionsChart from '../components/performanceTracker/WebTransactionsChart';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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

class PerformanceTrackerView extends Component {
    state = {
        tabIndex: 0,
        showQuickStart: true,
    };

    componentDidUpdate(prevProps: $TSFixMe) {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerSlug' does not exist o... Remove this comment to see the full error message
            performanceTrackerSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPerformanceTracker' does not exist ... Remove this comment to see the full error message
            fetchPerformanceTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
            performanceTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateTimeMetrics' does not exist on typ... Remove this comment to see the full error message
            updateTimeMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateThroughputMetrics' does not exist ... Remove this comment to see the full error message
            updateThroughputMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateErrorMetrics' does not exist on ty... Remove this comment to see the full error message
            updateErrorMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
        } = this.props;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps.currentProject !== this.props.currentProject ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
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

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTrackerSlug' does not exist o... Remove this comment to see the full error message
            performanceTrackerSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchPerformanceTracker' does not exist ... Remove this comment to see the full error message
            fetchPerformanceTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPerformanceTrackerKeyReset' does no... Remove this comment to see the full error message
            resetPerformanceTrackerKeyReset,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
            performanceTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateErrorMetrics' does not exist on ty... Remove this comment to see the full error message
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

    componentWillUnmount() {
        this.removeListeners();
    }

    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };

    removeListeners = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
        const { performanceTracker } = this.props;
        if (performanceTracker) {
            socket.removeListener(`timeMetrics-${performanceTracker._id}`);
            socket.removeListener(
                `throughputMetrics-${performanceTracker._id}`
            );
            socket.removeListener(`errorMetrics-${performanceTracker._id}`);
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
            performanceTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeQuickStart' does not exist on type... Remove this comment to see the full error message
            removeQuickStart,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerObj' does not exist on type 'Read... Remove this comment to see the full error message
            trackerObj,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetTrackerObj' does not exist on type ... Remove this comment to see the full error message
            resetTrackerObj,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ appId: any; appKey: any; close: () => any;... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ heading: string; title: never[]; subHeadin... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ heading: string; title: never[]; subHeadin... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ heading: string; title: never[]; subHeadin... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ heading: string; subHeading: string; type:... Remove this comment to see the full error message
                                                heading="Incoming HTTP Requests"
                                                subHeading="Shows list of all incoming HTTP requests received by your app."
                                                type="incoming"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <div>
                                            <TransactionMetricsTable
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ heading: string; subHeading: string; type:... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
PerformanceTrackerView.displayName = 'PerformanceTrackerView';
const mapDispatchToProps = (dispatch: $TSFixMe) => {
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
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
