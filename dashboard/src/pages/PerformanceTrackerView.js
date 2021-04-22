import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import Dashboard from '../components/Dashboard';
import getParentRoute from '../utils/getParentRoute';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import PerformanceView from '../components/performanceTracker/PerformanceView';
import WebTransactionsChart from '../components/performanceTracker/WebTransactionsChart';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import { fetchComponent } from '../actions/component';
import { fetchPerformanceTracker } from '../actions/performanceTracker';
import {
    updateThroughputMetrics,
    updateTimeMetrics,
} from '../actions/performanceTrackerMetric';
import io from 'socket.io-client';
import { API_URL } from '../config';

const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
    transports: ['websocket', 'polling'],
});
class PerformanceTrackerView extends Component {
    state = {
        tabIndex: 0,
    };

    componentDidUpdate(prevProps) {
        const {
            currentProject,
            performanceTrackerSlug,
            fetchPerformanceTracker,
            performanceTracker,
            updateTimeMetrics,
            updateThroughputMetrics,
        } = this.props;
        if (
            JSON.stringify(prevProps.currentProject) !==
            JSON.stringify(currentProject)
        ) {
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
            performanceTracker &&
                socket.on(`timeMetrics-${performanceTracker._id}`, data =>
                    updateTimeMetrics(data)
                );
            performanceTracker &&
                socket.on(`throughputMetrics-${performanceTracker._id}`, data =>
                    updateThroughputMetrics(data)
                );
        }
    }

    componentDidMount() {
        const {
            componentSlug,
            fetchComponent,
            currentProject,
            performanceTrackerSlug,
            fetchPerformanceTracker,
        } = this.props;
        fetchComponent(componentSlug);
        currentProject &&
            fetchPerformanceTracker({
                projectId: currentProject._id,
                slug: performanceTrackerSlug,
            });
    }

    componentWillUnmount() {
        const { performanceTracker } = this.props;
        socket.removeListener(`timeMetrics-${performanceTracker._id}`);
        socket.removeListener(`throughputMetrics-${performanceTracker._id}`);
    }

    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    render() {
        const {
            location: { pathname },
            component,
            performanceTracker,
        } = this.props;
        const componentName = component ? component.name : '';
        return (
            <Dashboard>
                <Fade>
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
                    <Tabs
                        selectedTabClassName={'custom-tab-selected'}
                        onSelect={tabIndex => this.tabSelected(tabIndex)}
                        selectedIndex={this.state.tabIndex}
                    >
                        <div className="Flex-flex Flex-direction--columnReverse">
                            <TabList
                                id="customTabList"
                                className={'custom-tab-list'}
                            >
                                <Tab className={'custom-tab custom-tab-2'}>
                                    Charts
                                </Tab>
                                <Tab className={'custom-tab custom-tab-2'}>
                                    Data
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-2"
                                ></div>
                            </TabList>
                        </div>
                        <TabPanel>
                            <Fade>
                                <div className="Box-root Margin-bottom--12">
                                    <div>
                                        <div>
                                            <PerformanceView />
                                        </div>
                                    </div>
                                    <div>
                                        <div>
                                            <WebTransactionsChart
                                                heading="Web Transactions Time"
                                                title={[
                                                    'Node.js',
                                                    'Response time',
                                                ]}
                                                subHeading="shows graph of web transactions initiated through http requests"
                                                type="transactionTime"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <div>
                                            <WebTransactionsChart
                                                heading="Throughput"
                                                title={['Web throughput']}
                                                subHeading="shows graph of number of web transactions per minute"
                                                type="throughput"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <div>
                                            <WebTransactionsChart
                                                heading="Error rate"
                                                title={[
                                                    'Web errors',
                                                    'All errors',
                                                ]}
                                                subHeading="shows graph of errors occuring per minute"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <div>
                                            <WebTransactionsChart
                                                heading="Apdex Score"
                                                title={[
                                                    'App server',
                                                    'End user',
                                                ]}
                                                subHeading="shows graph of satisfied requests against total requests"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <div className="Box-root Margin-bottom--12">
                                    <div>
                                        <div>
                                            <WebTransactionsChart
                                                heading="Web Transactions Time"
                                                title={['Node.js']}
                                                subHeading="shows graph of web transactions initiated through http requests"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </Fade>
                        </TabPanel>
                    </Tabs>
                </Fade>
            </Dashboard>
        );
    }
}

PerformanceTrackerView.displayName = 'PerformanceTrackerView';
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchComponent,
            fetchPerformanceTracker,
            updateTimeMetrics,
            updateThroughputMetrics,
        },
        dispatch
    );
};
const mapStateToProps = (state, ownProps) => {
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
    };
};
PerformanceTrackerView.propTypes = {
    component: PropTypes.shape({
        name: PropTypes.any,
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
};
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PerformanceTrackerView);
