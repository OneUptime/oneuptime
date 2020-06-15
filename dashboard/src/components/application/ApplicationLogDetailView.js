import React, { Component } from 'react';
import LogList from './LogList';
import DateRangeWrapper from './DateRangeWrapper';
import TimeRangeSelector from '../basic/TimeRangeSelector';
import Select from '../../components/basic/react-select-fyipe';

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
                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween Padding-top--8">
                                            <div className="db-Trends-timeControls">
                                                <DateRangeWrapper
                                                    selected={startDate}
                                                    dateRange={30}
                                                    onChange={
                                                        handleDateTimeChange
                                                    }
                                                />
                                            </div>

                                            <div className="db-Trends-timeControls">
                                                <TimeRangeSelector
                                                    name1="startTime"
                                                    name2="endTime"
                                                    onChange={
                                                        handleDateTimeChange
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
