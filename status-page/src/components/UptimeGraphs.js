import React, { Component } from 'react';
import PropTypes from 'prop-types';
import BlockChart from './BlockChart';
import moment from 'moment';
import { connect } from 'react-redux';
import { filterProbeData, getMonitorStatus } from '../config';

const calculateTime = (statuses, start, range) => {
  let timeBlock = [];
  let totalUptime = 0;
  let totalTime = 0;

  let dayStart = moment(start).startOf('day');

  let reversedStatuses = statuses.slice().reverse();

  for (let i = 0; i < range; i++) {
    let dayStartIn = dayStart;
    let dayEnd = i && i > 0 ? dayStart.clone().endOf('day') : moment(Date.now());

    let timeObj = {
      date: dayStart.toString(),
      downTime: 0,
      upTime: 0,
      degradedTime: 0
    };

    reversedStatuses.forEach(monitorStatus => {
      if (monitorStatus.endTime === null) {
        monitorStatus.endTime = Date.now();
      }

      if (moment(monitorStatus.startTime).isBefore(dayEnd) && moment(monitorStatus.endTime).isAfter(dayStartIn)) {
        let start = moment(monitorStatus.startTime).isBefore(dayStartIn) ? dayStartIn : moment(monitorStatus.startTime);
        let end = moment(monitorStatus.endTime).isAfter(dayEnd) ? dayEnd : moment(monitorStatus.endTime);

        if (monitorStatus.status === 'offline') {
          timeObj.downTime = timeObj.downTime + end.diff(start, 'minutes');
          timeObj.date = monitorStatus.endTime;
        }
        if (monitorStatus.status === 'degraded') {
          timeObj.degradedTime = timeObj.degradedTime + end.diff(start, 'minutes');
        }
        if (monitorStatus.status === 'online') {
          timeObj.upTime = timeObj.upTime + end.diff(start, 'minutes');
        }
      }
    });

    totalUptime = totalUptime + timeObj.upTime;
    totalTime = totalTime + timeObj.upTime + timeObj.degradedTime + timeObj.downTime;

    timeBlock.push(Object.assign({}, timeObj));

    dayStart = dayStart.subtract(1, 'days');
  }

  return { timeBlock, uptimePercent: (totalUptime / totalTime * 100) };
};

class UptimeGraphs extends Component {
  render() {
    const { monitorState, monitor, probes, activeProbe } = this.props;
    const now = Date.now();
    const range = 90;

    let monitorData = monitorState.filter(a => a._id === monitor._id);
    monitorData = monitorData && monitorData.length > 0 ? monitorData[0] : {};

    const probe = monitorData && probes && probes.length > 0 ? probes[probes.length < 2 ? 0 : activeProbe] : null;
    const { logs, statuses } = filterProbeData(monitorData, probe);

    const { timeBlock, uptimePercent } = statuses && statuses.length > 0 ? calculateTime(statuses, now, range) : calculateTime([], now, range);
    const monitorStatus = getMonitorStatus(monitorData.incidents, logs);

    const uptime = uptimePercent || uptimePercent === 0 ? uptimePercent.toString().split('.')[0] : '100';
    const upDays = timeBlock.length;

    let block = [];
    for (let i = 0; i < range; i++) {
      block.unshift(<BlockChart monitorId={monitor._id} time={timeBlock[i]} key={i} id={i} />);
    }

    let status = {};
    if (monitorStatus === 'degraded') {
      status = {
        display: 'inline-block',
        borderRadius: '2px',
        height: '8px',
        width: '8px',
        margin: '0 8px 1px 0',
        backgroundColor: 'rgb(255, 222, 36)'
      } // "yellow-status";
    }
    else if (monitorStatus === 'online') {
      status = {
        display: 'inline-block',
        borderRadius: '2px',
        height: '8px',
        width: '8px',
        margin: '0 8px 1px 0',
        backgroundColor: 'rgb(117, 211, 128)'
      }// "green-status";
    } else {
      status = {
        display: 'inline-block',
        borderRadius: '2px',
        height: '8px',
        width: '8px',
        margin: '0 8px 1px 0',
        backgroundColor: 'rgb(250, 117, 90)'
      }// "red-status";
    }

    return (
      <div className="uptime-graph-section dashboard-uptime-graph" id={this.props.id}>
        <div className="uptime-graph-header clearfix">
          <span style={status}></span>
          <span className="uptime-stat-name">{monitor.name}</span>
          <span className="url" style={{ paddingLeft: '0px' }}>{monitor && monitor.data && monitor.data.url ? <a style={{ color: '#8898aa', textDecoration: 'none', paddingLeft: '0px' }}
            href={monitor.data.url} target="_blank" rel="noopener noreferrer">{monitor.data.url}</a> : <span style={{ color: '#8898aa', textDecoration: 'none', paddingLeft: '0px' }}>{monitor.type === 'manual' ? '' : monitor.type}</span>}</span>
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
    activeProbe: state.status.activeProbe,
    probes: state.probe.probes
  };
}

UptimeGraphs.propTypes = {
  monitor: PropTypes.object,
  id: PropTypes.string,
  activeProbe: PropTypes.number,
  monitorState: PropTypes.array,
  probes: PropTypes.array
}

export default connect(mapStateToProps)(UptimeGraphs);