import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
// import moment from 'moment';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';

function ComponentSummary({ stats }) {
    const [startDate, setStartDate] = useState(Date.now());
    const [endDate, setEndDate] = useState(Date.now());

    useEffect(() => {
        //
    }, [startDate, endDate]);

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
                            handleStartDateTimeChange={val => setStartDate(val)}
                            handleEndDateTimeChange={val => setEndDate(val)}
                            formId={`componentSummaryDateTime`}
                            displayOnlyDate={true}
                        />
                    </div>
                </div>
            </div>
            {stats.map((type, i) => (
                <div key={i} className="db-Trends-content">
                    <div className="db-TrendsRows">
                        <div className="db-Trend">
                            <div className="block-chart-side line-chart">
                                <div className="db-TrendRow">
                                    <div className="db-Trend-colInformation Flex-justifyContent--center">
                                        <div className="db-Trend-row">
                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                {type.name}
                                            </span>
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
                                                        0 %
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="db-Trend-colInformation">
                                        <div className="db-Trend-rowTitle">
                                            <div className="db-Trend-title">
                                                <span className="chart-font">
                                                    Avg. Response Time
                                                </span>
                                            </div>
                                        </div>
                                        <div className="db-Trend-row">
                                            <div className="db-Trend-col db-Trend-colValue">
                                                <span>
                                                    {' '}
                                                    <span className="chart-font">
                                                        0 ms
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
            ))}
        </div>
    );
}

ComponentSummary.displayName = 'ComponentSummary';

ComponentSummary.propTypes = {
    stats: PropTypes.array,
};

export default ComponentSummary;
