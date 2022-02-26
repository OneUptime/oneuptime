import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';

const UptimeLegend = ({
    background,
    secondaryTextColor,
    downtimeColor,
    uptimeColor,
    degradedColor,
    disabledColor,
    disabled
}: $TSFixMe) => (
    <div className="uptime-legend box-inner clearfix" style={background}>
        <span className="legend-item">
            <span className="legend-color graph-up" style={uptimeColor}></span>
            <label style={secondaryTextColor}>
                100% <Translate>uptime</Translate>
            </label>
        </span>
        <span className="legend-item">
            <span
                className="legend-color graph-mid"
                style={degradedColor}
            ></span>
            <label style={secondaryTextColor}>
                <Translate>Partial degradation</Translate>
            </label>
        </span>
        <span className="legend-item">
            <span
                className="legend-color graph-down"
                style={downtimeColor}
            ></span>
            <label style={secondaryTextColor}>
                <Translate>Downtime</Translate>
            </label>
        </span>
        {disabled ? (
            <span className="legend-item">
                <span
                    className="legend-color graph-disabled"
                    style={disabledColor}
                ></span>
                <label style={secondaryTextColor}>
                    <Translate>Disabled</Translate>
                </label>
            </span>
        ) : (
            ''
        )}
    </div>
);

UptimeLegend.displayName = 'UptimeLegend';

UptimeLegend.propTypes = {
    background: PropTypes.object,
    secondaryTextColor: PropTypes.object,
    downtimeColor: PropTypes.object,
    uptimeColor: PropTypes.object,
    degradedColor: PropTypes.object,
    disabledColor: PropTypes.object,
    disabled: PropTypes.bool,
};

export default UptimeLegend;
