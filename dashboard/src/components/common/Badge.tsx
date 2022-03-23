import React from 'react';
import PropTypes from 'prop-types';

interface BadgeProps {
    children?: string | unknown[];
    color?: string;
    id?: string;
    fontColor?: string;
    backgroundColor?: string;
    fontSize?: string;
}

function Badge({
    children,
    color = 'green',
    backgroundColor,
    fontColor,
    fontSize,
    ...props
}: BadgeProps) {
    const fontStyle = {
        color: fontColor || '#fff',
        fontSize: fontSize || '12px',
    };
    return (
        <div
            className={`Badge Badge--color--blue Box-background--${color} bg-${color}-700 Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
            style={backgroundColor ? { backgroundColor } : {}}
        >
            <span
                className={`Badge-text bg-${color}-700 Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
            >
                <span
                    id={props.id}
                    className={'Text-color--white'}
                    style={fontStyle}
                >
                    {children}
                </span>
            </span>
        </div>
    );
}

Badge.displayName = 'Badge';

Badge.propTypes = {
    children: PropTypes.oneOfType([PropTypes.string, PropTypes.array]),
    color: PropTypes.string,
    id: PropTypes.string,
    fontColor: PropTypes.string,
    backgroundColor: PropTypes.string,
    fontSize: PropTypes.string,
};

export default Badge;
