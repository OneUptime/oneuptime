import React, { Component } from 'react';
import LogList from './LogList';
import DateRangeWrapper from './DateRangeWrapper';
import TimeRangeSelector from '../basic/TimeRangeSelector';
import Select from '../../components/basic/react-select-fyipe';
import DateTimeWrapper from './DateTimeWrapper';
import FilterSelect from './FilterSelect';

class ApplicationLogDetailView extends Component {
    render() {
        const {
            startDate,
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
                                        <div className="Box-root Flex-flex action-bar-holder Padding-top--8">
                                            <div className="action-bar">
                                                <div className="db-Trends-timeControls">
                                                    <DateTimeWrapper
                                                        name="startDate"
                                                        label="Set a start date and time"
                                                        currentDate={startDate}
                                                        id={
                                                            applicationLog._id +
                                                            'start'
                                                        }
                                                        onChange={
                                                            handleDateTimeChange
                                                        }
                                                    />
                                                </div>
                                                <div className="db-Trends-timeControls">
                                                    <DateTimeWrapper
                                                        name="endDate"
                                                        label="Set an end date and time"
                                                        currentDate={startDate}
                                                        id={
                                                            applicationLog._id +
                                                            'end'
                                                        }
                                                        onChange={
                                                            handleDateTimeChange
                                                        }
                                                    />
                                                </div>
                                            </div>

                                            <div className="action-bar">
                                                <div
                                                    style={{
                                                        height: '28px',
                                                    }}
                                                    className="db-Trends-timeControls"
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
                                                    }}
                                                    className="db-Trends-timeControls"
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
export default ApplicationLogDetailView;
