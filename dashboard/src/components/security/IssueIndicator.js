import React from 'react';
import PropTypes from 'prop-types';

const IssueIndicator = ({ status }) => {
    let statusColor;

    switch (status) {
        case 'low':
            statusColor = 'green';
            break;
        case 'moderate':
        case 'medium':
            statusColor = 'yellow';
            break;
        case 'high':
        case 'critical':
            statusColor = 'red';
            break;
        default:
            statusColor = 'slate';
    }

    return <div className={`db-Badge Box-background--${statusColor}`}></div>;
};

IssueIndicator.displayName = 'IssueIndicator';
IssueIndicator.propTypes = {
    status: PropTypes.string.isRequired,
};

export default IssueIndicator;
