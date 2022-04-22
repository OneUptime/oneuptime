import React from 'react';
import PropTypes from 'prop-types';
import { capitalize } from '../../config';

interface AffectedResourcesProps {
    event?: object;
    monitorState?: unknown[];
    colorStyle?: "white" | "grey";
}

const AffectedResources: Function = ({
    event,
    monitorState,
    colorStyle
}: AffectedResourcesProps) => {
    const affectedMonitors: $TSFixMe = [];
    let monitorCount = 0;

    const eventMonitors: $TSFixMe = [];
    // populate the ids of the event monitors in an array
    event.monitors.map((monitor: $TSFixMe) => {
        eventMonitors.push(String(monitor.monitorId._id));
        return monitor;
    });

    monitorState.map((monitor: $TSFixMe) => {
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
        return <>
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
                {affectedMonitors.length <= 3 &&
                    affectedMonitors

                        .map(monitor => capitalize(monitor.name))
                        .join(', ')
                        .replace(/, ([^,]*)$/, ' and $1')}

                {affectedMonitors.length > 3 &&
                    `${capitalize(affectedMonitors[0].name)}, ${capitalize(
                        affectedMonitors[1].name
                    )} and ${affectedMonitors.length - 2} other monitors.`}
            </span>
        </>;
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
