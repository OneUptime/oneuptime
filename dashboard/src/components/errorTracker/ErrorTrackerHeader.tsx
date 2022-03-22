import React, { Component } from 'react';
import Select from '../../components/basic/Select';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
import DeleteErrorTracker from '../modals/DeleteErrorTracker';
import { connect } from 'react-redux';
import ViewErrorTrackerKey from '../modals/ViewErrorTrackerKey';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import Badge from '../common/Badge';

class ErrorTrackerHeader extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            showFilters: false,
        };
    }
    render() {
        const {

            errorTracker,

            isDetails,

            errorTrackerIssue,

            viewMore,

            deleteErrorTracker,

            openModal,

            deleteModalId,

            editErrorTracker,

            trackerKeyModalId,

            resetErrorTrackerKey,

            currentDateRange,

            formId,

            handleStartDateTimeChange,

            handleEndDateTimeChange,

            handleFilterUpdate,

            showComponentWithIssue,
        } = this.props;
        let deleting = false;
        if (

            this.props.errorTrackerState &&

            this.props.errorTrackerState.deleteErrorTracker &&

            this.props.errorTrackerState.deleteErrorTracker === errorTracker._id
        ) {
            deleting = true;
        }
        return (
            <div>
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div>
                        <ShouldRender
                            if={errorTracker && errorTracker.resourceCategory}
                        >
                            <div className="Box-root">
                                <Badge
                                    color={'slate5'}
                                    id={`${errorTracker.name}-badge`}
                                >
                                    {errorTracker &&
                                        errorTracker.resourceCategory
                                        ? errorTracker.resourceCategory.name
                                        : ''}
                                </Badge>
                            </div>
                        </ShouldRender>
                    </div>
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span
                                    id={`error-tracker-title-${errorTracker.name}`}
                                >
                                    {`${showComponentWithIssue
                                            ? errorTracker.componentId
                                                ? errorTracker.componentId
                                                    .name + '/'
                                                : ''
                                            : ''
                                        }${errorTracker.name} (${errorTrackerIssue
                                            ? errorTrackerIssue
                                                .errorTrackerIssues.length
                                            : 0
                                        })`}
                                </span>
                            </span>
                        </div>
                        <div className="Flex-flex">
                            {isDetails ? (
                                <div>
                                    <button
                                        id={`filter_${errorTracker.name}`}
                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--filter"
                                        type="button"
                                        onClick={() =>
                                            this.setState(state => ({

                                                showFilters: !state.showFilters,
                                            }))
                                        }
                                    >
                                        <span>

                                            {this.state.showFilters
                                                ? 'Hide Filters'
                                                : 'Filter'}
                                        </span>
                                    </button>
                                    <button
                                        id={`key_${errorTracker.name}`}
                                        className={
                                            'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--key'
                                        }
                                        type="button"
                                        onClick={() =>
                                            openModal({
                                                id: trackerKeyModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    resetErrorTrackerKey(),
                                                content: DataPathHoC(
                                                    ViewErrorTrackerKey,
                                                    {
                                                        errorTracker,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <span>Tracker Key</span>
                                    </button>
                                    <button
                                        id={`edit_${errorTracker.name}`}
                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings"
                                        type="button"
                                        onClick={editErrorTracker}
                                    >
                                        <span>Edit</span>
                                    </button>
                                    <button
                                        id={`delete_${errorTracker.name}`}
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
                                                    deleteErrorTracker(),
                                                content: DataPathHoC(
                                                    DeleteErrorTracker,
                                                    {
                                                        errorTracker,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            ) : (
                                <button
                                    id={`more-details-${errorTracker.name}`}
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--more"
                                    type="button"
                                    onClick={viewMore}
                                >
                                    <span>More</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <ShouldRender if={isDetails}>
                        <div
                            className="db-Trends-controls Margin-top--12 Flex-flex Flex-justifyContent--spaceBetween"
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
                            <div className="Flex-flex">
                                <div
                                    style={{
                                        height: '33px',
                                        margin: '5px 0px',
                                    }}
                                >
                                    <Select

                                        name="log_type_selector"
                                        placeholder="Filter Errors"
                                        className="db-select-pr-flexible"
                                        id="log_type_selector"
                                        isMulti={true}
                                        style={{
                                            height: '33px',
                                        }}
                                        onChange={handleFilterUpdate}
                                        options={[
                                            {
                                                value: 'is:resolved',
                                                label: 'Resolved',
                                            },
                                            {
                                                value: 'is:unresolved',
                                                label: 'Unresolved',
                                            },
                                            {
                                                value: 'is:ignored',
                                                label: 'Ignored',
                                            },
                                            {
                                                value: 'is:assigned',
                                                label: 'Assigned',
                                            },
                                            {
                                                value: 'is:unassigned',
                                                label: 'Unassigned',
                                            },
                                        ]}
                                    />
                                </div>
                            </div>
                        </div>
                    </ShouldRender>

                    <div>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                A description for what error tracking is.
                                Here&#39;s a list of all errors being tracked
                                for this component.
                            </span>
                        </span>
                    </div>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const currentDateRange = state.errorTracker.errorTrackerIssues[
        ownProps.errorTracker._id
    ]
        ? state.errorTracker.errorTrackerIssues[ownProps.errorTracker._id]
            .dateRange
        : null;
    return {
        errorTrackerState: state.errorTracker,
        currentDateRange,
    };
};


ErrorTrackerHeader.displayName = 'ErrorTrackerHeader';

ErrorTrackerHeader.propTypes = {
    errorTracker: PropTypes.object,
    isDetails: PropTypes.bool,
    errorTrackerIssue: PropTypes.object,
    viewMore: PropTypes.func,
    errorTrackerState: PropTypes.object,
    deleteErrorTracker: PropTypes.func,
    openModal: PropTypes.func,
    deleteModalId: PropTypes.string,
    editErrorTracker: PropTypes.func,
    trackerKeyModalId: PropTypes.string,
    resetErrorTrackerKey: PropTypes.func,
    currentDateRange: PropTypes.object,
    formId: PropTypes.string,
    handleStartDateTimeChange: PropTypes.func,
    handleEndDateTimeChange: PropTypes.func,
    handleFilterUpdate: PropTypes.func,
    showComponentWithIssue: PropTypes.bool,
};
export default connect(mapStateToProps)(ErrorTrackerHeader);
