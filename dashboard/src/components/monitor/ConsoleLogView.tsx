import React from 'react';
import PropTypes from 'prop-types';

const ConsoleLogView = ({
    consoleLogs = [],
    name
}: $TSFixMe) => {
    if (!consoleLogs.length) {
        consoleLogs.push('There are no logs to show');
    }
    return (
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; name: any; className: s... Remove this comment to see the full error message
        <div name={name} className="console-log-view-container">
            <pre className="line-items">
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'allLogs' implicitly has an 'any' type.
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
