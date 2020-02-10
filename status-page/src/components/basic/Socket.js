import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import io from 'socket.io-client';
import { API_URL } from '../../config';

import {
  updatestatuspagebysocket,
  updatemonitorbysocket,
  updatemonitorstatusbysocket,
  incidentcreatedbysocket,
  updateincidentnotesbysocket,
  incidentresolvedbysocket,
  updateprobebysocket
} from '../../actions/socket';

const socket = io(API_URL);

class SocketApp extends Component {

  shouldComponentUpdate(nextProps) {
    if (this.props.project !== nextProps.project) {
      if (this.props.project) {
        socket.removeListener(`updateStatusPage-${this.props.project._id}`);
        socket.removeListener(`updateMonitor-${this.props.project._id}`);
        socket.removeListener(`updateMonitorStatus-${this.props.project._id}`);
        socket.removeListener(`incidentCreated-${this.props.project._id}`);
        socket.removeListener(`incidentNotes-${this.props.project._id}`);
        socket.removeListener(`incidentResolved-${this.props.project._id}`);
        socket.removeListener(`updateProbe-${this.props.project._id}`);
      }
      return true;
    } else {
      return false;
    }
  }

  render() {
    var thisObj = this;

    if (this.props.project) {
      socket.on(`updateStatusPage-${this.props.project._id}`, function (data) {
        thisObj.props.updatestatuspagebysocket(data);
      });
      socket.on(`updateMonitor-${this.props.project._id}`, function (data) {
        thisObj.props.updatemonitorbysocket(data);
      });
      socket.on(`updateMonitorStatus-${this.props.project._id}`, function (data) {
        thisObj.props.updatemonitorstatusbysocket(data, thisObj.props.probes);
      });
      socket.on(`incidentCreated-${this.props.project._id}`, function (data) {
        thisObj.props.incidentcreatedbysocket(data);
      });
      socket.on(`incidentNotes-${this.props.project._id}`, function (data) {
        thisObj.props.updateincidentnotesbysocket(data);
      });
      socket.on(`incidentResolved-${this.props.project._id}`, function (data) {
        thisObj.props.incidentresolvedbysocket(data);
      });
      socket.on(`updateProbe-${this.props.project._id}`, function (data) {
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
    PropTypes.oneOf([null, undefined])
  ]),
  probes: PropTypes.array
};

let mapStateToProps = state => ({
  project: state.status.statusPage.projectId,
  probes: state.probe.probes
});

let mapDispatchToProps = dispatch => (
  bindActionCreators({
    updatestatuspagebysocket,
    updatemonitorbysocket,
    updatemonitorstatusbysocket,
    incidentcreatedbysocket,
    updateincidentnotesbysocket,
    incidentresolvedbysocket,
    updateprobebysocket
  }, dispatch)
);

export default connect(mapStateToProps, mapDispatchToProps)(SocketApp);