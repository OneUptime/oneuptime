import React, { Component } from 'react';
import LogList from './LogList';
import Select from '../../components/basic/react-select-fyipe';
import FilterSelect from './FilterSelect';
import PropTypes from 'prop-types';
import DateTimeRangeSelector from '../basic/DateTimeRangeSelector';
import SearchBox from '../basic/SearchBox';

class ApplicationLogDetailView extends Component {
    render() {
        const {
            logValue,
            applicationLog,
            logOptions,
            componentId,
            handleDateTimeChange,
            handleLogTypeChange,
            handleLogFilterChange,
            filter,
            filters,
        } = this.props;
        return (
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
                                                        Here&apos;s a list of
                                                        recent logs which belong
                                                        to this application log.
                                                    </span>
                                                </span>
                                            </div>

                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                <div></div>
                                            </div>
                                        </div>
                                        <div className="db-Trends-controls">
                                            <SearchBox />
                                        </div>
                                        <div className="db-Trends-controls">
                                            <div className="db-Trends-timeControls Padding-all--4 Margin-all--2">
                                                <DateTimeRangeSelector
                                                    onChange={
                                                        handleDateTimeChange
                                                    }
                                                />
                                            </div>
                                            <div className="Flex-flex action-bar-holder Padding-all--4">
                                                <div
                                                    style={{
                                                        height: '28px',
                                                        margin: '5px',
                                                    }}
                                                >
                                                    <FilterSelect
                                                        name="probe_selector"
                                                        value={filter}
                                                        onChange={
                                                            handleLogFilterChange
                                                        }
                                                        placeholder="Filter By"
                                                        className="db-select-pr"
                                                        id="log_type_selector"
                                                        isDisabled={
                                                            !(
                                                                applicationLog &&
                                                                !applicationLog.requesting
                                                            )
                                                        }
                                                        style={{
                                                            height: '28px',
                                                        }}
                                                        options={filters}
                                                    />
                                                </div>

                                                <div
                                                    style={{
                                                        height: '28px',
                                                        margin: '5px',
                                                    }}
                                                >
                                                    <Select
                                                        name="probe_selector"
                                                        value={logValue}
                                                        onChange={
                                                            handleLogTypeChange
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
                                                            height: '28px',
                                                        }}
                                                        options={logOptions}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <LogList
                                        applicationLog={applicationLog}
                                        componentId={componentId}
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

ApplicationLogDetailView.propTypes = {
    componentId: PropTypes.string,
    applicationLog: PropTypes.object,
    logValue: PropTypes.object,
    logOptions: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string,
            value: PropTypes.string,
        })
    ),
    filter: PropTypes.object,
    filters: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string,
            value: PropTypes.string,
        })
    ),
    handleDateTimeChange: PropTypes.func,
    handleLogTypeChange: PropTypes.func,
    handleLogFilterChange: PropTypes.func,
};
export default ApplicationLogDetailView;
