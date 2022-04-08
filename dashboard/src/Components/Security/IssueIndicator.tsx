import React from 'react';
import PropTypes from 'prop-types';

export interface ComponentProps {
    status: string;
}

const IssueIndicator = ({
    status,
    resourceName,
    count
}: IssueIndicatorProps) => {
    let statusColor, content;

    switch (status) {
        case 'low':
            statusColor = 'slate';
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
                    {` ${count} ${status} ${count ? (count > 1 ? 'issues' : 'issue') : ''
                        }`}{' '}
                </span>
            </div>
        ))
        : (content = (
            <div className={`db-Badge Box-background--${statusColor}`}></div>
        ));

    return content;
};

IssueIndicator.displayName = 'IssueIndicator';
IssueIndicator.propTypes = {
    status: PropTypes.string.isRequired,
};

export default IssueIndicator;
