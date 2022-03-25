import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
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

const socket = io.connect(REALTIME_URL.replace('/realtime', ''), {
    path: '/realtime/socket.io',
    transports: ['websocket', 'polling'],
});

export interface ComponentProps {}

class SocketApp extends Component<ComponentProps> {
    public static propTypes = {};

    override shouldComponentUpdate(nextProps: $TSFixMe) {
        if (this.props.project !== nextProps.project) {
            if (this.props.project) {
                socket.removeListener(
                    `updateStatusPage-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    `deleteMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateMonitorStatus-${this.props.project._id}`
                );
                socket.removeListener(
                    `addIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    `addScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(
                    `deleteScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateScheduledEvent-${this.props.project._id}`
                );

                socket.removeListener(`addEventNote-${this.props.project._id}`);
                socket.removeListener(
                    `deleteEventNote-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateEventNote-${this.props.project._id}`
                );
                socket.removeListener(`updateProbe`);
                socket.removeListener(
                    `incidentCreated-${this.props.project._id}`
                );
                socket.removeListener(
                    `deleteIncident-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncident-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncidentTimeline-${this.props.project._id}`
                );
                socket.removeListener(
                    `deleteIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    `resolveScheduledEvent-${this.props.project._id}`
                );

                socket.removeListener(`updateTweets-${this.props.project._id}`);
            }
            return true;
        } else {
            return false;
        }
    }

    override render() {
        const thisObj = this;

        if (this.props.project) {
            socket.emit('project_switch', this.props.project._id);

            socket.on(
                `updateStatusPage-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    if (thisObj.props.statusPage._id === data._id) {
                        thisObj.props.updatestatuspagebysocket(data);
                    }
                }
            );

            socket.on(
                `updateTweets-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    if (thisObj.props.statusPage._id === data.statusPageId) {
                        thisObj.props.updatestweetsbysocket(data.tweets);
                    }
                }
            );

            socket.on(
                `updateMonitor-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.updatemonitorbysocket(data);
                }
            );

            socket.on(
                `deleteMonitor-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.deletemonitorbysocket(data);
                }
            );

            socket.on(
                `updateMonitorStatus-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.updatemonitorstatusbysocket(
                        data,

                        thisObj.props.probes
                    );
                }
            );

            socket.on(
                `addIncidentNote-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.addincidentnotebysocket(data);
                }
            );

            socket.on(
                `updateIncidentNote-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.updateincidentnotebysocket(data);
                }
            );

            socket.on(
                `addScheduledEvent-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    if (data.showEventOnStatusPage) {
                        thisObj.props.addscheduledeventbysocket(data);
                    }
                }
            );
            socket.on(
                `deleteScheduledEvent-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.deletescheduledeventbysocket(data);
                }
            );
            socket.on(
                `updateScheduledEvent-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.updatescheduledeventbysocket(data);
                }
            );

            socket.on(
                `addEventNote-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.addeventnotebysocket(data);
                }
            );

            socket.on(
                `deleteEventNote-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.deleteeventnotebysocket(data);
                }
            );

            socket.on(
                `updateEventNote-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.updateeventnotebysocket(data);
                }
            );
            socket.on(`updateProbe`, function (data: $TSFixMe) {
                thisObj.props.updateprobebysocket(data);
            });

            socket.on(
                `incidentCreated-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.incidentcreatedbysocket(data);
                }
            );

            socket.on(
                `deleteIncident-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.deleteincidentbysocket(data);
                }
            );

            socket.on(
                `updateIncident-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.updateincidentbysocket(data);
                }
            );
            socket.on(
                `updateIncidentTimeline-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.addincidenttimelinebysocket(data);
                }
            );

            socket.on(
                `deleteIncidentNote-${this.props.project._id}`,
                function (data: $TSFixMe) {
                    thisObj.props.deleteincidentnotebysocket(data);
                }
            );
            socket.on(
                `resolveScheduledEvent-${this.props.project._id}`,

                (event: $TSFixMe) =>
                    thisObj.props.resolvescheduledeventbysocket(event)
            );
        }
        return null;
    }
}

SocketApp.displayName = 'SocketApp';

SocketApp.propTypes = {
    project: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = (state: $TSFixMe) => ({
    project: state.status.statusPage.projectId,
    probes: state.probe.probes,
    statusPage: state.status.statusPage,
});

const mapDispatchToProps = (dispatch: Dispatch) =>
    bindActionCreators(
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
