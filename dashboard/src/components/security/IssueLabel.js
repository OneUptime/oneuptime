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
            color = 'yellow';
            break;
        case 'moderate':
        case 'MEDIUM':
            color = 'blue';
            break;
        case 'low':
        case 'LOW':
            color = 'green';
            break;
        default:
            color = 'green';
    }

    const colorStyle = {
        // overide the default blue color
        color: 'rgba(0, 0, 255, 0.8)',
    };

    return (
        <div
            className={`Badge Badge--color--${color} Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
        >
            <span
                className={`Badge-text Text-color--${color} Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
                style={
                    level === 'moderate' || level === 'MEDIUM' ? colorStyle : {}
                }
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
