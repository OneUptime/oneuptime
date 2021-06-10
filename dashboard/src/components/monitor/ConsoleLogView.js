import React from 'react';
import PropTypes from 'prop-types';

const ConsoleLogView = ({ consoleLogs = [], name }) => {
    if (!consoleLogs.length) {
        consoleLogs.push('There are no logs to show');
    }
    return (
        <div name={name} className="console-log-view-container">
            <pre className="line-items">
                {consoleLogs.reduce((allLogs, log) => {
                    return allLogs + log + '\n';
                }, '')}
            </pre>
        </div>
    );
};

ConsoleLogView.propTypes = {
    consoleLogs: PropTypes.arrayOf(PropTypes.string),
    name: PropTypes.string,
};

export default ConsoleLogView;
