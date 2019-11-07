import React from 'react';
import PropTypes from 'prop-types';

function StatusIndicator({ status }) {
    let statusColor;

    switch (status.toLowerCase()) {
        case 'online':
            statusColor = 'green';
            break;
        case 'degraded':
            statusColor = 'yellow';
            break;
        case 'offline':
            statusColor = 'red';
            break;
        default:
            statusColor = 'blue'
    }

    return (
        <div className={`db-Badge Box-background--${statusColor}`}></div>
    );
}

StatusIndicator.displayName = 'StatusIndicator';
StatusIndicator.propTypes = {
    status: PropTypes.string
};

export default StatusIndicator;