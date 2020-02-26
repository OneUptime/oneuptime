import React from 'react';
import PropTypes from 'prop-types';

const UptimeLegend = ({ background, secondaryTextColor, downtimeColor, uptimeColor, degradedColor }) =>
    <div className="uptime-legend box-inner clearfix" style={background}>
        <span className="legend-item">
            <span className="legend-color graph-up" style={uptimeColor}></span>
            <label style={secondaryTextColor}>100% uptime</label>
        </span>
        <span className="legend-item">
            <span className="legend-color graph-mid" style={degradedColor}></span>
            <label style={secondaryTextColor}>Partial degradation</label>
        </span>
        <span className="legend-item">
            <span className="legend-color graph-down" style={downtimeColor}></span>
            <label style={secondaryTextColor}>Downtime</label>
        </span>
    </div>

UptimeLegend.displayName = 'UptimeLegend';

UptimeLegend.propTypes = {
    background: PropTypes.object,
    secondaryTextColor: PropTypes.object,
    downtimeColor: PropTypes.object,
    uptimeColor: PropTypes.object,
    degradedColor: PropTypes.object,
};

export default UptimeLegend;
