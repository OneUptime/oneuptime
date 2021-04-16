import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from './ShouldRender';
import moment from 'moment';
import { capitalize } from '../config';

const AffectedResources = ({ event, monitorState, colorStyle }) => {
    const affectedMonitors = [];
    let monitorCount = 0;

    const eventMonitors = [];
    // populate the ids of the event monitors in an array
    event &&
        event.monitors &&
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
class NewThemeEvent extends Component {
    render() {
        const checkDuplicateDates = items => {
            const track = {};

            const result = [];

            for (const item of items) {
                const date = String(item.createdAt).slice(0, 10);

                if (!track[date]) {
                    item.style = true;
                    track[date] = date;
                } else {
                    item.style = false;
                }

                result.push(item);
            }

            return result;
        };

        const formatMsg = data => {
            const result = data.reduce(function(r, a) {
                r[a.event_state] = r[a.event_state] || [];
                r[a.event_state].push(a);
                return r;
            }, Object.create({}));

            return result;
        };

        const data = this.props.filteredEvents.success
            ? this.props.filteredEvents.events
            : this.props.events;

        const noteBackgroundColor = this.props.noteBackgroundColor;

        const currentTime = moment();

        return data && data.length > 0 ? (
            checkDuplicateDates(data).map((event, i) => {
                return (
                    <div
                        className="incident-object"
                        style={{
                            backgroundColor:
                                noteBackgroundColor.background ===
                                'rgba(247, 247, 247, 1)'
                                    ? 'rgba(255,255,255,1)'
                                    : noteBackgroundColor.background,
                        }}
                        key={i}
                    >
                        <ShouldRender if={event.style}>
                            <div className="date-big" style={{ margin: 10 }}>
                                {moment(event.createdAt).format('LL')}
                            </div>
                        </ShouldRender>
                        <ShouldRender if={!event.style}>
                            <div className="border-width-90"></div>
                        </ShouldRender>
                        {event.name ? (
                            <span
                                style={{ margin: 10, display: 'inline-block' }}
                            >
                                <div className="list_k">
                                    <b id={`event-name-${event.name}`}>{event.name}</b>
                                </div>
                                <ShouldRender if={event.description}>
                                    <div className="incident_desc" id={`event-description-${event.description}`}>
                                        {event.description}
                                    </div>
                                </ShouldRender>
                                {AffectedResources({
                                    event,
                                    monitorState: this.props.monitorState,
                                    colorStyle: {},
                                })}
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                    }}
                                >
                                    <div className="incident-date" id="event-date">
                                        <span>
                                            {moment(event.startDate).format(
                                                'LLL'
                                            )}{' '}
                                            -{' '}
                                            {moment(event.endDate).format(
                                                'LLL'
                                            )}
                                        </span>
                                    </div>
                                    {currentTime > moment(event.startDate) &&
                                        currentTime < moment(event.endDate) && (
                                            <div
                                                style={{
                                                    marginLeft: 5,
                                                }}
                                                className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2"
                                            >
                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span id="ongoing-event">Ongoing event</span>
                                                </span>
                                            </div>
                                        )}
                                </div>
                                {event &&
                                    event.notes &&
                                    event.notes.length > 0 &&
                                    Object.keys(formatMsg(event.notes)).map(
                                        (key, index) => {
                                            return (
                                                <div
                                                    className="new-mb-12"
                                                    key={index}
                                                >
                                                    <div className="items_dis">
                                                        <div className="incident-info">
                                                            <span className="list_k">
                                                                {key}
                                                            </span>
                                                            -{' '}
                                                        </div>
                                                        <div className="list_items">
                                                            {formatMsg(
                                                                event.notes
                                                            )[key].map(
                                                                (item, i) => {
                                                                    return (
                                                                        <div
                                                                            className="incident-brief"
                                                                            key={
                                                                                i
                                                                            }
                                                                        >
                                                                            {formatMsg(
                                                                                event.notes
                                                                            )[
                                                                                key
                                                                            ]
                                                                                .length >
                                                                                1 && (
                                                                                <span className="big_dot">
                                                                                    &#9679;
                                                                                </span>
                                                                            )}
                                                                            {
                                                                                item.content
                                                                            }
                                                                        </div>
                                                                    );
                                                                }
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="incident-date">
                                                        <span>
                                                            {formatMsg(
                                                                event.notes
                                                            )[key].map(
                                                                (time, i) => {
                                                                    return (
                                                                        <>
                                                                            {i ===
                                                                                0 && (
                                                                                <div
                                                                                    key={
                                                                                        i
                                                                                    }
                                                                                >
                                                                                    {moment(
                                                                                        time.createdAt
                                                                                    ).format(
                                                                                        'LLL'
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    );
                                                                }
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        }
                                    )}
                            </span>
                        ) : (
                            <div
                                className="bs-no-report"
                                style={{ margin: 10, display: 'inline-block' }}
                            >
                                No Event added
                            </div>
                        )}
                    </div>
                );
            })
        ) : (
            <>
                <ShouldRender if={this.props.filteredEvents.date}>
                    <div className="date-big ma-t-20">
                        {moment(this.props.filteredEvents.date).format('LL')}
                    </div>
                </ShouldRender>
                <div className="no_monitor">No event available</div>
            </>
        );
    }
}

NewThemeEvent.displayName = 'NewThemeEvent';

NewThemeEvent.propTypes = {
    events: PropTypes.array,
    filteredEvents: PropTypes.object,
    noteBackgroundColor: PropTypes.object,
    monitorState: PropTypes.array,
};

const mapStateToProps = state => ({
    events: state.status.events.events,
    filteredEvents: state.status.individualEvents,
    monitorState: state.status.statusPage.monitorsData,
});

export default connect(mapStateToProps, null)(NewThemeEvent);
