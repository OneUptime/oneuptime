import React from 'react';
import PropTypes from 'prop-types';

function KubeIndicator({
    status,
    resourceName,
    index
}: $TSFixMe) {
    let statusColor, content;

    switch (status) {
        case 'healthy':
            statusColor = 'green';
            break;
        case 'unhealthy':
            statusColor = 'red';
            break;
        default:
            statusColor = 'slate';
    }

    resourceName
        ? (content = (
              <div className="Flex-flex">
                  <div
                      className={`db-Badge Box-background--${statusColor}`}
                      style={{ width: 10, height: 10, borderRadius: 'unset' }}
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
                  style={{ width: 10, height: 10, borderRadius: 'unset' }}
                  id={`${index}-${status.toLowerCase()}`}
              ></div>
          ));

    return content;
}

KubeIndicator.displayName = 'KubeIndicator';
KubeIndicator.propTypes = {
    status: PropTypes.string,
};

export default KubeIndicator;
