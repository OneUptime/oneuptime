import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Translate } from 'react-auto-translate';
import AffectedResources from './basic/AffectedResources';
import PropTypes from 'prop-types';
import moment from 'moment';

class OngoingSchedule extends Component {
    render() {
        return <>
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoing' does not exist on type 'Readonl... Remove this comment to see the full error message
            {this.props.ongoing &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoing' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.props.ongoing.length > 0 &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusData' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusData &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusData' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.statusData._id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoing' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.props.ongoing.map(
                    (event: $TSFixMe) => !event.cancelled && (
                        <div
                            className="content"
                            style={{
                                margin: '10px 0px 40px 0px',
                                cursor: 'pointer',
                            }}
                            key={event._id}
                            onClick={() => {
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
                                this.props.history.push(
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusData' does not exist on type 'Read... Remove this comment to see the full error message
                                    `/status-page/${this.props.statusData.slug}/scheduledEvent/${event.slug}`
                                );
                            }}
                        >
                            <div
                                className="ongoing__schedulebox"
                                style={{ padding: 0 }}
                            >
                                <div
                                    className="content box"
                                    style={{
                                        cursor: 'pointer',
                                    }}
                                    key={event._id}
                                >
                                    <div
                                        className="ongoing__schedulebox content box box__yellow--dark"
                                        style={{
                                            padding: '30px',
                                            boxShadow:
                                                '0 7px 14px 0 rgb(50 50 93 / 10%)',
                                        }}
                                    >
                                        <div
                                            style={{
                                                textTransform:
                                                    'uppercase',
                                                fontSize: 11,
                                                fontWeight: 900,
                                            }}
                                            id="ongoing-event"
                                        >
                                            <Translate>
                                                Ongoing Scheduled Event
                                            </Translate>
                                        </div>
                                        <div className="ongoing__scheduleitem">
                                            <span
                                                id={`event-name-${event.name}`}
                                            >
                                                {event.name}
                                            </span>
                                            <span
                                                id={`event-description-${event.description}`}
                                            >
                                                {event.description}
                                            </span>
                                        </div>
                                        <div className="ongoing__affectedmonitor">
                                            <AffectedResources
                                                event={event}
                                                monitorState={
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorState' does not exist on type 'Re... Remove this comment to see the full error message
                                                        .monitorState
                                                }
                                            />
                                        </div>

                                        <span
                                            style={{
                                                display: 'inline-block',
                                                fontSize: 12,
                                                marginTop: 5,
                                            }}
                                            id="event-date"
                                        >
                                            {moment(
                                                event.startDate
                                            ).format(
                                                'MMMM Do YYYY, h:mm a'
                                            )}
                                            &nbsp;&nbsp;-&nbsp;&nbsp;
                                            {moment(
                                                event.endDate
                                            ).format(
                                                'MMMM Do YYYY, h:mm a'
                                            )}
                                        </span>
                                        <span className="sp__icon sp__icon--more"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                )}
        </>;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
OngoingSchedule.displayName = 'OngoingSchedule';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
OngoingSchedule.propTypes = {
    monitorState: PropTypes.array,
    statusData: PropTypes.object,
    history: PropTypes.object,
    ongoing: PropTypes.array,
};

export default OngoingSchedule;
