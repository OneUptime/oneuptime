import React from 'react';
import moment from 'moment';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import AffectedResources from '../basic/AffectedResources';

const OngoingScheduledEvent = ({
    event,
    monitorList,
    history,
    slug
}: $TSFixMe) => {
    let monitorState: $TSFixMe = [];
    monitorList.forEach((list: $TSFixMe) => {
        if (
            String(list._id) === String(event.projectId._id || event.projectId)
        ) {
            monitorState = list.monitors;
        }
    });
    return (
        <div
            className="Box-root Margin-bottom--12 box box__yellow--dark"
            style={{
                width: '100%',
            }}
            key={event._id}
            onClick={() => {
                history.push(
                    `/dashboard/project/${slug}/scheduledEvents/${event.slug}`
                );
            }}
        >
            <div className="box-inner ongoing__schedulebox">
                <div
                    style={{
                        textTransform: 'uppercase',
                        fontSize: 11,
                        fontWeight: 900,
                    }}
                >
                    Ongoing Scheduled Event
                </div>
                <div className="ongoing__scheduleitem">
                    <span>{event.name}</span>
                    <span>{event.description}</span>
                </div>
                <div className="ongoing__affectedmonitor">
                    <AffectedResources
                        event={event}
                        monitorState={monitorState}
                    />
                </div>

                <span
                    style={{
                        display: 'inline-block',
                        fontSize: 14,
                        fontWeight: 'lighter',
                    }}
                >
                    {moment(event.startDate).format('MMMM Do YYYY, h:mm a')}
                    &nbsp;&nbsp;-&nbsp;&nbsp;
                    {moment(event.endDate).format('MMMM Do YYYY, h:mm a')}
                </span>
                <span className="se__icon se__icon--forward"></span>
            </div>
        </div>
    );
};

OngoingScheduledEvent.displayName = 'OngoingScheduledEvent';

OngoingScheduledEvent.propTypes = {
    event: PropTypes.object,
    monitorList: PropTypes.array,
    history: PropTypes.object,
    slug: PropTypes.string,
};

export default withRouter(OngoingScheduledEvent);
