import React from 'react';

const UptimeLegend = () =>
        <div className="uptime-legend box-inner clearfix">
            <span className="legend-item">
                <span className="legend-color graph-up"></span>
                <label>100% uptime</label>
            </span>
            <span className="legend-item">
                <span className="legend-color graph-mid"></span>
                <label>partial degradation</label>
            </span>
            <span className="legend-item">
                <span className="legend-color graph-down"></span>
                <label>downtime</label>
            </span>
        </div>

UptimeLegend.displayName = 'UptimeLegend';

export default UptimeLegend;