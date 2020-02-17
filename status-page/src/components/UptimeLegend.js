import React from 'react';
import PropTypes from 'prop-types';

const UptimeLegend = ({ background }) =>
    <div className="uptime-legend box-inner clearfix" style={background}>
        <span className="legend-item">
            <span className="legend-color graph-up"></span>
            <label>100% uptime</label>
        </span>
        <span className="legend-item">
            <span className="legend-color graph-mid"></span>
            <label>Partial degradation</label>
        </span>
        <span className="legend-item">
            <span className="legend-color graph-down"></span>
            <label>Downtime</label>
        </span>
    </div>

UptimeLegend.displayName = 'UptimeLegend';

UptimeLegend.propTypes = {
    background: PropTypes.object,
};

export default UptimeLegend;