import React, { Component } from 'react';
import PropTypes from 'prop-types';
import BlockChart from './BlockChart';

class UptimeGraphs extends Component {
  render() {
    const upDays = this.props.monitor.time.length;
    let totalUptime = Math.floor(this.props.monitor.totalUptimePercent);
    let status = {};

    if (this.props.monitor.time.length === 1 && !this.props.monitor.time[0].upTime && !this.props.monitor.time[0].downTime) {
      totalUptime = 100;
    }
    if (this.props.monitor && this.props.monitor.stat && this.props.monitor.stat === 'offline') {
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
    const block = [];

    for (let i = 0; i < 90; i++) {
      if (i < this.props.monitor.time.length) {
        block.unshift(<BlockChart time={this.props.monitor.time[i]} key={i} id={i} monitorName={this.props.monitor.name}/>);
      }
    else {
        block.unshift(<BlockChart time={false} emptytime={new Date().setDate(new Date(this.props.monitor.time[0] != undefined && this.props.monitor.time[0].date ? this.props.monitor.time[0].date : new Date()).getDate() - i)} key={i} id={i} monitorName={this.props.monitor.name}/>);
      }
    }

    return (
      <div className="uptime-graph-section dashboard-uptime-graph" id={this.props.id}>
        <div className="uptime-graph-header clearfix">
          <span style={status}></span>
          <span className="uptime-stat-name">{this.props.monitor.name}</span>
          <span className="url" style={{ paddingLeft: '0px' }}>{this.props.monitor && this.props.monitor.data && this.props.monitor.data.url ? <a style={{ color: '#8898aa', textDecoration: 'none', paddingLeft: '0px' }}
            href={this.props.monitor.data.url} target="_blank" rel="noopener noreferrer">{this.props.monitor.data.url}</a> :<span style={{ color: '#8898aa', textDecoration: 'none', paddingLeft: '0px' }}>{this.props.monitor.type}</span> }</span>
          <span className="percentage"><em>{totalUptime}%</em> uptime for the last {upDays > 90 ? 90 : upDays} day{upDays > 1 ? 's' : ''}</span>
        </div>
        <div className="block-chart">
          {block}
        </div>
      </div>
    );
  }
}

UptimeGraphs.displayName = 'UptimeGraphs';

UptimeGraphs.propTypes = {
  monitor: PropTypes.object,
  id: PropTypes.string
}

export default UptimeGraphs;