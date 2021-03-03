import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from './ShouldRender';
import moment from 'moment';

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

        return data && data.length > 0 ? (
            checkDuplicateDates(data).map((event, i) => {
                return (
                    <div className="incident-object" key={i}>
                        <ShouldRender if={event.style}>
                            <div className="date-big">
                                {moment(event.createdAt).format('LL')}
                            </div>
                        </ShouldRender>
                        <ShouldRender if={!event.style}>
                            <div className="border-width-90"></div>
                        </ShouldRender>
                        {event.name ? (
                            <>
                                <div className="list_k">
                                    <b>{event.name}</b>
                                </div>
                                <ShouldRender if={event.description}>
                                    <div className="incident_desc">
                                        {event.description}
                                    </div>
                                </ShouldRender>
                                <div className="bs-resource">
                                    <span>Resources Affected: </span>
                                    <span>All resources are affected</span>
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
                            </>
                        ) : (
                            <div className="bs-no-report">No Event added</div>
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
};

const mapStateToProps = state => ({
    events: state.status.events.events,
    filteredEvents: state.status.individualEvents,
});

export default connect(mapStateToProps, null)(NewThemeEvent);
