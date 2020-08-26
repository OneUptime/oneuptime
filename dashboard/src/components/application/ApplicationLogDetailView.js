import React, { Component } from 'react';
import LogList from './LogList';
import Select from '../../components/basic/react-select-fyipe';
import PropTypes from 'prop-types';
import SearchBox from '../basic/SearchBox';
import ShouldRender from '../basic/ShouldRender';
import DateTimeSelector from '../basic/DateTimeSelector';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import * as moment from 'moment';
import { fetchLogs } from '../../actions/applicationLog';
import { ListLoader } from '../basic/Loader';
import AlertPanel from '../basic/AlertPanel';

class ApplicationLogDetailView extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            filter: '',
            currentDate: moment(),
            logType: { value: '', label: 'All Logs' },
        };
    }

    componentDidMount() {
        const {
            fetchLogs,
            projectId,
            componentId,
            applicationLog,
        } = this.props;
        fetchLogs(projectId, componentId, applicationLog._id, 0, 10);
    }
    handleEndDateTimeChange = val => {
        const {
            applicationLog,
            projectId,
            componentId,
            startDate,
            fetchLogs,
        } = this.props;
        const { filter, logType } = this.state;
        let endDate = '';
        let i = 0;
        while (i < 29) {
            endDate += val[i];
            i += 1;
        }
        endDate = moment(endDate);
        if (moment(startDate).isBefore(endDate)) {
            fetchLogs(
                projectId,
                componentId,
                applicationLog._id,
                0,
                10,
                startDate,
                endDate,
                logType.value,
                filter
            );
        }
    };
    handleLogTypeChange = logType => {
        const {
            applicationLog,
            projectId,
            componentId,
            startDate,
            endDate,
            fetchLogs,
            isDetails,
        } = this.props;
        // check if it is the details page before actioning
        if (!isDetails) {
            return;
        }
        this.setState({ logType });
        const { filter } = this.state;
        fetchLogs(
            projectId,
            componentId,
            applicationLog._id,
            0,
            10,
            startDate,
            endDate,
            logType.value,
            filter
        );
    };
    handleLogFilterChange = filter => {
        this.setState({ filter });
        const {
            applicationLog,
            projectId,
            componentId,
            startDate,
            endDate,
            fetchLogs,
        } = this.props;
        const { logType } = this.state;
        fetchLogs(
            projectId,
            componentId,
            applicationLog._id,
            0,
            10,
            startDate,
            endDate,
            logType.value,
            filter
        );
    };
    handleNavigationButtonClick = (skip, limit) => {
        const {
            applicationLog,
            projectId,
            componentId,
            startDate,
            endDate,
            fetchLogs,
        } = this.props;
        const { logType, filter } = this.state;
        fetchLogs(
            projectId,
            componentId,
            applicationLog._id,
            skip,
            limit,
            startDate,
            endDate,
            logType.value,
            filter
        );
    };
    render() {
        const {
            applicationLog,
            componentId,
            projectId,
            filter,
            isDetails,
            stats,
            logs,
        } = this.props;
        const logOptions = [
            { value: '', label: 'All Logs' },
            { value: 'error', label: 'Error' },
            { value: 'warning', label: 'Warning' },
            { value: 'info', label: 'Info' },
        ];
        return (
            <div>
                <ShouldRender if={!(logs && logs.length > 0)}>
                    <AlertPanel
                        id={`${applicationLog.name}-no-log-warning`}
                        message={
                            <span>
                                This Log Container is currently not receiving
                                any logs, Click{' '}
                                <a
                                    rel="noopener noreferrer"
                                    href="https://github.com/Fyipe/feature-docs/blob/master/log.md"
                                    target="_blank"
                                    style={{
                                        color: 'white',
                                        textDecoration: 'underline',
                                    }}
                                >
                                    {' '}
                                    here
                                </a>{' '}
                                to setup it up and start collecting logs.
                            </span>
                        }
                    />
                </ShouldRender>
                <ShouldRender if={!stats || stats.requesting}>
                    <ListLoader />
                </ShouldRender>
                <ShouldRender if={stats && !stats.requesting}>
                    <div
                        className="db-TrendRow db-ListViewItem-header db-Trends-header"
                        style={{ cursor: isDetails ? 'pointer' : 'none' }}
                    >
                        <div
                            onClick={() =>
                                this.handleLogTypeChange(logOptions[0])
                            }
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-all`}
                        >
                            <div className="db-Trend-rowTitle" title="All Logs">
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">All Logs</span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.all
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div
                            onClick={() =>
                                this.handleLogTypeChange(logOptions[1])
                            }
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-error`}
                        >
                            <div
                                className="db-Trend-rowTitle"
                                title="Error Logs"
                            >
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">
                                        Error Logs
                                    </span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.error
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div
                            onClick={() =>
                                this.handleLogTypeChange(logOptions[2])
                            }
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-warning`}
                        >
                            <div
                                className="db-Trend-rowTitle"
                                title="Warning Logs"
                            >
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">
                                        Warning Logs
                                    </span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.warning
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div
                            onClick={() =>
                                this.handleLogTypeChange(logOptions[3])
                            }
                            className="db-Trend-colInformation"
                            id={`${applicationLog.name}-info`}
                        >
                            <div
                                className="db-Trend-rowTitle"
                                title="Info Logs"
                            >
                                <div className="db-Trend-title Flex-flex Flex-justifyContent--center">
                                    <span className="chart-font">
                                        Info Logs
                                    </span>
                                </div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue Flex-flex Flex-justifyContent--center">
                                    <span>
                                        {' '}
                                        <span className="chart-font">
                                            {stats && stats.stats
                                                ? stats.stats.info
                                                : 0}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="">
                            <div className="Box-root">
                                <div>
                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span>
                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>
                                                        Here&apos;s a list of
                                                        recent logs which belong
                                                        to this log container.
                                                    </span>
                                                </span>
                                            </div>

                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                <div></div>
                                            </div>
                                        </div>
                                        <ShouldRender if={isDetails}>
                                            <div className="db-Trends-controls">
                                                <form
                                                    id="applicationLogDateTimeForm"
                                                    className="Flex-flex action-bar-holder Padding-all--4"
                                                >
                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .currentDateRange
                                                        }
                                                    >
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                margin: '5px',
                                                            }}
                                                        >
                                                            <Field
                                                                className="bs-TextInput"
                                                                type="text"
                                                                id="startDate"
                                                                name="startDate"
                                                                component={
                                                                    DateTimeSelector
                                                                }
                                                                placeholder="10pm"
                                                                style={{
                                                                    width:
                                                                        '250px',
                                                                    marginTop:
                                                                        '0px',
                                                                }}
                                                                maxDate={
                                                                    this.state
                                                                        .currentDate
                                                                }
                                                            />
                                                        </div>
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                marginTop:
                                                                    '0px',
                                                                margin: '5px',
                                                            }}
                                                        >
                                                            <Field
                                                                className="bs-TextInput"
                                                                type="text"
                                                                id="endDate"
                                                                name="endDate"
                                                                value={
                                                                    this.props
                                                                        .currentDateRange
                                                                        ? this
                                                                              .props
                                                                              .currentDateRange
                                                                              .endDate
                                                                        : null
                                                                }
                                                                component={
                                                                    DateTimeSelector
                                                                }
                                                                placeholder="10pm"
                                                                style={{
                                                                    width:
                                                                        '250px',
                                                                    marginTop:
                                                                        '0px',
                                                                }}
                                                                onChange={
                                                                    this
                                                                        .handleEndDateTimeChange
                                                                }
                                                                maxDate={
                                                                    this.state
                                                                        .currentDate
                                                                }
                                                            />
                                                        </div>
                                                    </ShouldRender>
                                                </form>
                                                <div className="Flex-flex action-bar-holder Padding-all--4">
                                                    <div
                                                        style={{
                                                            height: '28px',
                                                            margin: '5px',
                                                        }}
                                                    >
                                                        <SearchBox
                                                            name="log_filter"
                                                            value={filter}
                                                            onChange={
                                                                this
                                                                    .handleLogFilterChange
                                                            }
                                                            placeholder="Filter logs by ..."
                                                            className="db-select-pr"
                                                            id="log_filter_selector"
                                                            isDisabled={
                                                                !(
                                                                    applicationLog &&
                                                                    !applicationLog.requesting
                                                                )
                                                            }
                                                            style={{
                                                                height: '33px',
                                                                padding: '5px',
                                                                width: '250px',
                                                                border:
                                                                    '#CCCCCC 1px solid',
                                                                borderRadius:
                                                                    '5px',
                                                            }}
                                                        />
                                                    </div>

                                                    <div
                                                        style={{
                                                            height: '33px',
                                                            margin: '5px',
                                                        }}
                                                    >
                                                        <Select
                                                            name="log_type_selector"
                                                            value={
                                                                this.state
                                                                    .logType
                                                            }
                                                            onChange={
                                                                this
                                                                    .handleLogTypeChange
                                                            }
                                                            placeholder="Log Type"
                                                            className="db-select-pr"
                                                            id="log_type_selector"
                                                            isDisabled={
                                                                !(
                                                                    applicationLog &&
                                                                    !applicationLog.requesting
                                                                )
                                                            }
                                                            style={{
                                                                height: '33px',
                                                            }}
                                                            options={logOptions}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <LogList
                                        applicationLog={applicationLog}
                                        componentId={componentId}
                                        projectId={projectId}
                                        handleNavigationButtonClick={
                                            this.handleNavigationButtonClick
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
ApplicationLogDetailView.displayName = 'ApplicationLogDetailView';

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ fetchLogs }, dispatch);
};

const selector = formValueSelector('applicationLogDateTimeForm');

function mapStateToProps(state, ownProps) {
    const applicationLogId = ownProps.applicationLog._id;
    const currentDateRange = state.applicationLog.logs[applicationLogId]
        ? state.applicationLog.logs[applicationLogId].dateRange
        : null;
    const logs = state.applicationLog.logs[applicationLogId]
        ? state.applicationLog.logs[applicationLogId].logs
        : null;
    const startDate = selector(state, 'startDate');
    const endDate = selector(state, 'endDate');
    return {
        initialValues: currentDateRange,
        currentDateRange,
        startDate,
        endDate,
        logs,
    };
}

ApplicationLogDetailView.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    applicationLog: PropTypes.object,
    filter: PropTypes.object,
    isDetails: PropTypes.bool,
    currentDateRange: PropTypes.object,
    fetchLogs: PropTypes.func,
    startDate: PropTypes.string,
    endDate: PropTypes.string,
    stats: PropTypes.object,
    logs: PropTypes.object,
};
const ApplicationLogDateForm = reduxForm({
    form: 'applicationLogDateTimeForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(ApplicationLogDetailView);
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationLogDateForm);
