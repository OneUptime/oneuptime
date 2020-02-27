import React from 'react';

const NoMonitor = () => (
    <div className="largestatus">
        <span className="legend-item">
            <div className="title-wrapper">
                <label className="status-time">
                    No monitors added yet. Please, add a monitor.
                </label>
            </div>
        </span>
    </div>
);

NoMonitor.displayName = 'NoMonitor';

export default NoMonitor;
