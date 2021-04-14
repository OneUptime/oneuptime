import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import io from 'socket.io-client';
import { API_URL } from '../../config';

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
} from '../../actions/socket';

// Important: Below `/api` is also needed because `io` constructor strips out the path from the url.
// '/api' is set as socket io namespace, so remove
const socket = io(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
    transports: ['websocket'],
});

class SocketApp extends Component {
    shouldComponentUpdate(nextProps) {
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
                    `addIncidentNote-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncidentNote-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `addScheduledEvent-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `deleteScheduledEvent-${this.props.project
                        .parentProjectId || this.props.project._id}`
                );
                socket.removeListener(
                    `updateScheduledEvent-${this.props.project
                        .parentProjectId || this.props.project._id}`
                );
                socket.removeListener(
                    `addEventNote-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `deleteEventNote-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `updateEventNote-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(`updateProbe-${this.props.project._id}`);
                socket.removeListener(
                    `incidentCreated-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `deleteIncident-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncident-${this.props.project.parentProjectId ||
                        this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncidentTimeline-${this.props.project
                        .parentProjectId || this.props.project._id}`
                );
                socket.removeListener(
                    `deleteIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    `resolveScheduledEvent-${this.props.project._id}`
                );
            }
            return true;
        } else {
            return false;
        }
    }

    render() {
        const thisObj = this;

        if (this.props.project) {
            socket.on(`updateStatusPage-${this.props.project._id}`, function(
                data
            ) {
                if (thisObj.props.statusPage._id === data._id) {
                    thisObj.props.updatestatuspagebysocket(data);
                }
            });
            socket.on(`updateMonitor-${this.props.project._id}`, function(
                data
            ) {
                thisObj.props.updatemonitorbysocket(data);
            });
            socket.on(`deleteMonitor-${this.props.project._id}`, function(
                data
            ) {
                thisObj.props.deletemonitorbysocket(data);
            });
            socket.on(`updateMonitorStatus-${this.props.project._id}`, function(
                data
            ) {
                thisObj.props.updatemonitorstatusbysocket(
                    data,
                    thisObj.props.probes
                );
            });
            socket.on(
                `addIncidentNote-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.addincidentnotebysocket(data);
                }
            );
            socket.on(
                `updateIncidentNote-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.updateincidentnotebysocket(data);
                }
            );
            socket.on(
                `addScheduledEvent-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    if (data.showEventOnStatusPage) {
                        thisObj.props.addscheduledeventbysocket(data);
                    }
                }
            );
            socket.on(
                `deleteScheduledEvent-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.deletescheduledeventbysocket(data);
                }
            );
            socket.on(
                `updateScheduledEvent-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.updatescheduledeventbysocket(data);
                }
            );
            socket.on(
                `addEventNote-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.addeventnotebysocket(data);
                }
            );
            socket.on(
                `deleteEventNote-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.deleteeventnotebysocket(data);
                }
            );
            socket.on(
                `updateEventNote-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.updateeventnotebysocket(data);
                }
            );
            socket.on(`updateProbe-${this.props.project._id}`, function(data) {
                thisObj.props.updateprobebysocket(data);
            });
            socket.on(
                `incidentCreated-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.incidentcreatedbysocket(data);
                }
            );
            socket.on(
                `deleteIncident-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.deleteincidentbysocket(data);
                }
            );
            socket.on(
                `updateIncident-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.updateincidentbysocket(data);
                }
            );
            socket.on(
                `updateIncidentTimeline-${this.props.project.parentProjectId ||
                    this.props.project._id}`,
                function(data) {
                    thisObj.props.addincidenttimelinebysocket(data);
                }
            );
            socket.on(`deleteIncidentNote-${this.props.project._id}`, function(
                data
            ) {
                thisObj.props.deleteincidentnotebysocket(data);
            });
            socket.on(
                `resolveScheduledEvent-${this.props.project._id}`,
                event => thisObj.props.resolvescheduledeventbysocket(event)
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

const mapStateToProps = state => ({
    project: state.status.statusPage.projectId,
    probes: state.probe.probes,
    statusPage: state.status.statusPage,
});

const mapDispatchToProps = dispatch =>
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
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(SocketApp);
