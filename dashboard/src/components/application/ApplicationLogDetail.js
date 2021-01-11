import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import uuid from 'uuid';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from 'amplitude-js';
import { bindActionCreators } from 'redux';
import { deleteApplicationLog } from '../../actions/applicationLog';
import {
    fetchLogs,
    resetApplicationLogKey,
    editApplicationLogSwitch,
    fetchStats,
} from '../../actions/applicationLog';
import { setStartDate, setEndDate } from '../../actions/dateTime';
import ApplicationLogDetailView from './ApplicationLogDetailView';
import ApplicationLogHeader from './ApplicationLogHeader';
import NewApplicationLog from './NewApplicationLog';
import * as moment from 'moment';

class ApplicationLogDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleting: false,
            deleteModalId: uuid.v4(),
            openApplicationLogKeyModalId: uuid.v4(),
            filter: '',
            currentDate: moment(),
            logType: { value: '', label: 'All Logs' },
        };
    }
    deleteApplicationLog = () => {
        const promise = this.props.deleteApplicationLog(
            this.props.currentProject._id,
            this.props.componentId,
            this.props.index
        );
        history.push(
            `/dashboard/project/${this.props.currentProject._id}/${this.props.componentId}/application-log`
        );
        // crashing the application
        // if (SHOULD_LOG_ANALYTICS) {
        //     logEvent(
        //         'EVENT: DASHBOARD > PROJECT > COMPONENT > LOG CONTAINER > LOG CONTAINER DELETED',
        //         {
        //             ProjectId: this.props.currentProject._id,
        //             applicationLogId: this.props.index,
        //         }
        //     );
        // }
        return promise;
    };
    resetApplicationLogKey = () => {
        return this.props
            .resetApplicationLogKey(
                this.props.currentProject._id,
                this.props.componentId,
                this.props.index
            )
            .then(() => {
                this.props.closeModal({
                    id: this.state.openApplicationLogKeyModalId,
                });
                if (SHOULD_LOG_ANALYTICS) {
                    logEvent(
                        'EVENT: DASHBOARD > COMPONENTS > LOG CONTAINER > LOG CONTAINER DETAILS > RESET LOG CONTAINER KEY',
                        {
                            applicationLogId: this.props.index,
                        }
                    );
                }
            });
    };
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };
    editApplicationLog = () => {
        const { applicationLog } = this.props;
        this.props.editApplicationLogSwitch(applicationLog._id);
        // This is crashing
        // if (SHOULD_LOG_ANALYTICS) {
        //     logEvent(
        //         'EVENT: DASHBOARD > PROJECT > COMPONENT > LOG CONTAINER > EDIT LOG CONTAINER CLICKED',
        //         {}
        //     );
        // }
    };
    viewMore = () => {
        const { currentProject, componentId, applicationLog } = this.props;
        history.push(
            '/dashboard/project/' +
                currentProject._id +
                '/' +
                componentId +
                '/application-logs/' +
                applicationLog._id
        );
    };
    handleStartDateTimeChange = val => {
        const startDate = moment(val);
        this.fetchByDateChange(startDate, this.props.endDate);
    };
    handleEndDateTimeChange = val => {
        const endDate = moment(val);
        this.fetchByDateChange(this.props.startDate, endDate);
    };
    fetchByDateChange = (startDate, endDate) => {
        const {
            applicationLog,
            currentProject,
            componentId,
            fetchLogs,
        } = this.props;
        const { filter, logType } = this.state;
        if (moment(startDate).isBefore(endDate)) {
            fetchLogs(
                currentProject._id,
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
            currentProject,
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
            currentProject._id,
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
            currentProject,
            componentId,
            startDate,
            endDate,
            fetchLogs,
        } = this.props;
        const { logType } = this.state;
        fetchLogs(
            currentProject._id,
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
            currentProject,
            componentId,
            startDate,
            endDate,
            fetchLogs,
        } = this.props;
        const { logType, filter } = this.state;
        fetchLogs(
            currentProject._id,
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
    componentDidMount() {
        const {
            fetchStats,
            currentProject,
            applicationLog,
            componentId,
        } = this.props;
        fetchStats(currentProject._id, componentId, applicationLog._id);
    }
    render() {
        const logOptions = [
            { value: '', label: 'All Logs' },
            { value: 'error', label: 'Error' },
            { value: 'warning', label: 'Warning' },
            { value: 'info', label: 'Info' },
        ];
        const {
            deleting,
            deleteModalId,
            openApplicationLogKeyModalId,
        } = this.state;
        const {
            applicationLog,
            componentId,
            currentProject,
            isDetails,
            stats,
        } = this.props;

        if (currentProject) {
            document.title = currentProject.name + ' Dashboard';
        }
        if (applicationLog) {
            return (
                <div>
                    <div
                        className="Box-root Card-shadow--medium"
                        style={{ marginTop: '10px', marginBottom: '10px' }}
                        tabIndex="0"
                    >
                        <ShouldRender if={!applicationLog.editMode}>
                            <ApplicationLogHeader
                                applicationLog={applicationLog}
                                isDetails={this.props.isDetails}
                                openModal={this.props.openModal}
                                openApplicationLogKeyModalId={
                                    openApplicationLogKeyModalId
                                }
                                editApplicationLog={this.editApplicationLog}
                                deleteModalId={deleteModalId}
                                deleteApplicationLog={this.deleteApplicationLog}
                                deleting={deleting}
                                viewMore={this.viewMore}
                                resetApplicationLogKey={
                                    this.resetApplicationLogKey
                                }
                                {...this.state}
                                logOptions={logOptions}
                                handleEndDateTimeChange={
                                    this.handleEndDateTimeChange
                                }
                                handleStartDateTimeChange={
                                    this.handleStartDateTimeChange
                                }
                                handleLogFilterChange={
                                    this.handleLogFilterChange
                                }
                                handleLogTypeChange={this.handleLogTypeChange}
                                formId="applicationLogDateTimeForm"
                            />
                        </ShouldRender>
                        <ShouldRender if={applicationLog.editMode}>
                            <NewApplicationLog
                                edit={applicationLog.editMode}
                                applicationLog={applicationLog}
                                index={applicationLog._id}
                                componentId={componentId}
                            />
                        </ShouldRender>

                        {applicationLog && (
                            <ApplicationLogDetailView
                                applicationLog={applicationLog}
                                componentId={componentId}
                                projectId={currentProject._id}
                                isDetails={isDetails}
                                stats={stats}
                                logOptions={logOptions}
                                handleLogTypeChange={this.handleLogTypeChange}
                                handleNavigationButtonClick={
                                    this.handleNavigationButtonClick
                                }
                            />
                        )}
                    </div>
                </div>
            );
        } else {
            return null;
        }
    }
}
ApplicationLogDetail.displayName = 'ApplicationLogDetail';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            openModal,
            closeModal,
            deleteApplicationLog,
            fetchLogs,
            resetApplicationLogKey,
            setStartDate,
            setEndDate,
            editApplicationLogSwitch,
            fetchStats,
        },
        dispatch
    );
};
function mapStateToProps(state, ownProps) {
    const applicationLogId = ownProps.index;
    const applicationLogs =
        state.applicationLog.applicationLogsList.applicationLogs;
    const applicationLogFromRedux = applicationLogs.filter(
        applicationLog => applicationLog._id === applicationLogId
    );
    const stats = state.applicationLog.stats[applicationLogId];
    const currentDateRange = state.applicationLog.logs[applicationLogId]
        ? state.applicationLog.logs[applicationLogId].dateRange
        : null;
    const startDate = state.form.applicationLogDateTimeForm
        ? state.form.applicationLogDateTimeForm.values
            ? state.form.applicationLogDateTimeForm.values.startDate
            : ''
        : '';
    const endDate = state.form.applicationLogDateTimeForm
        ? state.form.applicationLogDateTimeForm.values
            ? state.form.applicationLogDateTimeForm.values.endDate
            : ''
        : '';
    return {
        currentProject: state.project.currentProject,
        applicationLog: applicationLogFromRedux[0],
        editMode: applicationLogFromRedux[0].editMode,
        stats,
        initialValues: currentDateRange,
        currentDateRange,
        startDate,
        endDate,
    };
}

ApplicationLogDetail.propTypes = {
    componentId: PropTypes.string,
    index: PropTypes.string,
    applicationLog: PropTypes.object,
    currentProject: PropTypes.object,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    resetApplicationLogKey: PropTypes.func,
    deleteApplicationLog: PropTypes.func,
    isDetails: PropTypes.bool,
    editApplicationLogSwitch: PropTypes.func,
    fetchStats: PropTypes.func,
    stats: PropTypes.object,
    fetchLogs: PropTypes.func,
    startDate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    endDate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
};
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationLogDetail);
