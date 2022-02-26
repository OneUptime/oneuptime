import PropTypes from 'prop-types';
import React, { Component, Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PerformanceChart from '../basic/performanceChart';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import moment from 'moment';
import {
    fetchTimeMetrics,
    fetchThroughputMetrics,
    fetchErrorMetrics,
    setTimeStartDate,
    setTimeEndDate,
    setThroughputEndDate,
    setThroughputStartDate,
    setErrorStartDate,
    setErrorEndDate,
    resetTimeDate,
    resetThroughputDate,
    resetErrorDate,
} from '../../actions/performanceTrackerMetric';

//import ShouldRender from '../../components/basic/ShouldRender';

export class ChartComponent extends Component {
    currentDate: $TSFixMe;
    startDate: $TSFixMe;
    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
            performanceTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            type,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchTimeMetrics' does not exist on type... Remove this comment to see the full error message
            fetchTimeMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchThroughputMetrics' does not exist o... Remove this comment to see the full error message
            fetchThroughputMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorMetrics' does not exist on typ... Remove this comment to see the full error message
            fetchErrorMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetTimeDate' does not exist on type 'R... Remove this comment to see the full error message
            resetTimeDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetThroughputDate' does not exist on t... Remove this comment to see the full error message
            resetThroughputDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetErrorDate' does not exist on type '... Remove this comment to see the full error message
            resetErrorDate,
        } = this.props;

        this.currentDate = moment(Date.now()).format();
        this.startDate = moment(this.currentDate)
            .subtract(30, 'days')
            .format();

        resetTimeDate(this.startDate, this.currentDate);
        resetThroughputDate(this.startDate, this.currentDate);
        resetErrorDate(this.startDate, this.currentDate);

        if (performanceTracker && type === 'throughput') {
            const { _id, key } = performanceTracker;
            fetchTimeMetrics({
                appId: _id,
                key,
                startDate: this.startDate,
                endDate: this.currentDate,
            });
        } else if (performanceTracker && type === 'transactionTime') {
            const { _id, key } = performanceTracker;
            fetchThroughputMetrics({
                appId: _id,
                key,
                startDate: this.startDate,
                endDate: this.currentDate,
            });
        } else if (performanceTracker && type === 'errorRate') {
            const { _id, key } = performanceTracker;
            fetchErrorMetrics({
                appId: _id,
                key,
                startDate: this.startDate,
                endDate: this.currentDate,
            });
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            JSON.stringify(prevProps.performanceTracker) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
            JSON.stringify(this.props.performanceTracker)
        ) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
                performanceTracker,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                type,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchTimeMetrics' does not exist on type... Remove this comment to see the full error message
                fetchTimeMetrics,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchThroughputMetrics' does not exist o... Remove this comment to see the full error message
                fetchThroughputMetrics,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorMetrics' does not exist on typ... Remove this comment to see the full error message
                fetchErrorMetrics,
            } = this.props;

            if (performanceTracker && type === 'throughput') {
                const { _id, key } = performanceTracker;
                fetchTimeMetrics({
                    appId: _id,
                    key,
                    startDate: this.startDate,
                    endDate: this.currentDate,
                });
            } else if (performanceTracker && type === 'transactionTime') {
                const { _id, key } = performanceTracker;
                fetchThroughputMetrics({
                    appId: _id,
                    key,
                    startDate: this.startDate,
                    endDate: this.currentDate,
                });
            } else if (performanceTracker && type === 'errorRate') {
                const { _id, key } = performanceTracker;
                fetchErrorMetrics({
                    appId: _id,
                    key,
                    startDate: this.startDate,
                    endDate: this.currentDate,
                });
            }
        }
    }

    handleCurrentDateRange = () => {
        return { startDate: this.startDate, endDate: this.currentDate };
    };

    handleStartDate = (val: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            type,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setTimeStartDate' does not exist on type... Remove this comment to see the full error message
            setTimeStartDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setThroughputStartDate' does not exist o... Remove this comment to see the full error message
            setThroughputStartDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setErrorStartDate' does not exist on typ... Remove this comment to see the full error message
            setErrorStartDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchTimeMetrics' does not exist on type... Remove this comment to see the full error message
            fetchTimeMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchThroughputMetrics' does not exist o... Remove this comment to see the full error message
            fetchThroughputMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorMetrics' does not exist on typ... Remove this comment to see the full error message
            fetchErrorMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'timeEndDate' does not exist on type 'Rea... Remove this comment to see the full error message
            timeEndDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'throughputEndDate' does not exist on typ... Remove this comment to see the full error message
            throughputEndDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorEndDate' does not exist on type 'Re... Remove this comment to see the full error message
            errorEndDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
            performanceTracker,
        } = this.props;

        if (type === 'throughput') {
            setThroughputStartDate(val);

            performanceTracker &&
                fetchThroughputMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: val,
                    endDate: throughputEndDate,
                });
        } else if (type === 'transactionTime') {
            setTimeStartDate(val);

            performanceTracker &&
                fetchTimeMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: val,
                    endDate: timeEndDate,
                });
        } else if (type === 'errorRate') {
            setErrorStartDate(val);

            performanceTracker &&
                fetchErrorMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: val,
                    endDate: errorEndDate,
                });
        }
    };

    handleEndDate = (val: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            type,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setTimeEndDate' does not exist on type '... Remove this comment to see the full error message
            setTimeEndDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setThroughputEndDate' does not exist on ... Remove this comment to see the full error message
            setThroughputEndDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setErrorEndDate' does not exist on type ... Remove this comment to see the full error message
            setErrorEndDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchTimeMetrics' does not exist on type... Remove this comment to see the full error message
            fetchTimeMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchThroughputMetrics' does not exist o... Remove this comment to see the full error message
            fetchThroughputMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorMetrics' does not exist on typ... Remove this comment to see the full error message
            fetchErrorMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'timeStartDate' does not exist on type 'R... Remove this comment to see the full error message
            timeStartDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'throughputStartDate' does not exist on t... Remove this comment to see the full error message
            throughputStartDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorStartDate' does not exist on type '... Remove this comment to see the full error message
            errorStartDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performanceTracker' does not exist on ty... Remove this comment to see the full error message
            performanceTracker,
        } = this.props;

        if (type === 'throughput') {
            setThroughputEndDate(val);

            performanceTracker &&
                fetchThroughputMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: throughputStartDate,
                    endDate: val,
                });
        } else if (type === 'transactionTime') {
            setTimeEndDate(val);

            performanceTracker &&
                fetchTimeMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: timeStartDate,
                    endDate: val,
                });
        } else if (type === 'errorRate') {
            setErrorEndDate(val);

            performanceTracker &&
                fetchErrorMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: errorStartDate,
                    endDate: val,
                });
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'heading' does not exist on type 'Readonl... Remove this comment to see the full error message
            heading,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
            title,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subHeading' does not exist on type 'Read... Remove this comment to see the full error message
            subHeading,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            type,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'timeMetrics' does not exist on type 'Rea... Remove this comment to see the full error message
            timeMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'throughputMetrics' does not exist on typ... Remove this comment to see the full error message
            throughputMetrics,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorMetrics' does not exist on type 'Re... Remove this comment to see the full error message
            errorMetrics,
        } = this.props;
        const status = {
            display: 'inline-block',
            borderRadius: '2px',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
            backgroundColor: 'rgb(117, 211, 128)',
        };
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>{heading}</span>
                                </span>
                                <p>
                                    <span>{subHeading}</span>
                                </p>
                                <div
                                    className="db-Trends-controls"
                                    style={{ marginTop: '15px' }}
                                >
                                    <div className="db-Trends-timeControls">
                                        <DateTimeRangePicker
                                            currentDateRange={this.handleCurrentDateRange()}
                                            handleStartDateTimeChange={(val: $TSFixMe) => this.handleStartDate(
                                                moment(val).format()
                                            )
                                            }
                                            handleEndDateTimeChange={(val: $TSFixMe) => this.handleEndDate(
                                                moment(val).format()
                                            )
                                            }
                                            formId={`performanceTrackeringDateTime-${heading}`}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="db-ListViewItem-cellContent Box-root">
                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <div className="Box-root Margin-right--16">
                                        <span className="Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--dark">
                                            <span></span>
                                        </span>
                                    </div>
                                </span>
                                <div className="Box-root Flex">
                                    <div className="Box-root Flex-flex">
                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                                                <span className="Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--dark">
                                                    <span></span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div
                            className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                            style={{ boxShadow: 'none' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <div
                                        style={{
                                            margin: '30px 20px 10px 20px',
                                        }}
                                    >
                                        {type === 'transactionTime' && (
                                            <PerformanceChart
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: any; data: any; name: string; symbol... Remove this comment to see the full error message
                                                type={type}
                                                data={timeMetrics.metrics}
                                                name={'response time'}
                                                symbol="ms"
                                                requesting={
                                                    timeMetrics.requesting
                                                }
                                            />
                                        )}
                                        {type === 'throughput' && (
                                            <PerformanceChart
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: any; data: any; name: string; symbol... Remove this comment to see the full error message
                                                type={type}
                                                data={throughputMetrics.metrics}
                                                name={'request per time'}
                                                symbol=""
                                                requesting={
                                                    throughputMetrics.requesting
                                                }
                                            />
                                        )}
                                        {type === 'errorRate' && (
                                            <PerformanceChart
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: any; data: any; name: string; symbol... Remove this comment to see the full error message
                                                type={type}
                                                data={errorMetrics.metrics}
                                                name={'request per time'}
                                                symbol=""
                                                requesting={
                                                    errorMetrics.requesting
                                                }
                                            />
                                        )}
                                    </div>
                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20">
                                        <div className="Box-root">
                                            {title.map((t: $TSFixMe, i: $TSFixMe) => (
                                                <Fragment key={i}>
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        <span
                                                            style={status}
                                                        ></span>
                                                        <span>{t}</span>
                                                    </span>
                                                    <span>
                                                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                                    </span>
                                                </Fragment>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div style={{ height: '20px' }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ChartComponent.displayName = 'ChartComponent';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ChartComponent.propTypes = {
    heading: PropTypes.any,
    subHeading: PropTypes.any,
    title: PropTypes.shape({
        map: PropTypes.func,
    }),
    fetchTimeMetrics: PropTypes.func,
    fetchThroughputMetrics: PropTypes.func,
    setThroughputStartDate: PropTypes.func,
    setThroughputEndDate: PropTypes.func,
    setTimeStartDate: PropTypes.func,
    setTimeEndDate: PropTypes.func,
    timeStartDate: PropTypes.any,
    timeEndDate: PropTypes.any,
    throughputStartDate: PropTypes.any,
    throughputEndDate: PropTypes.any,
    timeMetrics: PropTypes.object,
    throughputMetrics: PropTypes.object,
    type: PropTypes.string,
    performanceTracker: PropTypes.object,
    resetTimeDate: PropTypes.func,
    resetThroughputDate: PropTypes.func,
    fetchErrorMetrics: PropTypes.func,
    setErrorStartDate: PropTypes.func,
    setErrorEndDate: PropTypes.func,
    resetErrorDate: PropTypes.func,
    errorMetrics: PropTypes.object,
    errorStartDate: PropTypes.any,
    errorEndDate: PropTypes.any,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchTimeMetrics,
        fetchThroughputMetrics,
        setThroughputStartDate,
        setThroughputEndDate,
        setTimeStartDate,
        setTimeEndDate,
        resetTimeDate,
        resetThroughputDate,
        fetchErrorMetrics,
        setErrorStartDate,
        setErrorEndDate,
        resetErrorDate,
    },
    dispatch
);

function mapStateToProps(state: $TSFixMe) {
    return {
        currentProject: state.project.currentProject,
        timeStartDate: state.performanceTrackerMetric.timeStartDate,
        timeEndDate: state.performanceTrackerMetric.timeEndDate,
        throughputStartDate: state.performanceTrackerMetric.throughputStartDate,
        throughputEndDate: state.performanceTrackerMetric.throughputEndDate,
        errorStartDate: state.performanceTrackerMetric.errorStartDate,
        errorEndDate: state.performanceTrackerMetric.errorEndDate,
        timeMetrics: state.performanceTrackerMetric.timeMetrics,
        throughputMetrics: state.performanceTrackerMetric.throughputMetrics,
        errorMetrics: state.performanceTrackerMetric.errorMetrics,
        performanceTracker:
            state.performanceTracker.fetchPerformanceTracker &&
            state.performanceTracker.fetchPerformanceTracker.performanceTracker,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(ChartComponent);
