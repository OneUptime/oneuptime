import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import BlockChart from '../blockchart/BlockChart';
import toPascalCase from 'to-pascal-case';
import moment from 'moment';

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
        probeStatus.map(day => {
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
            else {
                return
            }
        })
        totalUptime = totalUptime + timeObj.upTime;
        totalTime = totalTime + timeObj.upTime + timeObj.degradedTime + timeObj.downTime;
        timeBlock.push(Object.assign({}, timeObj));
        dayStart = dayStart.subtract(1, 'days');
    }
    return { timeBlock, uptimePercent: (totalUptime / totalTime * 100) };
}

const formatDecimal = (value, decimalPlaces) => {
    return Number(Math.round(parseFloat(value + 'e' + decimalPlaces)) + 'e-' + decimalPlaces).toFixed(decimalPlaces);
};

const formatBytes = (a, b, c, d, e) => {
    return formatDecimal((b = Math, c = b.log, d = 1e3, e = c(a) / c(d) | 0, a / b.pow(d, e)), 2) + ' ' + (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
};

export function MonitorBarChart(props) {
    var block = [];
    var { timeBlock, uptimePercent } = props.probe && props.probe.probeStatus ? calculateTime(props.probe.probeStatus) : calculateTime([]);
    for (var i = 0; i < 90; i++) {
        block.unshift(<BlockChart time={timeBlock[i]} key={i} id={i} />);
    }

    let monitorType = props.monitor && props.monitor.type;

    let responseTime = props.probe && props.probe.responseTime ? props.probe.responseTime : '0';
    let monitorStatus = props.probe && props.probe.status ? toPascalCase(props.probe.status) : 'Online';
    let uptime = uptimePercent || uptimePercent === 0 ? uptimePercent.toString().split('.')[0] : '100';
 
    let colInformation = monitorType === 'server-monitor' ? (
        <div className="block-chart-side">
            <div className="db-TrendRow margin-b-1">
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Monitor Status</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{(props.monitor.logs && props.monitor.logs.length > 0) ? toPascalCase(props.monitor.logs[0].status) : 'Online'}</span></span></div>
                    </div>
                </div>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Uptime Stats</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{(props.monitor.uptimePercent || (props.monitor.uptimePercent !== undefined && props.monitor.uptimePercent !== null)) && props.monitor.time && props.monitor.time[0] && (props.monitor.time[0].downTime || props.monitor.time[0].upTime) ? props.monitor.uptimePercent.toString().split('.')[0] : '100'} %</span></span></div>
                    </div>
                </div>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">CPU Load</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{(props.monitor.logs && props.monitor.logs.length > 0) ? formatDecimal(props.monitor.logs[0].data.load.currentload, 2) : 0} %</span></span></div>
                    </div>
                </div>
            </div>
            <div className="db-TrendRow">
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Memory Usage</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font"><small>{(props.monitor.logs && props.monitor.logs.length > 0) ? `${formatBytes(props.monitor.logs[0].data.memory.used)} / ${formatBytes(props.monitor.logs[0].data.memory.total)}` : '0 Bytes / 0 Bytes'}</small></span></span></div>
                    </div>
                </div>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Storage Usage</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font"><small>{(props.monitor.logs && props.monitor.logs.length > 0) ? `${formatBytes(props.monitor.logs[0].data.disk[0].used)} / ${formatBytes(props.monitor.logs[0].data.disk[0].size)}` : '0 Bytes / 0 Bytes'}</small></span></span></div>
                    </div>
                </div>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Temperature</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{(props.monitor.logs && props.monitor.logs.length > 0) ? props.monitor.logs[0].data.temperature.max : 0} &deg;C</span></span></div>
                    </div>
                </div>
            </div>
        </div>
    ) : (
            <Fragment>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Response Time</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{responseTime} ms</span></span></div>
                    </div>
                </div>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Monitor Status</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{monitorStatus}</span></span></div>
                    </div>
                </div>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Uptime Stats</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{uptime} %</span></span></div>
                    </div>
                </div>
            </Fragment>
        );

    let dbTrendStyle = { height: monitorType === 'server-monitor' ? '144px' : '76px' };
    let blockChartStyle = { height: monitorType === 'server-monitor' ? '143px' : '75px' };

    let chart = <div className="db-Trends-content">
        <div className="db-TrendsRows">
            <div className="db-Trend" style={dbTrendStyle}>
                <span></span>
                {colInformation}
                <div className="block-chart-main" style={blockChartStyle}>
                    <div className="block-chart" style={blockChartStyle}>
                        {block}
                    </div>
                </div>
            </div>
        </div>
    </div>;

    return chart;  
}

MonitorBarChart.displayName = 'MonitorBarChart'

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch)

function mapStateToProps(state) {
    return {
        activeProbe: state.monitor.activeProbe,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(MonitorBarChart);