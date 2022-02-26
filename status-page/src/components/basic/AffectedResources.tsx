import React from 'react';
import PropTypes from 'prop-types';
import { capitalize } from '../../config';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';

const AffectedResources = ({
    event,
    monitorState,
    colorStyle,
    cleanTheme = false
}: $TSFixMe) => {
    const affectedMonitors: $TSFixMe = [];
    let monitorCount = 0;

    const eventMonitors: $TSFixMe = [];
    // populate the ids of the event monitors in an array
    event &&
        event.monitors &&
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
        if (cleanTheme) {
            return (
                <>
                    <span
                        className="ongoing__affectedmonitor--title"
                        style={{
                            color: 'rgba(0, 0, 0, 0.8)',
                        }}
                    >
                        <Translate>Resource Affected:</Translate>
                    </span>{' '}
                    <span
                        className="ongoing__affectedmonitor--content"
                        style={
                            colorStyle !== 'white'
                                ? { color: 'rgba(0, 0, 0, 0.5)' }
                                : {}
                        }
                    >
                        <Translate> All resources are affected</Translate>
                    </span>
                </>
            );
        }
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
                    <Translate>Resources Affected:</Translate>{' '}
                </span>
                <span
                    className="ongoing__affectedmonitor--content"
                    style={
                        colorStyle !== 'white'
                            ? { color: 'rgba(0, 0, 0, 0.5)' }
                            : {}
                    }
                >
                    <Translate> All resources are affected</Translate>
                </span>
            </>
        );
    } else {
        if (cleanTheme) {
            return <>
                <span
                    className="ongoing__affectedmonitor--title"
                    style={{
                        color: 'rgba(0, 0, 0, 0.8)',
                    }}
                >
                    <Translate>Resource Affected:</Translate>
                </span>{' '}
                <span
                    className="ongoing__affectedmonitor--content"
                    style={
                        colorStyle !== 'white'
                            ? { color: 'rgba(0, 0, 0, 0.5)' }
                            : {}
                    }
                >
                    {affectedMonitors
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'monitor' implicitly has an 'any' type.
                        .map(monitor => capitalize(monitor.name))
                        .join(', ')
                        .replace(/, ([^,]*)$/, ' and $1')}
                </span>
            </>;
        }

        return <>
            <span
                className="ongoing__affectedmonitor--title"
                style={
                    colorStyle !== 'white'
                        ? { color: 'rgba(76, 76, 76, 0.8)' }
                        : {}
                }
            >
                <Translate>Resources Affected:</Translate>{' '}
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
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'monitor' implicitly has an 'any' type.
                    .map(monitor => capitalize(monitor.name))
                    .join(', ')
                    .replace(/, ([^,]*)$/, ' and $1')}
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
