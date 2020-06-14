import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';
import LogList from './LogList';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import uuid from 'uuid';
import DataPathHoC from '../DataPathHoC';
import DeleteApplicationLog from '../modals/DeleteApplicationLog';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from 'amplitude-js';
import { bindActionCreators } from 'redux';
import { deleteApplicationLog } from '../../actions/applicationLog';
import {
    fetchLogs,
    resetApplicationLogKey,
} from '../../actions/applicationLog';
import ViewApplicationLogKey from '../modals/ViewApplicationLogKey';
import DateRangeWrapper from './DateRangeWrapper';
import TimeRangeSelector from '../basic/TimeRangeSelector';
import Select from '../../components/basic/react-select-fyipe';

class ApplicationLogDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleting: false,
            deleteModalId: uuid.v4(),
            openApplicationLogKeyModalId: uuid.v4(),
            logValue: '',
        };
    }
    onDateChange = (startDate, endDate) => {
        console.log(startDate);
        console.log(endDate);
    };
    deleteApplicationLog = () => {
        const promise = this.props.deleteApplicationLog(
            this.props.currentProject._id,
            this.props.componentId,
            this.props.applicationLog._id
        );
        history.push(
            `/dashboard/project/${this.props.currentProject._id}/${this.props.componentId}/application-log`
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > APPLICATION LOG > APPLICATION LOG DELETED',
                {
                    ProjectId: this.props.currentProject._id,
                    applicationLogId: this.props.applicationLog._id,
                }
            );
        }
        return promise;
    };
    resetApplicationLogKey = () => {
        return this.props
            .resetApplicationLogKey(
                this.props.currentProject._id,
                this.props.componentId,
                this.props.applicationLog._id
            )
            .then(() => {
                this.props.closeModal({
                    id: this.state.openApplicationLogKeyModalId,
                });
                if (SHOULD_LOG_ANALYTICS) {
                    logEvent(
                        'EVENT: DASHBOARD > COMPONENTS > APPLICATION LOG > APPLICATION LOG DETAILS > RESET APPLICATION LOG KEY',
                        {
                            applicationLogId: this.props.applicationLog._id,
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
    handleTimeChange = (startDate, endDate) => {
        const { applicationLog, fetchLogs } = this.props;
        fetchLogs(
            applicationLog._id,
            0,
            10,
            startDate.clone().utc(),
            endDate.clone().utc()
        );
    };
    handleLogTypeChange = (logType) => {
        // TODO make api request with the new logtyprr
    }
    render() {
        const {
            deleting,
            deleteModalId,
            openApplicationLogKeyModalId,
        } = this.state;
        const {
            applicationLog,
            componentId,
            currentProject,
            startDate,
            endDate,
        } = this.props;
        if (applicationLog) {
            this.props.fetchLogs(
                applicationLog._id,
                0,
                10,
                startDate.clone().utc(),
                endDate.clone().utc()
            );
        }

        if (currentProject) {
            document.title = currentProject.name + ' Dashboard';
        }
        const logOptions = [
            { value: '', label: 'All Logs' },
            { value: 'warning', label: 'Warning' },
            { value: 'info', label: 'Info' },
            { value: 'error', label: 'Error' },
        ];
        if (applicationLog) {
            return (
                <div>
                    <div
                        className="Box-root Card-shadow--medium"
                        style={{ marginTop: '10px', marginBottom: '10px' }}
                        tabIndex="0"
                    >
                        <div className="db-Trends-header">
                            <div className="db-Trends-title">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                            <span
                                                id="monitor-content-header"
                                                className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                            >
                                                <span
                                                    id={`application-log-title-${applicationLog.name}`}
                                                >
                                                    {applicationLog.name}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="db-Trends-control Flex-justifyContent--flexEnd Flex-flex">
                                            <div>
                                                {this.props.isDetails ? (
                                                    <div>
                                                        <button
                                                            id={`key_${applicationLog.name}`}
                                                            className={
                                                                'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--key'
                                                            }
                                                            type="button"
                                                            onClick={() =>
                                                                this.props.openModal(
                                                                    {
                                                                        id: openApplicationLogKeyModalId,
                                                                        onClose: () =>
                                                                            '',
                                                                        onConfirm: () =>
                                                                            this.resetApplicationLogKey(),
                                                                        content: DataPathHoC(
                                                                            ViewApplicationLogKey,
                                                                            {
                                                                                applicationLog,
                                                                            }
                                                                        ),
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            <span>
                                                                Application Log
                                                                Key
                                                            </span>
                                                        </button>
                                                        <button
                                                            id={`delete_${applicationLog.name}`}
                                                            className={
                                                                deleting
                                                                    ? 'bs-Button bs-Button--blue'
                                                                    : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete'
                                                            }
                                                            type="button"
                                                            disabled={deleting}
                                                            onClick={() =>
                                                                this.props.openModal(
                                                                    {
                                                                        id: deleteModalId,
                                                                        onClose: () =>
                                                                            '',
                                                                        onConfirm: () =>
                                                                            this.deleteApplicationLog(),
                                                                        content: DataPathHoC(
                                                                            DeleteApplicationLog,
                                                                            {
                                                                                applicationLog,
                                                                            }
                                                                        ),
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            <ShouldRender
                                                                if={!deleting}
                                                            >
                                                                <span>
                                                                    Delete
                                                                </span>
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={deleting}
                                                            >
                                                                <FormLoader />
                                                            </ShouldRender>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        id={`more-details-${applicationLog.name}`}
                                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help"
                                                        type="button"
                                                        onClick={() => {
                                                            history.push(
                                                                '/dashboard/project/' +
                                                                    currentProject._id +
                                                                    '/' +
                                                                    componentId +
                                                                    '/application-logs/' +
                                                                    applicationLog._id
                                                            );
                                                        }}
                                                    >
                                                        <span>More</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div
                        className="Box-root Card-shadow--medium"
                        style={{
                            marginTop: '10px',
                            marginBottom: '10px',
                            paddingBottom: '10px',
                        }}
                        tabIndex="0"
                    >
                        <div>
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
                                                                    Here&apos;s
                                                                    a list of
                                                                    recent logs
                                                                    which belong
                                                                    to this
                                                                    application
                                                                    log.
                                                                </span>
                                                            </span>
                                                        </div>

                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div></div>
                                                        </div>
                                                    </div>
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween Padding-top--8">
                                                        <div className="db-Trends-timeControls">
                                                            <DateRangeWrapper
                                                                selected={
                                                                    this.props
                                                                        .startDate
                                                                }
                                                                dateRange={30}
                                                                onChange={
                                                                    this
                                                                        .onDateChange
                                                                }
                                                            />
                                                        </div>

                                                        <div className="db-Trends-timeControls">
                                                            <TimeRangeSelector
                                                                name1="startTime"
                                                                name2="endTime"
                                                                onChange={
                                                                    this
                                                                        .handleTimeChange
                                                                }
                                                            />
                                                        </div>

                                                        <div
                                                            style={{
                                                                height: '28px',
                                                                width: '250px',
                                                            }}
                                                        >
                                                            <Select
                                                                name="probe_selector"
                                                                value={
                                                                    this.state
                                                                        .logValue
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
                                                                        this
                                                                            .props
                                                                            .applicationLog &&
                                                                        !this
                                                                            .props
                                                                            .applicationLog
                                                                            .requesting
                                                                    )
                                                                }
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                }}
                                                                options={
                                                                    logOptions
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <LogList
                                                    applicationLog={
                                                        applicationLog
                                                    }
                                                    componentId={componentId}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
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
        },
        dispatch
    );
};
function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
        startDate: state.dateTime.dates.startDate,
        endDate: state.dateTime.dates.endDate,
    };
}

ApplicationLogDetail.propTypes = {
    componentId: PropTypes.string,
    applicationLog: PropTypes.object,
    currentProject: PropTypes.object,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ApplicationLogDetail);
