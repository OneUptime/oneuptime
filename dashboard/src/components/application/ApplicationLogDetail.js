import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { history } from '../../store';
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
import { setStartDate, setEndDate } from '../../actions/dateTime';
import ViewApplicationLogKey from '../modals/ViewApplicationLogKey';
import ApplicationLogDetailView from './ApplicationLogDetailView';
import * as moment from 'moment';

class ApplicationLogDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleting: false,
            deleteModalId: uuid.v4(),
            openApplicationLogKeyModalId: uuid.v4(),
            logType: { value: '', label: 'All Logs' },
            startDate: props.startDate,
            endDate: props.endDate,
            filters: [],
            filter: {}
        };
    }
    handleDateTimeChange = value => {
        let startDate = value.startDate;
        let endDate = value.endDate;
        if (startDate && endDate) {
            startDate = moment(startDate);
            endDate = moment(endDate);
            this.setState(state => ({
                startDate,
                endDate,
            }));
            this.props.setStartDate(startDate);
            this.props.setEndDate(endDate);
        }
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
    handleLogTypeChange = logType => {
        this.setState(() => ({
            logType: logType,
        }));
    };
    handleLogFilterChange = filter => {
        if(!filter) return ;
        let filters = this.state.filters;
        const exist = filters.filter(elem => elem.value === filter.value);
        if(exist.length < 1) {
            filters = [...this.state.filters, filter]
        }
        this.setState(()=>({
            filters,
            filter
        }));
    };
    render() {
        const {
            deleting,
            deleteModalId,
            openApplicationLogKeyModalId,
            startDate,
            endDate,
            logType,
            filters,
            filter
        } = this.state;
        const {
            applicationLog,
            componentId,
            currentProject,
            fetchLogs,
        } = this.props;
        if (applicationLog) {
            fetchLogs(
                currentProject._id,
                componentId,
                applicationLog._id,
                0,
                10,
                startDate.clone().utc(),
                endDate.clone().utc(),
                logType.value,
                filter.value
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
                                                id="application-content-header"
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
                        <ShouldRender if={!this.props.isDetails}>
                            <ApplicationLogDetailView
                                startDate={this.state.startDate}
                                logValue={this.state.logType}
                                filter={this.state.filter}
                                filters={filters}
                                applicationLog={applicationLog}
                                logOptions={logOptions}
                                componentId={componentId}
                                handleDateTimeChange={this.handleDateTimeChange}
                                handleLogTypeChange={this.handleLogTypeChange}
                                handleLogFilterChange={this.handleLogFilterChange}
                                handleNewDateTimeChange={
                                    this.handleNewDateTimeChange
                                }
                            />
                        </ShouldRender>
                    </div>
                    <ShouldRender if={this.props.isDetails}>
                        <div
                            className="Box-root Card-shadow--medium"
                            style={{
                                marginTop: '10px',
                                marginBottom: '10px',
                                paddingBottom: '10px',
                            }}
                            tabIndex="0"
                        >
                            <ApplicationLogDetailView
                                startDate={this.state.startDate}
                                logValue={this.state.logType}
                                filter={this.state.filter}
                                filters={filters}
                                applicationLog={applicationLog}
                                logOptions={logOptions}
                                componentId={componentId}
                                handleDateTimeChange={this.handleDateTimeChange}
                                handleLogTypeChange={this.handleLogTypeChange}
                                handleLogFilterChange={this.handleLogFilterChange}
                            />
                        </div>
                    </ShouldRender>
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
