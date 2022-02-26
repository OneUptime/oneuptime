import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';

const NoMonitor = () => (
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
