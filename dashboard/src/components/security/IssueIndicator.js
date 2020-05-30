import React from 'react';
import PropTypes from 'prop-types';

const IssueIndicator = ({ status }) => {
    let statusColor;

    switch (Number(status)) {
        case 1:
            // low priority issues
            statusColor = 'green';
            break;
        case 2:
            // moderate issues
            statusColor = 'blue5';
            break;
        case 3:
            // high priority issues
            statusColor = 'yellow';
            break;
        case 4:
            // critical issues
            statusColor = 'red';
            break;
        default:
            statusColor = 'green';
    }

    return <div className={`db-Badge Box-background--${statusColor}`}></div>;
};

IssueIndicator.displayName = 'IssueIndicator';
IssueIndicator.propTypes = {
    status: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default IssueIndicator;
