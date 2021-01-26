import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import { Spinner } from '../basic/Loader';

function ComponentSummary({
    projectId,
    componentId,
    fetchSummary,
    summary,
    loading,
}) {
    const [startDate, setStartDate] = useState(moment().subtract(30, 'd'));
    const [endDate, setEndDate] = useState(moment());

    useEffect(() => {
        if (projectId && componentId) {
            fetchSummary(projectId, componentId, startDate, endDate);
        }
    }, [projectId, componentId, startDate, endDate, fetchSummary]);

    let totalUptime = 0;

    for (var item of summary) {
        totalUptime += item.monitorUptime;
    }

    let avgMonitorUptime = 100;

    if (summary.length > 0) {
        avgMonitorUptime = totalUptime / summary.length;
    }

    return (
        <div className="Box-root Card-shadow--medium" tabIndex="0">
            <div className="db-Trends-header">
                <div className="db-Trends-title">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    Component Summary
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="db-Trends-controls">
                    <div className="db-Trends-timeControls">
                        <DateTimeRangePicker
                            currentDateRange={{
                                startDate,
                                endDate,
                            }}
                            handleStartDateTimeChange={val =>
                                setStartDate(moment(val))
                            }
                            handleEndDateTimeChange={val =>
                                setEndDate(moment(val))
                            }
                            formId={`componentSummaryDateTime`}
                            displayOnlyDate={true}
                        />
                    </div>
                </div>
            </div>
            {loading ? (
                <div className="db-Trends-content">
                    <div className="db-TrendsRows">
                        <div className="db-Trend">
                            <div className="block-chart-side line-chart Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <Spinner
                                    style={{
                                        stroke: '#8898aa',
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                    <div className="db-Trends-content">
                        <div className="db-TrendsRows">
                            <div className="db-Trend">
                                <div className="block-chart-side line-chart">
                                    <div className="db-TrendRow">
                                        <div className="db-Trend-colInformation">
                                            <div className="db-Trend-rowTitle">
                                                <div className="db-Trend-title">
                                                    <span className="chart-font">
                                                        Monitors
                                                </span>
                                                </div>
                                            </div>
                                            <div className="db-Trend-row">
                                                <div className="db-Trend-col db-Trend-colValue">
                                                    <span>
                                                        {' '}
                                                        <span className="chart-font">
                                                            {summary.length}
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="db-Trend-colInformation">
                                            <div className="db-Trend-rowTitle">
                                                <div className="db-Trend-title">
                                                    <span className="chart-font">
                                                        Avg. Uptime Stats
                                                </span>
                                                </div>
                                            </div>
                                            <div className="db-Trend-row">
                                                <div className="db-Trend-col db-Trend-colValue">
                                                    <span>
                                                        {' '}
                                                        <span className="chart-font">
                                                            {avgMonitorUptime ===
                                                                0 ||
                                                                avgMonitorUptime === 100
                                                                ? avgMonitorUptime
                                                                : avgMonitorUptime.toFixed(
                                                                    3
                                                                )}{' '}
                                                        %
                                                    </span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
        </div>
    );
}

ComponentSummary.displayName = 'ComponentSummary';

ComponentSummary.propTypes = {
    projectId: PropTypes.string,
    componentId: PropTypes.string,
    fetchSummary: PropTypes.func,
    summary: PropTypes.array,
    loading: PropTypes.bool,
};

export default ComponentSummary;
