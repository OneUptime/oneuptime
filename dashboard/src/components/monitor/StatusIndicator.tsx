import React from 'react';
import PropTypes from 'prop-types';

interface StatusIndicatorProps {
    status?: string;
}

function StatusIndicator({
    status,
    resourceName,
    monitorName
}: StatusIndicatorProps) {
    // When resource Name is passed, it renders the status with the same color
    let statusColor, content;

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
        case 'disabled':
            statusColor = 'slate5';
            break;
        default:
            statusColor = 'slate';
    }

    resourceName
        ? (content = (
              <div className="Flex-flex">
                  <div
                      className={`db-Badge Box-background--${statusColor}`}
                  ></div>

                  <span
                      id={`resource_status_${resourceName}`}
                      className={`Text-color--${statusColor}`}
                  >
                      {' '}
                      {` ${status}`}{' '}
                  </span>
              </div>
          ))
        : (content = (
              <div
                  className={`db-Badge Box-background--${statusColor}`}
                  id={`${monitorName}-${status.toLowerCase()}`}
              ></div>
          ));

    return content;
}

StatusIndicator.displayName = 'StatusIndicator';
StatusIndicator.propTypes = {
    status: PropTypes.string,
};

export default StatusIndicator;
