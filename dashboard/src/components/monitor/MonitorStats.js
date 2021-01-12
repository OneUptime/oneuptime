import React, { useState /*, useEffect */ } from 'react';
import PropTypes from 'prop-types';
// import moment from 'moment';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';

function MonitorStats({ stats }) {
    const [startDate /*, setStartDate*/] = useState(Date.now());
    const [endDate /*, setEndDate */] = useState(Date.now());

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
                            // handleStartDateTimeChange={setStartDate()}
                            // handleEndDateTimeChange={setEndDate()}
                            formId={`componentSummaryDateTime`}
                            displayOnlyDate={true}
                        />
                    </div>
                </div>
            </div>
            {stats.map((type, i) => (
                <h1 key={i}>{type.name}</h1>
            ))}
        </div>
    );
}

MonitorStats.displayName = 'MonitorStats';

MonitorStats.propTypes = {
    stats: PropTypes.array,
};

export default MonitorStats;
