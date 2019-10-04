import React, { Component } from 'react';
import PropTypes from 'prop-types';
import BlockChart from './BlockChart';
import moment from 'moment';
import { connect } from 'react-redux';
import toPascalCase from 'to-pascal-case';

const calculateTime = (probeStatus) => {
  var timeBlock = [];
  var dayStart = moment(Date.now()).startOf('day');
  var totalUptime = 0;
  var totalTime = 0;
  for (var i = 0; i < 90; i++) {
      var dayEnd = i && i > 0 ? dayStart.clone().endOf('day') : moment(Date.now());
      var timeObj = {
          date: dayStart,
          downTime: 0,
          upTime: 0,
          degradedTime: 0
      };
      probeStatus.forEach(day => {
          var start;
          var end;
          if (day.endTime === null) {
              day.endTime = Date.now();
          }
          if (moment(day.startTime).isBefore(dayEnd) && moment(day.endTime).isAfter(dayStart)) {
              start = moment(day.startTime).isBefore(dayStart) ? dayStart : moment(day.startTime);
              end = moment(day.endTime).isAfter(dayEnd) ? dayEnd : moment(day.endTime);
              if (day.status === 'offline') {
                  timeObj.downTime = timeObj.downTime + end.diff(start, 'minutes');
              }
              else if (day.status === 'degraded') {
                  timeObj.degradedTime = timeObj.degradedTime + end.diff(start, 'minutes');
              }
              else if (day.status === 'online') {
                  timeObj.upTime = timeObj.upTime + end.diff(start, 'minutes');
              }
          }
      })
      totalUptime = totalUptime + timeObj.upTime;
      totalTime = totalTime + timeObj.upTime + timeObj.degradedTime + timeObj.downTime;
      timeBlock.push(Object.assign({}, timeObj));
      dayStart = dayStart.subtract(1, 'days');
  }
  return { timeBlock, uptimePercent: (totalUptime / totalTime * 100) };
}

class UptimeGraphs extends Component {
  render() {
    var block = [];
    var { monitorState, activeProbe } = this.props;
    var currentMonitorId  = this.props.monitor._id;
    var monitorData = monitorState && monitorState[0].monitors.filter(monitor => monitor._id === currentMonitorId);
    var probe = monitorData[0].probes.filter(probe => probe._id === activeProbe);
    var { timeBlock, uptimePercent } = probe && probe.probeStatus ? calculateTime(probe.probeStatus) : calculateTime([]);

    let monitorStatus = probe && probe.status ? toPascalCase(probe.status) : 'Online';
    let uptime = uptimePercent || uptimePercent === 0 ? uptimePercent.toString().split('.')[0] : '100';


    const upDays = timeBlock.length;
    let status = {};

    if (monitorStatus === 'offline') {
      status = {
        display: 'inline-block',
        borderRadius: '2px',
        height: '8px',
        width: '8px',
        margin: '0 8px 1px 0',
        backgroundColor: 'rgb(250, 117, 90)'
      } // "red-status";
    }
    else {
      status = {
        display: 'inline-block',
        borderRadius: '2px',
        height: '8px',
        width: '8px',
        margin: '0 8px 1px 0',
        backgroundColor: 'rgb(117, 211, 128)'
      }// "green-status";
    }

    for (let i = 0; i < 90; i++) {
        block.unshift(<BlockChart time={timeBlock[i]} key={i} id={i} monitorName={this.props.monitor.name} />);
    }

    return (
      <div className="uptime-graph-section dashboard-uptime-graph" id={this.props.id}>
        <div className="uptime-graph-header clearfix">
          <span style={status}></span>
          <span className="uptime-stat-name">{this.props.monitor.name}</span>
          <span className="url" style={{ paddingLeft: '0px' }}>{this.props.monitor && this.props.monitor.data && this.props.monitor.data.url ? <a style={{ color: '#8898aa', textDecoration: 'none', paddingLeft: '0px' }}
            href={this.props.monitor.data.url} target="_blank" rel="noopener noreferrer">{this.props.monitor.data.url}</a> :<span style={{ color: '#8898aa', textDecoration: 'none', paddingLeft: '0px' }}>{this.props.monitor.type}</span> }</span>
          <span className="percentage"><em>{uptime}%</em> uptime for the last {upDays > 90 ? 90 : upDays} day{upDays > 1 ? 's' : ''}</span>
        </div>
        <div className="block-chart">
          {block}
        </div>
      </div>
    );
  }
}

UptimeGraphs.displayName = 'UptimeGraphs';

function mapStateToProps(state) {
  return {
      monitorState: state.status.statusPage.monitorsData,
      activeProbe: state.status.activeProbe
  };
}

UptimeGraphs.propTypes = {
  monitor: PropTypes.object,
  id: PropTypes.string,
  activeProbe: PropTypes.string,
  monitorState: PropTypes.object
}

export default connect(mapStateToProps)(UptimeGraphs);