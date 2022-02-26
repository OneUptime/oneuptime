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

class ApplicationLogHeader extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            showFilters: false,
        };
    }
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLog' does not exist on type '... Remove this comment to see the full error message
            applicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDetails' does not exist on type 'Reado... Remove this comment to see the full error message
            isDetails,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openApplicationLogKeyModalId' does not e... Remove this comment to see the full error message
            openApplicationLogKeyModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editApplicationLog' does not exist on ty... Remove this comment to see the full error message
            editApplicationLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'viewMore' does not exist on type 'Readon... Remove this comment to see the full error message
            viewMore,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetApplicationLogKey' does not exist o... Remove this comment to see the full error message
            resetApplicationLogKey,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filter' does not exist on type 'Readonly... Remove this comment to see the full error message
            filter,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logOptions' does not exist on type 'Read... Remove this comment to see the full error message
            logOptions,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentDateRange' does not exist on type... Remove this comment to see the full error message
            currentDateRange,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'logType' does not exist on type 'Readonl... Remove this comment to see the full error message
            logType,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleEndDateTimeChange' does not exist ... Remove this comment to see the full error message
            handleEndDateTimeChange,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleStartDateTimeChange' does not exis... Remove this comment to see the full error message
            handleStartDateTimeChange,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleLogFilterChange' does not exist on... Remove this comment to see the full error message
            handleLogFilterChange,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleLogTypeChange' does not exist on t... Remove this comment to see the full error message
            handleLogTypeChange,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formId' does not exist on type 'Readonly... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setShow' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'showFilters' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                showFilters: !state.showFilters,
                                                            })
                                                        )
                                                    }
                                                >
                                                    <span>
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showFilters' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'showFilters' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: string; value: any; onChange: any; p... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: string; value: any; onChange: any; p... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
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
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
