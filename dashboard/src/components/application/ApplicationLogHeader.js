import React, { Component } from 'react';
import DataPathHoC from '../DataPathHoC';
import ViewApplicationLogKey from '../modals/ViewApplicationLogKey';
import DeleteApplicationLog from '../modals/DeleteApplicationLog';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import Select from '../../components/basic/react-select-fyipe';
import SearchBox from '../basic/SearchBox';
import DateTimeSelector from '../basic/DateTimeSelector';
import * as moment from 'moment';

class ApplicationLogHeader extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            showFilters: false,
        };
    }
    render() {
        const {
            applicationLog,
            isDetails,
            openModal,
            openApplicationLogKeyModalId,
            editApplicationLog,
            deleteModalId,
            deleteApplicationLog,
            deleting,
            viewMore,
            resetApplicationLogKey,
            filter,
            logOptions,
            currentDateRange,
            logType,
            handleEndDateTimeChange,
            handleLogFilterChange,
            handleLogTypeChange,
        } = this.props;
        const currentDate = moment();

        return (
            <div>
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span
                                        id="application-content-header"
                                        className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
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
                                        {isDetails ? (
                                            <div>
                                                <button
                                                    id={`filter_${applicationLog.name}`}
                                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings"
                                                    type="button"
                                                    onClick={() =>
                                                        this.setState(
                                                            state => ({
                                                                showFilters: !state.showFilters,
                                                            })
                                                        )
                                                    }
                                                >
                                                    <span>Filter Logs</span>
                                                </button>
                                                <button
                                                    id={`key_${applicationLog.name}`}
                                                    className={
                                                        'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--key'
                                                    }
                                                    type="button"
                                                    onClick={() =>
                                                        openModal({
                                                            id: openApplicationLogKeyModalId,
                                                            onClose: () => '',
                                                            onConfirm: () =>
                                                                resetApplicationLogKey(),
                                                            content: DataPathHoC(
                                                                ViewApplicationLogKey,
                                                                {
                                                                    applicationLog,
                                                                }
                                                            ),
                                                        })
                                                    }
                                                >
                                                    <span>Log API Key</span>
                                                </button>
                                                <button
                                                    id={`edit_${applicationLog.name}`}
                                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings"
                                                    type="button"
                                                    onClick={editApplicationLog}
                                                >
                                                    <span>Edit</span>
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
                                                        openModal({
                                                            id: deleteModalId,
                                                            onClose: () => '',
                                                            onConfirm: () =>
                                                                deleteApplicationLog(),
                                                            content: DataPathHoC(
                                                                DeleteApplicationLog,
                                                                {
                                                                    applicationLog,
                                                                }
                                                            ),
                                                        })
                                                    }
                                                >
                                                    <ShouldRender
                                                        if={!deleting}
                                                    >
                                                        <span>Delete</span>
                                                    </ShouldRender>
                                                    <ShouldRender if={deleting}>
                                                        <FormLoader />
                                                    </ShouldRender>
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                id={`more-details-${applicationLog.name}`}
                                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--more"
                                                type="button"
                                                onClick={viewMore}
                                            >
                                                <span>More</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <ShouldRender if={isDetails}>
                            <div
                                className="db-Trends-controls Margin-top--12"
                                style={{
                                    display: this.state.showFilters
                                        ? 'flex'
                                        : 'none',
                                }}
                            >
                                <form id="applicationLogDateTimeForm">
                                    <ShouldRender if={currentDateRange}>
                                        <div className="db-DateRangeInputWithComparison">
                                            <div
                                                className="db-DateRangeInput bs-Control"
                                                style={{
                                                    cursor: 'pointer',
                                                    height: '35px',
                                                }}
                                                onClick={this.onToggle}
                                            >
                                                <div
                                                    className="db-DateRangeInput-input"
                                                    role="button"
                                                    tabIndex="0"
                                                    style={{
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <span
                                                        className="db-DateRangeInput-start"
                                                        style={{
                                                            padding: '3px',
                                                        }}
                                                    >
                                                        <Field
                                                            type="text"
                                                            name="startDate"
                                                            component={
                                                                DateTimeSelector
                                                            }
                                                            id="startDate"
                                                            style={{
                                                                marginTop:
                                                                    '0px',
                                                                width: '180px',
                                                            }}
                                                            maxDate={
                                                                currentDate
                                                            }
                                                        />
                                                    </span>
                                                    <span
                                                        className="db-DateRangeInput-input-arrow"
                                                        style={{
                                                            padding: '3px',
                                                        }}
                                                    />
                                                    <span
                                                        className="db-DateRangeInput-end"
                                                        style={{
                                                            padding: '3px',
                                                        }}
                                                    >
                                                        <Field
                                                            type="text"
                                                            name="endDate"
                                                            component={
                                                                DateTimeSelector
                                                            }
                                                            id="endDate"
                                                            style={{
                                                                marginTop:
                                                                    '0px',
                                                                width: '180px',
                                                            }}
                                                            maxDate={
                                                                currentDate
                                                            }
                                                            onChange={
                                                                handleEndDateTimeChange
                                                            }
                                                        />
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </form>

                                <div className="Flex-flex action-bar-holder ">
                                    <div
                                        style={{
                                            height: '28px',
                                            margin: '5px 0px',
                                            marginRight: '5px',
                                        }}
                                    >
                                        <SearchBox
                                            name="log_filter"
                                            value={filter}
                                            onChange={handleLogFilterChange}
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
                                                border: '#CCCCCC 1px solid',
                                                borderRadius: '5px',
                                            }}
                                        />
                                    </div>

                                    <div
                                        style={{
                                            height: '33px',
                                            margin: '5px 0px',
                                        }}
                                    >
                                        <Select
                                            name="log_type_selector"
                                            value={logType}
                                            onChange={handleLogTypeChange}
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
                </div>
            </div>
        );
    }
}

ApplicationLogHeader.displayName = 'ApplicationLogHeader';

const selector = formValueSelector('applicationLogDateTimeForm');
function mapStateToProps(state, ownProps) {
    const applicationLogId = ownProps.applicationLog._id;
    const currentDateRange = state.applicationLog.logs[applicationLogId]
        ? state.applicationLog.logs[applicationLogId].dateRange
        : null;
    const startDate = selector(state, 'startDate');
    const endDate = selector(state, 'endDate');
    return {
        currentProject: state.project.currentProject,
        initialValues: currentDateRange,
        currentDateRange,
        startDate,
        endDate,
    };
}
ApplicationLogHeader.propTypes = {
    openApplicationLogKeyModalId: PropTypes.string,
    applicationLog: PropTypes.object,
    openModal: PropTypes.func,
    editApplicationLog: PropTypes.func,
    deleteApplicationLog: PropTypes.func,
    isDetails: PropTypes.bool,
    deleteModalId: PropTypes.string,
    deleting: PropTypes.bool,
    viewMore: PropTypes.func,
    resetApplicationLogKey: PropTypes.func,
    filter: PropTypes.string,
    logOptions: PropTypes.array,
    currentDateRange: PropTypes.object,
    logType: PropTypes.object,
    handleEndDateTimeChange: PropTypes.func,
    handleLogFilterChange: PropTypes.func,
    handleLogTypeChange: PropTypes.func,
};
const ApplicationLogDateForm = reduxForm({
    form: 'applicationLogDateTimeForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(ApplicationLogHeader);
export default connect(mapStateToProps)(ApplicationLogDateForm);
