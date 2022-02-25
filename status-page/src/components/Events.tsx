import React, { Component } from 'react';
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';
import moment from 'moment';
import ShouldRender from './ShouldRender';
import AffectedResources from './basic/AffectedResources';

class Events extends Component {
    handleNavigation = (statusPageSlug, eventSlug) => {
        const { history } = this.props;

        history.push(
            `/status-page/${statusPageSlug}/scheduledEvent/${eventSlug}`
        );
    };

    render() {
        const { statusPageSlug } = this.props;
        return (
            <ShouldRender if={this.props.events}>
                {this.props.events.map((event, i) => {
                    if (!event)
                        return (
                            <div>
                                <Translate>No event</Translate>
                            </div>
                        );
                    return (
                        <li
                            className="scheduledEvent feed-item clearfix"
                            key={i}
                            onClick={() =>
                                this.handleNavigation(
                                    statusPageSlug,
                                    event.slug
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
                                        id="eventTitle"
                                        style={{
                                            ...this.props.secondaryTextColor,
                                            color: 'rgba(76, 76, 76, 0.8)',
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
                                <AffectedResources
                                    monitorState={this.props.monitorState}
                                    event={event}
                                    colorStyle="grey"
                                />
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
                                        color: 'rgba(76, 76, 76, 0.8)',
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
    statusPageSlug: PropTypes.string,
    monitorState: PropTypes.array,
    history: PropTypes.object,
};

export default withRouter(Events);
