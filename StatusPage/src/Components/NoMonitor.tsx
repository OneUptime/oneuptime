import React from 'react';

import { Translate } from 'react-auto-translate';

const NoMonitor: Function = () => (
    <div className="largestatus">
        <span className="legend-item">
            <div className="title-wrapper">
                <label className="status-time">
                    <Translate>
                        {' '}
                        No monitors added yet. Please, add a monitor.
                    </Translate>
                </label>
            </div>
        </span>
    </div>
);

NoMonitor.displayName = 'NoMonitor';

export default NoMonitor;
