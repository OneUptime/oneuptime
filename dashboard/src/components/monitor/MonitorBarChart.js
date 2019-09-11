import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import BlockChart from '../blockchart/BlockChart';
import toPascalCase from 'to-pascal-case';

const formatDecimal = (value, decimalPlaces) => {
    return Number(Math.round(parseFloat(value + 'e' + decimalPlaces)) + 'e-' + decimalPlaces).toFixed(decimalPlaces);
};

const formatBytes = (a, b, c, d, e) => {
    return formatDecimal((b = Math, c = b.log, d = 1e3, e = c(a) / c(d) | 0, a / b.pow(d, e)), 2) + ' ' + (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
};

export function MonitorBarChart(props) {
    let block = [];

    for (var i = 0; i < 90; i++) {
        if (props.monitor && props.monitor.time && i < props.monitor.time.length) {
            block.unshift(<BlockChart time={props.monitor.time[i]} key={i} id={i} />);
        } else {
            block.unshift(<BlockChart time={false} key={i} emptytime={new Date().setDate(new Date().getDate(props.monitor.time && props.monitor.time[0] && props.monitor.time[0].date ? props.monitor.time[0].date : new Date()) - i)} id={i} />);
        }
    }

    let monitorType = props.monitor.type;
 
    let colInformation = monitorType === "server-monitor" ? (
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
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{props.monitor.responseTime ? props.monitor.responseTime.toString().split('.')[0] : '0'} ms</span></span></div>
                    </div>
                </div>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Monitor Status</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{props.monitor.status && props.monitor.time && props.monitor.time[0] && (props.monitor.time[0].downTime || props.monitor.time[0].upTime) ? toPascalCase(props.monitor.status) : 'Online'}</span></span></div>
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
            </Fragment>
        );

    let dbTrendStyle = { height: monitorType === "server-monitor" ? "144px" : "76px" };
    let blockChartStyle = { height: monitorType === "server-monitor" ? "143px" : "75px" };

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

const mapStateToProps = () => (
    {
    }
)

export default connect(mapStateToProps, mapDispatchToProps)(MonitorBarChart);