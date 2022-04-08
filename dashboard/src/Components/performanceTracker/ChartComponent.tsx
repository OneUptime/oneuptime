import PropTypes from 'prop-types';
import React, { Component, Fragment } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
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

interface ChartComponentProps {
    heading?: any;
    subHeading?: any;
    title?: {
        map?: Function
    };
    fetchTimeMetrics?: Function;
    fetchThroughputMetrics?: Function;
    setThroughputStartDate?: Function;
    setThroughputEndDate?: Function;
    setTimeStartDate?: Function;
    setTimeEndDate?: Function;
    timeStartDate?: any;
    timeEndDate?: any;
    throughputStartDate?: any;
    throughputEndDate?: any;
    timeMetrics?: object;
    throughputMetrics?: object;
    type?: string;
    performanceTracker?: object;
    resetTimeDate?: Function;
    resetThroughputDate?: Function;
    fetchErrorMetrics?: Function;
    setErrorStartDate?: Function;
    setErrorEndDate?: Function;
    resetErrorDate?: Function;
    errorMetrics?: object;
    errorStartDate?: any;
    errorEndDate?: any;
}

//import ShouldRender from '../../components/basic/ShouldRender';

export class ChartComponent extends Component<ChartComponentProps>{
    public static displayName = '';
    public static propTypes = {};
    currentDate: $TSFixMe;
    startDate: $TSFixMe;
    override componentDidMount() {
        const {

            performanceTracker,

            type,

            fetchTimeMetrics,

            fetchThroughputMetrics,

            fetchErrorMetrics,

            resetTimeDate,

            resetThroughputDate,

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

            JSON.stringify(this.props.performanceTracker)
        ) {
            const {

                performanceTracker,

                type,

                fetchTimeMetrics,

                fetchThroughputMetrics,

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

            type,

            setTimeStartDate,

            setThroughputStartDate,

            setErrorStartDate,

            fetchTimeMetrics,

            fetchThroughputMetrics,

            fetchErrorMetrics,

            timeEndDate,

            throughputEndDate,

            errorEndDate,

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

            type,

            setTimeEndDate,

            setThroughputEndDate,

            setErrorEndDate,

            fetchTimeMetrics,

            fetchThroughputMetrics,

            fetchErrorMetrics,

            timeStartDate,

            throughputStartDate,

            errorStartDate,

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

    override render() {
        const {

            heading,

            title,

            subHeading,

            type,

            timeMetrics,

            throughputMetrics,

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


ChartComponent.displayName = 'ChartComponent';


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

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
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

function mapStateToProps(state: RootState) {
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
