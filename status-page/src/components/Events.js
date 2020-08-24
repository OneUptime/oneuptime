import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';
import moment from 'moment';
import ShouldRender from './ShouldRender';
import { capitalize } from '../config';

class Events extends Component {
    handleResources = event => {
        const { monitorState } = this.props;
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
                        style={{ color: 'rgb(76, 76, 76)' }}
                    >
                        Resources Affected:{' '}
                    </span>
                    <span
                        className="ongoing__affectedmonitor--content"
                        style={{ color: 'rgba(0, 0, 0, 0.5)' }}
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
                        style={{ color: 'rgb(76, 76, 76)' }}
                    >
                        Resources Affected:{' '}
                    </span>
                    <span
                        className="ongoing__affectedmonitor--content"
                        style={{ color: 'rgba(0, 0, 0, 0.5)' }}
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

    handleNavigation = (statusPageId, eventId) => {
        const { history } = this.props;

        history.push(`/status-page/${statusPageId}/scheduledEvent/${eventId}`);
    };

    render() {
        const { statusPageId } = this.props;
        return (
            <ShouldRender if={this.props.events}>
                {this.props.events.map((event, i) => {
                    if (!event) return <div>No event</div>;
                    return (
                        <li
                            className="scheduledEvent feed-item clearfix"
                            key={i}
                            onClick={() =>
                                this.handleNavigation(statusPageId, event._id)
                            }
                        >
                            <div
                                className="message"
                                style={{
                                    width: '100%',
                                    marginLeft: 0,
                                    ...this.props.noteBackgroundColor,
                                }}
                            >
                                <div
                                    className="text"
                                    style={{
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        flexWrap: 'nowrap',
                                    }}
                                >
                                    <span
                                        className="feed-title"
                                        style={{
                                            ...this.props.secondaryTextColor,
                                            color: 'rgb(76, 76, 76)',
                                            fontWeight: 'bold',
                                            fontSize: 14,
                                        }}
                                    >
                                        {event.name}
                                    </span>
                                    <span
                                        style={{
                                            ...this.props.primaryTextColor,
                                            color: 'rgba(0, 0, 0, 0.5)',
                                            display: 'block',
                                            textAlign: 'justify',
                                        }}
                                    >
                                        {event.description}
                                    </span>
                                </div>
                            </div>
                            <div
                                className="ongoing__affectedmonitor"
                                style={
                                    event.description
                                        ? { marginTop: 10 }
                                        : { marginTop: 0 }
                                }
                            >
                                {this.handleResources(event)}
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}
                            >
                                <span
                                    className="time"
                                    style={{
                                        marginLeft: 0,
                                        ...this.props.secondaryTextColor,
                                        paddingBottom: 10,
                                    }}
                                >
                                    {moment(event.startDate).format(
                                        'MMMM Do YYYY, h:mm a'
                                    )}
                                    &nbsp;&nbsp;-&nbsp;&nbsp;
                                    {moment(event.endDate).format(
                                        'MMMM Do YYYY, h:mm a'
                                    )}
                                </span>
                                <span className="sp__icon sp__icon--forward"></span>
                            </div>
                        </li>
                    );
                })}
            </ShouldRender>
        );
    }
}

Events.displayName = 'Events';

Events.propTypes = {
    events: PropTypes.array,
    secondaryTextColor: PropTypes.object,
    primaryTextColor: PropTypes.object,
    noteBackgroundColor: PropTypes.object,
    statusPageId: PropTypes.string,
    monitorState: PropTypes.array,
    history: PropTypes.object,
};

export default withRouter(Events);
