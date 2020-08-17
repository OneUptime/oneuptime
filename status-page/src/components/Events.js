import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';
import moment from 'moment';
import ShouldRender from './ShouldRender';

class Events extends Component {
    render() {
        const { history, statusPageId } = this.props;
        return (
            <ShouldRender if={this.props.events}>
                {this.props.events.map((event, i) => {
                    if (!event) return <div>No event</div>;
                    return (
                        <li
                            className="scheduledEvent feed-item clearfix"
                            key={i}
                            onClick={() =>
                                history.push(
                                    `/status-page/${statusPageId}/scheduledEvent/${event._id}`
                                )
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
                                        }}
                                    >
                                        {event.description}
                                    </span>
                                </div>
                            </div>
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
    history: PropTypes.object,
    statusPageId: PropTypes.string,
};

export default withRouter(Events);
