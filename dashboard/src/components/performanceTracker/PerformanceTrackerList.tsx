import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import { history } from '../../store';
import ShouldRender from '../basic/ShouldRender';
import AlertPanel from '../basic/AlertPanel';
import { fetchLastMetrics } from '../../actions/performanceTracker';
import { ListLoader } from '../basic/Loader';

class PerformanceTrackerList extends Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLastMetrics' does not exist on type... Remove this comment to see the full error message
        const { fetchLastMetrics, performanceTracker, projectId } = this.props;

        const endDate = moment(Date.now()).format();
        const startDate = moment(endDate)
            .subtract(30, 'days')
            .format();

        fetchLastMetrics({
            projectId,
            performanceTrackerId: performanceTracker._id,
            startDate,
            endDate,
        });
    }

    viewMore = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
        const { componentSlug, projectSlug, performanceTracker } = this.props;
        history.push(
            `/dashboard/project/${projectSlug}/component/${componentSlug}/performance-tracker/${performanceTracker.slug}`
        );
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
        const { performanceTracker, lastMetricsObj } = this.props;

        const metrics = lastMetricsObj
            ? lastMetricsObj.metrics.filter(
                  (metric: $TSFixMe) => String(metric.performanceTrackerId) ===
                  String(performanceTracker._id)
              )
            : [];

        return (
            <div>
                <div
                    className="Box-root Card-shadow--medium"
                    style={{ marginTop: '10px', marginBottom: '10px' }}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                    tabIndex="0"
                >
                    <div>
                        <div className="db-Trends-header">
                            <div className="db-Trends-title">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <div></div>
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span
                                                id="performance-tracker-content-header"
                                                className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                            >
                                                <span
                                                    id={`performance-tracker-title-${performanceTracker.name}`}
                                                >
                                                    {performanceTracker.name}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="db-Trends-control Flex-justifyContent--flexEnd Flex-flex">
                                            <div>
                                                <button
                                                    id={`more-details-${performanceTracker.name}`}
                                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--more"
                                                    type="button"
                                                    onClick={this.viewMore}
                                                >
                                                    <span>More</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <ShouldRender if={metrics.length === 0}>
                            <ListLoader />
                        </ShouldRender>
                        {metrics.map((metric: $TSFixMe) => <>
                            <ShouldRender
                                if={
                                    metric &&
                                    !metric.requesting &&
                                    metric.time === 0 &&
                                    metric.throughput === 0 &&
                                    metric.errorRate === 0
                                }
                            >
                                <AlertPanel
                                    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                                    id={`${performanceTracker.name}-no-log-warning`}
                                    message={
                                        <span>
                                            This Performance Tracker is
                                            currently not receiving any
                                            metrics.
                                        </span>
                                    }
                                />
                            </ShouldRender>
                            <ShouldRender if={metric && !metric.requesting}>
                                <div
                                    className="db-TrendRow db-ListViewItem-header db-Trends-header"
                                    style={{
                                        zIndex: 'unset',
                                    }}
                                >
                                    <div
                                        className="db-Trend-colInformation"
                                        id={`${performanceTracker.name}-all`}
                                    >
                                        <div
                                            className="db-Trend-rowTitle"
                                            title="Web Transaction Time"
                                        >
                                            <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                                <span className="chart-font">
                                                    Web Transaction Time
                                                </span>
                                            </div>
                                        </div>
                                        <div className="db-Trend-row">
                                            <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                                <span>
                                                    {' '}
                                                    <span className="chart-font">
                                                        {metric.time === 0
                                                            ? '-'
                                                            : `${metric.time} ms`}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div
                                        className="db-Trend-colInformation"
                                        id={`${performanceTracker.name}-error`}
                                    >
                                        <div
                                            className="db-Trend-rowTitle"
                                            title="Throughput"
                                        >
                                            <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                                <span className="chart-font">
                                                    Throughput
                                                </span>
                                            </div>
                                        </div>
                                        <div className="db-Trend-row">
                                            <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                                <span>
                                                    {' '}
                                                    <span className="chart-font">
                                                        {metric.throughput ===
                                                        0
                                                            ? '-'
                                                            : metric.throughput}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div
                                        className="db-Trend-colInformation"
                                        id={`${performanceTracker.name}-warning`}
                                    >
                                        <div
                                            className="db-Trend-rowTitle"
                                            title="Error Rate"
                                        >
                                            <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                                <span className="chart-font">
                                                    Error Rate
                                                </span>
                                            </div>
                                        </div>
                                        <div className="db-Trend-row">
                                            <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                                <span>
                                                    {' '}
                                                    <span className="chart-font">
                                                        {metric.time ===
                                                            0 &&
                                                        metric.throughput ===
                                                            0 &&
                                                        metric.errorRate ===
                                                            0
                                                            ? '-'
                                                            : metric.errorRate}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </ShouldRender>
                        </>)}
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
PerformanceTrackerList.displayName = 'PerformanceTrackerList';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
PerformanceTrackerList.propTypes = {
    performanceTracker: PropTypes.object,
    componentSlug: PropTypes.string,
    projectSlug: PropTypes.string,
    lastMetricsObj: PropTypes.object,
    fetchLastMetrics: PropTypes.func,
    projectId: PropTypes.string,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ fetchLastMetrics }, dispatch);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        lastMetricsObj: state.performanceTracker.lastMetrics,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PerformanceTrackerList);
