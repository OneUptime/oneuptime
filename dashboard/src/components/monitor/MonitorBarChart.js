import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import BlockChart from '../blockchart/BlockChart';
import AreaChart from '../areachart';
import toPascalCase from 'to-pascal-case';
import ShouldRender from '../basic/ShouldRender';

const formatDecimal = (value, decimalPlaces) => {
    return Number(Math.round(parseFloat(value + 'e' + decimalPlaces)) + 'e-' + decimalPlaces).toFixed(decimalPlaces);
};

const formatBytes = (a, b, c, d, e) => {
    return formatDecimal((b = Math, c = b.log, d = 1e3, e = c(a) / c(d) | 0, a / b.pow(d, e)), 2) + ' ' + (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
};

export function MonitorBarChart(props) {
    let block = [];

    for (var i = 0; i < 90; i++) {
        // use LineChart here
        if (props.monitor && props.monitor.time && i < props.monitor.time.length) {
            block.unshift(<BlockChart time={props.monitor.time[i]} key={i} id={i} />);
        } else {
            block.unshift(<BlockChart time={false} key={i} emptytime={new Date().setDate(new Date().getDate(props.monitor.time && props.monitor.time[0] && props.monitor.time[0].date ? props.monitor.time[0].date : new Date()) - i)} id={i} />);
        }
    }

    let monitorType = props.monitor.type;
    let checkLogs = props.monitor.logs && props.monitor.logs.length > 0;
    let data = props.monitor.logs;

    let monitorInfo = monitorType === 'server-monitor' ? (
        <Fragment>
            <div className="db-Trend">
                <div className="block-chart-side line-chart">
                    <div className="db-TrendRow">
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Current CPU Load">
                                <div className="db-Trend-title"><span className="chart-font">Current CPU Load</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatDecimal(props.monitor.logs[0].data.load.currentload, 2) : 0} %</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Average CPU Load">
                                <div className="db-Trend-title"><span className="chart-font">Average CPU Load</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatDecimal(props.monitor.logs[0].data.load.avgload, 2) : 0} %</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Cores">
                                <div className="db-Trend-title"><span className="chart-font">CPU Cores</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? props.monitor.logs[0].data.load.cpus.length : 0}</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <AreaChart data={data} name={'load'} />
                </div>
            </div>
            <div className="db-Trend">
                <div className="block-chart-side line-chart">
                    <div className="db-TrendRow">
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Memory Used">
                                <div className="db-Trend-title"><span className="chart-font">Memory Used</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(props.monitor.logs[0].data.memory.used) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Memory Available">
                                <div className="db-Trend-title"><span className="chart-font">Memory Available</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(props.monitor.logs[0].data.memory.total) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Swap Used">
                                <div className="db-Trend-title"><span className="chart-font">Swap Used</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(props.monitor.logs[0].data.memory.swapused) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <AreaChart data={data} name={'memory'} />
                </div>
            </div>
            <div className="db-Trend">
                <div className="block-chart-side line-chart">
                    <div className="db-TrendRow">
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Storage Used">
                                <div className="db-Trend-title"><span className="chart-font">Storage Used</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(props.monitor.logs[0].data.disk[0].used) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Storage Available">
                                <div className="db-Trend-title"><span className="chart-font">Storage Available</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(props.monitor.logs[0].data.disk[0].size) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Storage Usage">
                                <div className="db-Trend-title"><span className="chart-font">Storage Usage</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? props.monitor.logs[0].data.disk[0].use : 0} %</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <AreaChart data={data} name={'disk'} />
                </div>
            </div>
            <ShouldRender if={props.showAll}>
                <div className="db-Trend">
                    <div className="block-chart-side line-chart">
                        <div className="db-TrendRow">
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Main Temperature">
                                    <div className="db-Trend-title"><span className="chart-font">Main Temperature</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? props.monitor.logs[0].data.temperature.main : 0} &deg;C</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Max. Temperature">
                                    <div className="db-Trend-title"><span className="chart-font">Max. Temperature</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? props.monitor.logs[0].data.temperature.max : 0} &deg;C</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation"></div>
                        </div>
                    </div>
                    <div className="block-chart-main line-chart">
                        <AreaChart data={data} name={'temperature'} />
                    </div>
                </div>
            </ShouldRender>
        </Fragment>
    ) : (
            <div className="db-Trend">
                <span></span>
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
                <div className="block-chart-main">
                    <div className="block-chart">
                        {block}
                    </div>
                </div>
            </div>
        );

    let chart = <div className="db-Trends-content">
        <div className="db-TrendsRows">
            {monitorInfo}
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