import React from 'react';
import PropTypes from 'prop-types';

const IssueLabel = ({ level }) => {
    let color;
    switch (level) {
        case 'critical':
        case 'CRITICAL':
            color = 'red';
            break;
        case 'high':
        case 'HIGH':
            color = 'red';
            break;
        case 'moderate':
        case 'MEDIUM':
            color = 'yellow';
            break;
        case 'low':
        case 'LOW':
            color = 'green';
            break;
        default:
            color = 'green';
    }

    return (
        <div
            className={`Badge Badge--color--${color} Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
        >
            <span
                className={`Badge-text Text-color--${color} Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
            >
                <span>{level}</span>
            </span>
        </div>
    );
};

IssueLabel.displayName = 'IssueLabel';

IssueLabel.propTypes = {
    level: PropTypes.string,
};

export default IssueLabel;
