import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';

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
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            deleting: false,
            deleteModalId: uuidv4(),
            openApplicationLogKeyModalId: uuidv4(),
            filter: '',
            // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
            currentDate: moment(),
            logType: { value: '', label: 'All Logs' },
        };
    }
    deleteApplicationLog = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteApplicationLog' does not exist on ... Remove this comment to see the full error message
        const promise = this.props.deleteApplicationLog(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'index' does not exist on type 'Readonly<... Remove this comment to see the full error message
            this.props.index
        );
        history.push(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/application-log`
        );

        return promise;
    };
    resetApplicationLogKey = () => {
        return this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetApplicationLogKey' does not exist o... Remove this comment to see the full error message
            .resetApplicationLogKey(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'index' does not exist on type 'Readonly<... Remove this comment to see the full error message
                this.props.index
            )
            .then(() => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openApplicationLogKeyModalId' does not e... Remove this comment to see the full error message
                    id: this.state.openApplicationLogKeyModalId,
                });
            });
    };
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };
    editApplicationLog = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
        const { applicationLog } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editApplicationLogSwitch' does not exist... Remove this comment to see the full error message
        this.props.editApplicationLogSwitch(applicationLog._id);
    };
    viewMore = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, componentSlug, applicationLog } = this.props;
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                componentSlug +
                '/application-logs/' +
                applicationLog.slug
        );
    };
    handleStartDateTimeChange = (val: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
        const startDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.fetchByDateChange(startDate, this.props.endDate);
    };
    handleEndDateTimeChange = (val: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
        const endDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
        this.fetchByDateChange(this.props.startDate, endDate);
    };
    fetchByDateChange = (startDate: $TSFixMe, endDate: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLogs' does not exist on type 'Reado... Remove this comment to see the full error message
            fetchLogs,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'filter' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { filter, logType } = this.state;
        // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
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
    handleLogTypeChange = (logType: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLogs' does not exist on type 'Reado... Remove this comment to see the full error message
            fetchLogs,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDetails' does not exist on type 'Reado... Remove this comment to see the full error message
            isDetails,
        } = this.props;
        // check if it is the details page before actioning
        if (!isDetails) {
            return;
        }
        this.setState({ logType });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'filter' does not exist on type 'Readonly... Remove this comment to see the full error message
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
    handleLogFilterChange = (filter: $TSFixMe) => {
        this.setState({ filter });
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLogs' does not exist on type 'Reado... Remove this comment to see the full error message
            fetchLogs,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'logType' does not exist on type 'Readonl... Remove this comment to see the full error message
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
    handleNavigationButtonClick = (skip: $TSFixMe, limit: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLogs' does not exist on type 'Reado... Remove this comment to see the full error message
            fetchLogs,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'logType' does not exist on type 'Readonl... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchStats' does not exist on type 'Read... Remove this comment to see the full error message
            fetchStats,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleting' does not exist on type 'Readon... Remove this comment to see the full error message
            deleting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteModalId' does not exist on type 'R... Remove this comment to see the full error message
            deleteModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openApplicationLogKeyModalId' does not e... Remove this comment to see the full error message
            openApplicationLogKeyModalId,
        } = this.state;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDetails' does not exist on type 'Reado... Remove this comment to see the full error message
            isDetails,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'stats' does not exist on type 'Readonly<... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                        tabIndex="0"
                    >
                        <ShouldRender if={!applicationLog.editMode}>
                            <ApplicationLogHeader
                                applicationLog={applicationLog}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDetails' does not exist on type 'Reado... Remove this comment to see the full error message
                                isDetails={this.props.isDetails}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'setShow' does not exist on type 'Readonl... Remove this comment to see the full error message
                                setShow={this.props.setShow}
                            />
                        </ShouldRender>
                        <ShouldRender if={applicationLog.editMode}>
                            <NewApplicationLog
                                edit={applicationLog.editMode}
                                applicationLog={applicationLog}
                                index={applicationLog._id}
                                componentId={componentId}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                                componentSlug={this.props.componentSlug}
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
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ApplicationLogDetail.displayName = 'ApplicationLogDetail';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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
function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
    const applicationLogId = ownProps.index;
    const applicationLogs =
        state.applicationLog.applicationLogsList.applicationLogs;
    const applicationLogFromRedux = applicationLogs.filter(
        (applicationLog: $TSFixMe) => applicationLog._id === applicationLogId
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ApplicationLogDetail.propTypes = {
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
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
    setShow: PropTypes.func,
};
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationLogDetail);
