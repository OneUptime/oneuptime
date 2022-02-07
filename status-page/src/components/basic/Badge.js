import React from 'react';
import PropTypes from 'prop-types';

function Badge({
    children,
    color = 'green',
    backgroundColor,
    fontColor,
    ...props
}) {
    const shadow = fontColor
        ? { 'boxShadow': `inset 0 0 0 1px ${fontColor}` }
        : {};
    return (
        <div
            className={`Badge Badge--color--blue Box-background--${color} bg-${color}-700 Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
            style={backgroundColor ? { backgroundColor, ...shadow } : {}}
        >
            <span
                className={`Badge-text bg-${color}-700 Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
            >
                <span
                    id={props.id}
                    className={'Text-color--white'}
                    style={
                        fontColor
                            ? {
                                  color: fontColor,
                                  display: 'inline-block',
                                  paddingTop: 2,
                              }
                            : { display: 'inline-block', paddingTop: 2 }
                    }
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
};

export default Badge;
