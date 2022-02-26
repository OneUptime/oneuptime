import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import moment from 'moment';
import ShouldRender from './ShouldRender';
import AffectedResources from './basic/AffectedResources';

class Events extends Component {
    handleNavigation = (statusPageSlug: $TSFixMe, eventSlug: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { history } = this.props;

        history.push(
            `/status-page/${statusPageSlug}/scheduledEvent/${eventSlug}`
        );
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPageSlug' does not exist on type '... Remove this comment to see the full error message
        const { statusPageSlug } = this.props;
        return (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'events' does not exist on type 'Readonly... Remove this comment to see the full error message
            <ShouldRender if={this.props.events}>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'events' does not exist on type 'Readonly... Remove this comment to see the full error message
                {this.props.events.map((event: $TSFixMe, i: $TSFixMe) => {
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteBackgroundColor' does not exist on t... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'secondaryTextColor' does not exist on ty... Remove this comment to see the full error message
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'primaryTextColor' does not exist on type... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
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
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'secondaryTextColor' does not exist on ty... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Events.displayName = 'Events';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
