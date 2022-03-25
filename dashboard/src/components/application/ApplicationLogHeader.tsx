import React, { Component } from 'react';
import DataPathHoC from '../DataPathHoC';
import ViewApplicationLogKey from '../modals/ViewApplicationLogKey';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { connect } from 'react-redux';
import Select from '../../components/basic/Select';
import SearchBox from '../basic/SearchBox';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import Badge from '../common/Badge';
import { HelpIcon } from '../svg';

interface ApplicationLogHeaderProps {
    openApplicationLogKeyModalId?: string;
    applicationLog?: object;
    openModal?: Function;
    editApplicationLog?: Function;
    isDetails?: boolean;
    viewMore?: Function;
    resetApplicationLogKey?: Function;
    filter?: string;
    logOptions?: unknown[];
    currentDateRange?: object;
    logType?: object;
    handleEndDateTimeChange?: Function;
    handleStartDateTimeChange?: Function;
    handleLogFilterChange?: Function;
    handleLogTypeChange?: Function;
    formId?: string;
    setShow?: Function;
}

class ApplicationLogHeader extends Component<ApplicationLogHeaderProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            showFilters: false,
        };
    }
    override render() {
        const {

            applicationLog,

            isDetails,

            openModal,

            openApplicationLogKeyModalId,

            editApplicationLog,

            viewMore,

            resetApplicationLogKey,

            filter,

            logOptions,

            currentDateRange,

            logType,

            handleEndDateTimeChange,

            handleStartDateTimeChange,

            handleLogFilterChange,

            handleLogTypeChange,

            formId,
        } = this.props;

        return (
            <div>
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div>
                                <ShouldRender
                                    if={
                                        applicationLog &&
                                        applicationLog.resourceCategory
                                    }
                                >
                                    <div className="Box-root">
                                        <Badge
                                            color={'slate5'}
                                            id={`${applicationLog.name}Badge`}
                                        >
                                            {applicationLog &&
                                                applicationLog.resourceCategory
                                                ? applicationLog
                                                    .resourceCategory.name
                                                : ''}
                                        </Badge>
                                    </div>
                                </ShouldRender>
                            </div>
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
                                                    id={`help_${applicationLog.name}`}
                                                    className="bs-Button bs-DeprecatedButton"
                                                    type="button"

                                                    onClick={this.props.setShow}
                                                >
                                                    <span className="bs-list-flex">
                                                        <HelpIcon />
                                                        <span
                                                            style={{
                                                                marginLeft:
                                                                    '5px',
                                                            }}
                                                        >
                                                            Help
                                                        </span>
                                                    </span>
                                                </button>
                                                <button
                                                    id={`filter_${applicationLog.name}`}
                                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--filter"
                                                    type="button"
                                                    onClick={() =>
                                                        this.setState(
                                                            state => ({

                                                                showFilters: !state.showFilters,
                                                            })
                                                        )
                                                    }
                                                >
                                                    <span>

                                                        {this.state.showFilters
                                                            ? 'Hide Filters'
                                                            : 'Filter Logs'}
                                                    </span>
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
                                <DateTimeRangePicker
                                    currentDateRange={currentDateRange}
                                    handleStartDateTimeChange={
                                        handleStartDateTimeChange
                                    }
                                    handleEndDateTimeChange={
                                        handleEndDateTimeChange
                                    }
                                    formId={formId}
                                />

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
                                                fontSize: '14px',
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

function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
    const applicationLogId = ownProps.applicationLog._id;
    const currentDateRange = state.applicationLog.logs[applicationLogId]
        ? state.applicationLog.logs[applicationLogId].dateRange
        : null;
    return {
        currentProject: state.project.currentProject,
        initialValues: currentDateRange,
        currentDateRange,
    };
}

ApplicationLogHeader.propTypes = {
    openApplicationLogKeyModalId: PropTypes.string,
    applicationLog: PropTypes.object,
    openModal: PropTypes.func,
    editApplicationLog: PropTypes.func,
    isDetails: PropTypes.bool,
    viewMore: PropTypes.func,
    resetApplicationLogKey: PropTypes.func,
    filter: PropTypes.string,
    logOptions: PropTypes.array,
    currentDateRange: PropTypes.object,
    logType: PropTypes.object,
    handleEndDateTimeChange: PropTypes.func,
    handleStartDateTimeChange: PropTypes.func,
    handleLogFilterChange: PropTypes.func,
    handleLogTypeChange: PropTypes.func,
    formId: PropTypes.string,
    setShow: PropTypes.func,
};
export default connect(mapStateToProps)(ApplicationLogHeader);
