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
    updateincidentnotebysocket,
    updateprobebysocket,
} from '../../actions/socket';

// Important: Below `/api` is also needed because `io` constructor strips out the path from the url.
// '/api' is set as socket io namespace, so remove
const socket = io(API_URL.replace('/api', ''), { path: '/api/socket.io' });

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
                    `updateIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(`updateProbe-${this.props.project._id}`);
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
            socket.on(`updateIncidentNote-${this.props.project._id}`, function(
                data
            ) {
                thisObj.props.updateincidentnotebysocket(data);
            });
            socket.on(`updateProbe-${this.props.project._id}`, function(data) {
                thisObj.props.updateprobebysocket(data);
            });
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
            updateincidentnotebysocket,
            updateprobebysocket,
        },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(SocketApp);
