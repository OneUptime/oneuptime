import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import io from 'socket.io-client';
import { REALTIME_URL } from '../../config';

import {
    updatestatuspagebysocket,
    updatemonitorbysocket,
    deletemonitorbysocket,
    updatemonitorstatusbysocket,
    addincidentnotebysocket,
    updateincidentnotebysocket,
    addscheduledeventbysocket,
    updatescheduledeventbysocket,
    deletescheduledeventbysocket,
    updateprobebysocket,
    incidentcreatedbysocket,
    updateincidentbysocket,
    addincidenttimelinebysocket,
    deleteincidentnotebysocket,
    deleteincidentbysocket,
    addeventnotebysocket,
    deleteeventnotebysocket,
    updateeventnotebysocket,
    resolvescheduledeventbysocket,
    updatestweetsbysocket,
} from '../../actions/socket';

// Important: Below `/realtime` is also needed because `io` constructor strips out the path from the url.
// '/realtime' is set as socket io namespace, so remove
// @ts-expect-error ts-migrate(2339) FIXME: Property 'connect' does not exist on type '{ (opts... Remove this comment to see the full error message
const socket = io.connect(REALTIME_URL.replace('/realtime', ''), {
    path: '/realtime/socket.io',
    transports: ['websocket', 'polling'],
});

class SocketApp extends Component {
    shouldComponentUpdate(nextProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (this.props.project !== nextProps.project) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            if (this.props.project) {
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateStatusPage-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `deleteMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateMonitorStatus-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `addIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `addScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `deleteScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateScheduledEvent-${this.props.project._id}`
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                socket.removeListener(`addEventNote-${this.props.project._id}`);
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `deleteEventNote-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateEventNote-${this.props.project._id}`
                );
                socket.removeListener(`updateProbe`);
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `incidentCreated-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `deleteIncident-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateIncident-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `updateIncidentTimeline-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `deleteIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    `resolveScheduledEvent-${this.props.project._id}`
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                socket.removeListener(`updateTweets-${this.props.project._id}`);
            }
            return true;
        } else {
            return false;
        }
    }

    render() {
        const thisObj = this;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (this.props.project) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.emit('project_switch', this.props.project._id);

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`updateStatusPage-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                if (thisObj.props.statusPage._id === data._id) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatestatuspagebysocket' does not exist... Remove this comment to see the full error message
                    thisObj.props.updatestatuspagebysocket(data);
                }
            });

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`updateTweets-${this.props.project._id}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
                if (thisObj.props.statusPage._id === data.statusPageId) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatestweetsbysocket' does not exist on... Remove this comment to see the full error message
                    thisObj.props.updatestweetsbysocket(data.tweets);
                }
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`updateMonitor-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorbysocket' does not exist on... Remove this comment to see the full error message
                thisObj.props.updatemonitorbysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`deleteMonitor-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletemonitorbysocket' does not exist on... Remove this comment to see the full error message
                thisObj.props.deletemonitorbysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`updateMonitorStatus-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorstatusbysocket' does not ex... Remove this comment to see the full error message
                thisObj.props.updatemonitorstatusbysocket(
                    data,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
                    thisObj.props.probes
                );
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`addIncidentNote-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'addincidentnotebysocket' does not exist ... Remove this comment to see the full error message
                thisObj.props.addincidentnotebysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`updateIncidentNote-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateincidentnotebysocket' does not exi... Remove this comment to see the full error message
                thisObj.props.updateincidentnotebysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`addScheduledEvent-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                if (data.showEventOnStatusPage) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addscheduledeventbysocket' does not exis... Remove this comment to see the full error message
                    thisObj.props.addscheduledeventbysocket(data);
                }
            });
            socket.on(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                `deleteScheduledEvent-${this.props.project._id}`,
                function(data: $TSFixMe) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletescheduledeventbysocket' does not e... Remove this comment to see the full error message
                    thisObj.props.deletescheduledeventbysocket(data);
                }
            );
            socket.on(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                `updateScheduledEvent-${this.props.project._id}`,
                function(data: $TSFixMe) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatescheduledeventbysocket' does not e... Remove this comment to see the full error message
                    thisObj.props.updatescheduledeventbysocket(data);
                }
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`addEventNote-${this.props.project._id}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'addeventnotebysocket' does not exist on ... Remove this comment to see the full error message
                thisObj.props.addeventnotebysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`deleteEventNote-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteeventnotebysocket' does not exist ... Remove this comment to see the full error message
                thisObj.props.deleteeventnotebysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`updateEventNote-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateeventnotebysocket' does not exist ... Remove this comment to see the full error message
                thisObj.props.updateeventnotebysocket(data);
            });
            socket.on(`updateProbe`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateprobebysocket' does not exist on t... Remove this comment to see the full error message
                thisObj.props.updateprobebysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`incidentCreated-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentcreatedbysocket' does not exist ... Remove this comment to see the full error message
                thisObj.props.incidentcreatedbysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`deleteIncident-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteincidentbysocket' does not exist o... Remove this comment to see the full error message
                thisObj.props.deleteincidentbysocket(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`updateIncident-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateincidentbysocket' does not exist o... Remove this comment to see the full error message
                thisObj.props.updateincidentbysocket(data);
            });
            socket.on(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                `updateIncidentTimeline-${this.props.project._id}`,
                function(data: $TSFixMe) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addincidenttimelinebysocket' does not ex... Remove this comment to see the full error message
                    thisObj.props.addincidenttimelinebysocket(data);
                }
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            socket.on(`deleteIncidentNote-${this.props.project._id}`, function(
                data: $TSFixMe
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteincidentnotebysocket' does not exi... Remove this comment to see the full error message
                thisObj.props.deleteincidentnotebysocket(data);
            });
            socket.on(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                `resolveScheduledEvent-${this.props.project._id}`,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolvescheduledeventbysocket' does not ... Remove this comment to see the full error message
                (event: $TSFixMe) => thisObj.props.resolvescheduledeventbysocket(event)
            );
        }
        return null;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SocketApp.displayName = 'SocketApp';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SocketApp.propTypes = {
    project: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = (state: $TSFixMe) => ({
    project: state.status.statusPage.projectId,
    probes: state.probe.probes,
    statusPage: state.status.statusPage
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        updatestatuspagebysocket,
        updatemonitorbysocket,
        deletemonitorbysocket,
        updatemonitorstatusbysocket,
        addincidentnotebysocket,
        updateincidentnotebysocket,
        addscheduledeventbysocket,
        updatescheduledeventbysocket,
        deletescheduledeventbysocket,
        updateprobebysocket,
        incidentcreatedbysocket,
        updateincidentbysocket,
        addincidenttimelinebysocket,
        deleteincidentnotebysocket,
        deleteincidentbysocket,
        addeventnotebysocket,
        deleteeventnotebysocket,
        updateeventnotebysocket,
        resolvescheduledeventbysocket,
        updatestweetsbysocket,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(SocketApp);
