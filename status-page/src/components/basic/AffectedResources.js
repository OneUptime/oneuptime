import React from 'react';
import PropTypes from 'prop-types';
import { capitalize } from '../../config';

const AffectedResources = ({ event, monitorState, colorStyle }) => {
    const affectedMonitors = [];
    let monitorCount = 0;

    const eventMonitors = [];
    // populate the ids of the event monitors in an array
    event.monitors.map(monitor => {
        eventMonitors.push(String(monitor.monitorId._id));
        return monitor;
    });

    monitorState.map(monitor => {
        if (eventMonitors.includes(String(monitor._id))) {
            affectedMonitors.push(monitor);
            monitorCount += 1;
        }
        return monitor;
    });
    // check if the length of monitors on status page equals the monitor count
    // if they are equal then all the monitors in status page is in a particular scheduled event
    if (monitorCount === monitorState.length) {
        return (
            <>
                <span
                    className="ongoing__affectedmonitor--title"
                    style={
                        colorStyle !== 'white'
                            ? { color: 'rgba(76, 76, 76, 0.8)' }
                            : {}
                    }
                >
                    Resources Affected:{' '}
                </span>
                <span
                    className="ongoing__affectedmonitor--content"
                    style={
                        colorStyle !== 'white'
                            ? { color: 'rgba(0, 0, 0, 0.5)' }
                            : {}
                    }
                >
                    All resources are affected
                </span>
            </>
        );
    } else {
        return (
            <>
                <span
                    className="ongoing__affectedmonitor--title"
                    style={
                        colorStyle !== 'white'
                            ? { color: 'rgba(76, 76, 76, 0.8)' }
                            : {}
                    }
                >
                    Resources Affected:{' '}
                </span>
                <span
                    className="ongoing__affectedmonitor--content"
                    style={
                        colorStyle !== 'white'
                            ? { color: 'rgba(0, 0, 0, 0.5)' }
                            : {}
                    }
                >
                    {affectedMonitors
                        .map(monitor => capitalize(monitor.name))
                        .join(', ')
                        .replace(/, ([^,]*)$/, ' and $1')}
                </span>
            </>
        );
    }
};

AffectedResources.displayName = 'AffectedResources';

AffectedResources.defaultProps = {
    colorStyle: 'white',
};

AffectedResources.propTypes = {
    event: PropTypes.object,
    monitorState: PropTypes.array,
    colorStyle: PropTypes.oneOf(['white', 'grey']),
};

export default AffectedResources;
