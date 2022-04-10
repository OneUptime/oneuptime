import PropTypes from 'prop-types';
import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import moment from 'moment';
import {
    fetchIncomingMetrics,
    fetchOutgoingMetrics,
    setIncomingEndDate,
    setIncomingStartDate,
    setOutgoingEndDate,
    setOutgoingStartDate,
    resetIncomingDate,
    resetOutgoingDate,
} from '../../actions/performanceTrackerMetric';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import { numDecimal } from '../../utils/formatNumber';
import DeletePerformanceMetric from './DeletePerformanceMetric';
import { openModal } from 'Common-ui/actions/modal';
import paginate from '../../utils/paginate';

interface TableComponentProps {
    heading?: any;
    subHeading?: any;
    title?: {
        map?: Function
    };
    type?: string;
    performanceTracker?: object;
    fetchIncomingMetrics?: Function;
    fetchOutgoingMetrics?: Function;
    setIncomingStartDate?: Function;
    setIncomingEndDate?: Function;
    setOutgoingStartDate?: Function;
    setOutgoingEndDate?: Function;
    incomingStartDate?: string;
    incomingEndDate?: string;
    outgoingStartDate?: string;
    outgoingEndDate?: string;
    incomingMetrics?: object;
    outgoingMetrics?: object;
    openModal?: Function;
    resetOutgoingDate?: Function;
    resetIncomingDate?: Function;
}

class TableComponent extends Component<ComponentProps> {
    currentDate: $TSFixMe;
    startDate: $TSFixMe;
    state = {
        page: 1,
    };


    prev = () => this.setState(prevState => ({ page: prevState.page - 1 }));

    next = () => this.setState(prevState => ({ page: prevState.page + 1 }));

    override componentDidMount() {
        const {

            performanceTracker,

            type,

            fetchIncomingMetrics,

            fetchOutgoingMetrics,

            resetIncomingDate,

            resetOutgoingDate,
        } = this.props;

        this.currentDate = moment(Date.now()).format();
        this.startDate = moment(this.currentDate)
            .subtract(30, 'days')
            .format();

        resetIncomingDate(this.startDate, this.currentDate);
        resetOutgoingDate(this.startDate, this.currentDate);

        if (performanceTracker && type === 'incoming') {
            const { _id, key } = performanceTracker;
            fetchIncomingMetrics({
                appId: _id,
                key,
                startDate: this.startDate,
                endDate: this.currentDate,
                skip: 0,
                limit: 10,
            });
        } else if (performanceTracker && type === 'outgoing') {
            const { _id, key } = performanceTracker;
            fetchOutgoingMetrics({
                appId: _id,
                key,
                startDate: this.startDate,
                endDate: this.currentDate,
                skip: 0,
                limit: 10,
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

                fetchIncomingMetrics,

                fetchOutgoingMetrics,
            } = this.props;

            if (performanceTracker && type === 'incoming') {
                const { _id, key } = performanceTracker;
                fetchIncomingMetrics({
                    appId: _id,
                    key,
                    startDate: this.startDate,
                    endDate: this.currentDate,
                    skip: 0,
                    limit: 10,
                });
            } else if (performanceTracker && type === 'outgoing') {
                const { _id, key } = performanceTracker;
                fetchOutgoingMetrics({
                    appId: _id,
                    key,
                    startDate: this.startDate,
                    endDate: this.currentDate,
                    skip: 0,
                    limit: 10,
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

            setIncomingStartDate,

            setOutgoingStartDate,

            fetchIncomingMetrics,

            fetchOutgoingMetrics,

            incomingEndDate,

            outgoingEndDate,

            performanceTracker,
        } = this.props;

        if (type === 'incoming') {
            setIncomingStartDate(val);

            performanceTracker &&
                fetchIncomingMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: val,
                    endDate: incomingEndDate,
                });
        } else if (type === 'outgoing') {
            setOutgoingStartDate(val);

            performanceTracker &&
                fetchOutgoingMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: val,
                    endDate: outgoingEndDate,
                });
        }
    };

    handleEndDate = (val: $TSFixMe) => {
        const {

            type,

            setIncomingEndDate,

            setOutgoingEndDate,

            fetchIncomingMetrics,

            fetchOutgoingMetrics,

            incomingStartDate,

            outgoingStartDate,

            performanceTracker,
        } = this.props;

        if (type === 'incoming') {
            setIncomingEndDate(val);

            performanceTracker &&
                fetchIncomingMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: incomingStartDate,
                    endDate: val,
                    skip: 0,
                    limit: 10,
                });
        } else if (type === 'outgoing') {
            setOutgoingEndDate(val);

            performanceTracker &&
                fetchOutgoingMetrics({
                    appId: performanceTracker._id,
                    key: performanceTracker.key,
                    startDate: outgoingStartDate,
                    endDate: val,
                    skip: 0,
                    limit: 10,
                });
        }
    };

    handlePrev = (skip: PositiveNumber, limit: PositiveNumber) => {
        const {

            performanceTracker,

            type,

            incomingStartDate,

            incomingEndDate,

            outgoingStartDate,

            outgoingEndDate,

            fetchIncomingMetrics,

            fetchOutgoingMetrics,
        } = this.props;

        if (type === 'incoming') {
            skip = (skip || 0) > (limit || 10) ? skip - limit : 0;
            fetchIncomingMetrics({
                appId: performanceTracker._id,
                key: performanceTracker.key,
                startDate: incomingStartDate,
                endDate: incomingEndDate,
                skip,
                limit,
            });
        }
        if (type === 'outgoing') {
            skip = (skip || 0) > (limit || 10) ? skip - limit : 0;
            fetchOutgoingMetrics({
                appId: performanceTracker._id,
                key: performanceTracker.key,
                startDate: outgoingStartDate,
                endDate: outgoingEndDate,
                skip,
                limit,
            });
        }
    };

    handleNext = (skip: PositiveNumber, limit: PositiveNumber) => {
        const {

            performanceTracker,

            type,

            incomingStartDate,

            incomingEndDate,

            outgoingStartDate,

            outgoingEndDate,

            fetchIncomingMetrics,

            fetchOutgoingMetrics,
        } = this.props;

        if (type === 'incoming') {
            skip = skip + limit;
            fetchIncomingMetrics({
                appId: performanceTracker._id,
                key: performanceTracker.key,
                startDate: incomingStartDate,
                endDate: incomingEndDate,
                skip,
                limit,
            });
        }
        if (type === 'outgoing') {
            skip = skip + limit;
            fetchOutgoingMetrics({
                appId: performanceTracker._id,
                key: performanceTracker.key,
                startDate: outgoingStartDate,
                endDate: outgoingEndDate,
                skip,
                limit,
            });
        }
    };

    override render() {
        const {

            heading,

            subHeading,

            type,

            incomingMetrics,

            outgoingMetrics,

            performanceTracker,

            incomingStartDate,

            incomingEndDate,

            outgoingStartDate,

            outgoingEndDate,

            openModal,
        } = this.props;
        const { page } = this.state;
        const incomingMetricsData = paginate(incomingMetrics.metrics, page);
        const outgoingMetricsData = paginate(outgoingMetrics.metrics, page);

        // const canNextIncoming =
        //     incomingMetrics.count >
        //     Number(incomingMetrics.skip) + Number(incomingMetrics.limit)
        //         ? true
        //         : false;
        // const canPrevIncoming =
        //     Number(incomingMetrics.skip) <= 0 ? false : true;

        // const canNextOutgoing =
        //     outgoingMetrics.count >
        //     Number(outgoingMetrics.skip) + Number(outgoingMetrics.limit)
        //         ? true
        //         : false;
        // const canPrevOutgoing =
        //     Number(outgoingMetrics.skip) <= 0 ? false : true;

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
                                    {type === 'incoming' && (
                                        <div className="bs-ContentSection-content Box-root">
                                            <div className="bs-ObjectList db-UserList">
                                                <div
                                                    style={{
                                                        overflow: 'hidden',
                                                        overflowX: 'auto',
                                                    }}
                                                >
                                                    <div
                                                        id="scheduledEventsList"
                                                        className="bs-ObjectList-rows"
                                                    >
                                                        <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                            <div className="bs-ObjectList-cell">
                                                                Method
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Path
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Average Time
                                                                (ms)
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Max Time (ms)
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Throughput
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Error Count
                                                            </div>
                                                            {/* <div
                                                                className="bs-ObjectList-cell"
                                                                style={{
                                                                    float:
                                                                        'right',
                                                                    marginRight:
                                                                        '10px',
                                                                }}
                                                            >
                                                                Action
                                                            </div> */}
                                                        </header>
                                                        {incomingMetricsData &&
                                                            incomingMetricsData
                                                                .data.length >
                                                            0 &&
                                                            incomingMetricsData.data.map(
                                                                (
                                                                    metric: $TSFixMe,
                                                                    index: $TSFixMe
                                                                ) => (
                                                                    <div
                                                                        key={
                                                                            metric._id
                                                                        }
                                                                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                                        style={{
                                                                            backgroundColor:
                                                                                'white',
                                                                            cursor:
                                                                                'pointer',
                                                                        }}
                                                                    >
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                                            <div className="scheduled-event-name Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                {
                                                                                    metric.method
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                                            <div className="scheduled-event-name Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                {
                                                                                    metric.callIdentifier
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {numDecimal(
                                                                                    metric
                                                                                        .metrics
                                                                                        .avgTime
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {numDecimal(
                                                                                    metric
                                                                                        .metrics
                                                                                        .maxTime
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {
                                                                                    metric
                                                                                        .metrics
                                                                                        .throughput
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {metric
                                                                                    .metrics
                                                                                    .errorCount ||
                                                                                    0}
                                                                            </div>
                                                                        </div>
                                                                        <ShouldRender
                                                                            if={
                                                                                false
                                                                            }
                                                                        >
                                                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                <div className="Box-root">
                                                                                    <button
                                                                                        id={`viewScheduledEvent_${index}`}
                                                                                        title="view"
                                                                                        className="bs-Button bs-DeprecatedButton"
                                                                                        type="button"
                                                                                        style={{
                                                                                            float:
                                                                                                'right',
                                                                                            marginRight:
                                                                                                '10px',
                                                                                        }}
                                                                                        onClick={() =>
                                                                                            openModal(
                                                                                                {
                                                                                                    content: DeletePerformanceMetric,
                                                                                                    appId:
                                                                                                        performanceTracker._id,
                                                                                                    metricId:
                                                                                                        metric._id,
                                                                                                    key:
                                                                                                        performanceTracker.key,
                                                                                                    type:
                                                                                                        'incoming',
                                                                                                    startDate: incomingStartDate,
                                                                                                    endDate: incomingEndDate,
                                                                                                    skip:
                                                                                                        incomingMetrics.skip,
                                                                                                    limit:
                                                                                                        incomingMetrics.limit,
                                                                                                }
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        <span>
                                                                                            Delete
                                                                                        </span>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </ShouldRender>
                                                                    </div>
                                                                )
                                                            )}
                                                    </div>
                                                </div>
                                                <ShouldRender
                                                    if={
                                                        incomingMetrics.requesting
                                                    }
                                                >
                                                    <ListLoader />
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        (!incomingMetrics.metrics ||
                                                            incomingMetrics
                                                                .metrics
                                                                .length ===
                                                            0) &&
                                                        !incomingMetrics.requesting &&
                                                        !incomingMetrics.error
                                                    }
                                                >
                                                    <div
                                                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                                        style={{
                                                            textAlign: 'center',
                                                            backgroundColor:
                                                                'white',
                                                            padding:
                                                                '20px 10px 0',
                                                        }}
                                                    >
                                                        <span>
                                                            {(!incomingMetrics.metrics ||
                                                                incomingMetrics
                                                                    .metrics
                                                                    .length ===
                                                                0) &&
                                                                !incomingMetrics.requesting &&
                                                                !incomingMetrics.error
                                                                ? 'There is no incoming performance metrics at this time'
                                                                : null}
                                                            {incomingMetrics.error
                                                                ? incomingMetrics.error
                                                                : null}
                                                        </span>
                                                    </div>
                                                </ShouldRender>
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                                                    style={{
                                                        backgroundColor:
                                                            'white',
                                                    }}
                                                >
                                                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                <span
                                                                    id="scheduledEventCount"
                                                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                                >
                                                                    {
                                                                        incomingMetrics.count
                                                                    }{' '}
                                                                    Incoming
                                                                    Requests
                                                                </span>
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                                            <div className="Box-root Margin-right--8">
                                                                <button
                                                                    id="btnPrevSchedule"
                                                                    onClick={
                                                                        this
                                                                            .prev
                                                                    }
                                                                    className={
                                                                        'Button bs-ButtonLegacy' +
                                                                        (incomingMetricsData.pre_page
                                                                            ? ''
                                                                            : 'Is--disabled')
                                                                    }
                                                                    disabled={
                                                                        !incomingMetricsData.pre_page
                                                                    }
                                                                    data-db-analytics-name="list_view.pagination.previous"
                                                                    type="button"
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Previous
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                            <div className="Box-root">
                                                                <button
                                                                    id="btnNextSchedule"
                                                                    onClick={
                                                                        this
                                                                            .next
                                                                    }
                                                                    className={
                                                                        'Button bs-ButtonLegacy' +
                                                                        (incomingMetricsData.next_page
                                                                            ? ''
                                                                            : 'Is--disabled')
                                                                    }
                                                                    disabled={
                                                                        !incomingMetricsData.next_page
                                                                    }
                                                                    data-db-analytics-name="list_view.pagination.next"
                                                                    type="button"
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Next
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {type === 'outgoing' && (
                                        <div className="bs-ContentSection-content Box-root">
                                            <div className="bs-ObjectList db-UserList">
                                                <div
                                                    style={{
                                                        overflow: 'hidden',
                                                        overflowX: 'auto',
                                                    }}
                                                >
                                                    <div
                                                        id="scheduledEventsList"
                                                        className="bs-ObjectList-rows"
                                                    >
                                                        <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                                            <div className="bs-ObjectList-cell">
                                                                Method
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Path
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Average Time
                                                                (ms)
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Max Time (ms)
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Throughput
                                                            </div>
                                                            <div className="bs-ObjectList-cell">
                                                                Error Count
                                                            </div>
                                                            {/* <div
                                                                className="bs-ObjectList-cell"
                                                                style={{
                                                                    float:
                                                                        'right',
                                                                    marginRight:
                                                                        '10px',
                                                                }}
                                                            >
                                                                Action
                                                            </div> */}
                                                        </header>
                                                        {outgoingMetricsData &&
                                                            outgoingMetricsData
                                                                .data.length >
                                                            0 &&
                                                            outgoingMetricsData.data.map(
                                                                (
                                                                    metric: $TSFixMe,
                                                                    index: $TSFixMe
                                                                ) => (
                                                                    <div
                                                                        key={
                                                                            metric._id
                                                                        }
                                                                        className="scheduled-event-list-item bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                                                                        style={{
                                                                            backgroundColor:
                                                                                'white',
                                                                            cursor:
                                                                                'pointer',
                                                                        }}
                                                                    >
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                                            <div className="scheduled-event-name Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                {
                                                                                    metric.method
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle bs-ActionsParent">
                                                                            <div className="scheduled-event-name Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                {
                                                                                    metric.callIdentifier
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {numDecimal(
                                                                                    metric
                                                                                        .metrics
                                                                                        .avgTime
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {numDecimal(
                                                                                    metric
                                                                                        .metrics
                                                                                        .maxTime
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {
                                                                                    metric
                                                                                        .metrics
                                                                                        .throughput
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                            <div className="bs-ObjectList-cell-row">
                                                                                {
                                                                                    metric
                                                                                        .metrics
                                                                                        .errorCount
                                                                                }
                                                                            </div>
                                                                        </div>
                                                                        <ShouldRender
                                                                            if={
                                                                                false
                                                                            }
                                                                        >
                                                                            <div className="bs-ObjectList-cell bs-u-v-middle">
                                                                                <div className="Box-root">
                                                                                    <button
                                                                                        id={`viewScheduledEvent_${index}`}
                                                                                        title="view"
                                                                                        className="bs-Button bs-DeprecatedButton"
                                                                                        type="button"
                                                                                        style={{
                                                                                            float:
                                                                                                'right',
                                                                                            marginRight:
                                                                                                '10px',
                                                                                        }}
                                                                                        onClick={() =>
                                                                                            openModal(
                                                                                                {
                                                                                                    content: DeletePerformanceMetric,
                                                                                                    appId:
                                                                                                        performanceTracker._id,
                                                                                                    metricId:
                                                                                                        metric._id,
                                                                                                    key:
                                                                                                        performanceTracker.key,
                                                                                                    type:
                                                                                                        'outgoing',
                                                                                                    startDate: outgoingStartDate,
                                                                                                    endDate: outgoingEndDate,
                                                                                                    skip:
                                                                                                        outgoingMetrics.skip,
                                                                                                    limit:
                                                                                                        outgoingMetrics.limit,
                                                                                                }
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        <span>
                                                                                            Delete
                                                                                        </span>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </ShouldRender>
                                                                    </div>
                                                                )
                                                            )}
                                                    </div>
                                                </div>
                                                <ShouldRender
                                                    if={
                                                        outgoingMetrics.requesting
                                                    }
                                                >
                                                    <ListLoader />
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        (!outgoingMetrics.metrics ||
                                                            outgoingMetrics
                                                                .metrics
                                                                .length ===
                                                            0) &&
                                                        !outgoingMetrics.requesting &&
                                                        !outgoingMetrics.error
                                                    }
                                                >
                                                    <div
                                                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                                        style={{
                                                            textAlign: 'center',
                                                            backgroundColor:
                                                                'white',
                                                            padding:
                                                                '20px 10px 0',
                                                        }}
                                                    >
                                                        <span>
                                                            {(!outgoingMetrics.metrics ||
                                                                outgoingMetrics
                                                                    .metrics
                                                                    .length ===
                                                                0) &&
                                                                !outgoingMetrics.requesting &&
                                                                !outgoingMetrics.error
                                                                ? 'There is no outgoing performance metrics at this time'
                                                                : null}
                                                            {outgoingMetrics.error
                                                                ? outgoingMetrics.error
                                                                : null}
                                                        </span>
                                                    </div>
                                                </ShouldRender>
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                                                    style={{
                                                        backgroundColor:
                                                            'white',
                                                    }}
                                                >
                                                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                <span
                                                                    id="scheduledEventCount"
                                                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                                >
                                                                    {
                                                                        outgoingMetrics.count
                                                                    }{' '}
                                                                    Outgoing
                                                                    Requests
                                                                </span>
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                                            <div className="Box-root Margin-right--8">
                                                                <button
                                                                    id="btnPrevSchedule"
                                                                    onClick={
                                                                        this
                                                                            .prev
                                                                    }
                                                                    className={
                                                                        'Button bs-ButtonLegacy' +
                                                                        (outgoingMetricsData.pre_page
                                                                            ? ''
                                                                            : 'Is--disabled')
                                                                    }
                                                                    disabled={
                                                                        !outgoingMetricsData.pre_page
                                                                    }
                                                                    data-db-analytics-name="list_view.pagination.previous"
                                                                    type="button"
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Previous
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                            <div className="Box-root">
                                                                <button
                                                                    id="btnNextSchedule"
                                                                    onClick={
                                                                        this
                                                                            .next
                                                                    }
                                                                    className={
                                                                        'Button bs-ButtonLegacy' +
                                                                        (outgoingMetricsData.next_page
                                                                            ? ''
                                                                            : 'Is--disabled')
                                                                    }
                                                                    disabled={
                                                                        !outgoingMetricsData.next_page
                                                                    }
                                                                    data-db-analytics-name="list_view.pagination.next"
                                                                    type="button"
                                                                >
                                                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                            <span>
                                                                                Next
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


TableComponent.displayName = 'TableComponent';


TableComponent.defaultProps = {
    title: [],
};


TableComponent.propTypes = {
    heading: PropTypes.any,
    subHeading: PropTypes.any,
    title: PropTypes.shape({
        map: PropTypes.func,
    }),
    type: PropTypes.string,
    performanceTracker: PropTypes.object,
    fetchIncomingMetrics: PropTypes.func,
    fetchOutgoingMetrics: PropTypes.func,
    setIncomingStartDate: PropTypes.func,
    setIncomingEndDate: PropTypes.func,
    setOutgoingStartDate: PropTypes.func,
    setOutgoingEndDate: PropTypes.func,
    incomingStartDate: PropTypes.string,
    incomingEndDate: PropTypes.string,
    outgoingStartDate: PropTypes.string,
    outgoingEndDate: PropTypes.string,
    incomingMetrics: PropTypes.object,
    outgoingMetrics: PropTypes.object,
    openModal: PropTypes.func,
    resetOutgoingDate: PropTypes.func,
    resetIncomingDate: PropTypes.func,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        fetchIncomingMetrics,
        fetchOutgoingMetrics,
        setIncomingStartDate,
        setIncomingEndDate,
        setOutgoingStartDate,
        setOutgoingEndDate,
        openModal,
        resetOutgoingDate,
        resetIncomingDate,
    },
    dispatch
);

const mapStateToProps = (state: RootState) => {
    return {
        currentProject: state.project.currentProject,
        incomingStartDate: state.performanceTrackerMetric.incomingStartDate,
        incomingEndDate: state.performanceTrackerMetric.incomingEndDate,
        outgoingStartDate: state.performanceTrackerMetric.outgoingStartDate,
        outgoingEndDate: state.performanceTrackerMetric.outgoingEndDate,
        incomingMetrics: state.performanceTrackerMetric.incomingMetrics,
        outgoingMetrics: state.performanceTrackerMetric.outgoingMetrics,
        performanceTracker:
            state.performanceTracker.fetchPerformanceTracker &&
            state.performanceTracker.fetchPerformanceTracker.performanceTracker,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(TableComponent);
