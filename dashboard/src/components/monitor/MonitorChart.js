import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import BlockChart from '../blockchart/BlockChart';
import AreaChart from '../areachart';
import toPascalCase from 'to-pascal-case';
import moment from 'moment';
import ShouldRender from '../basic/ShouldRender';
import { formatDecimal, formatBytes, getMonitorStatus } from '../../config';

const calculateTime = (probeStatus) => {
    let timeBlock = [];
    let dayStart = moment(Date.now()).startOf('day');
    let totalUptime = 0;
    let totalTime = 0;
    for (let i = 0; i < 90; i++) {
        let dayStartIn = dayStart;
        let dayEnd = i && i > 0 ? dayStart.clone().endOf('day') : moment(Date.now());
        let timeObj = {
            date: dayStart,
            downTime: 0,
            upTime: 0,
            degradedTime: 0
        };
        probeStatus.forEach(day => {
            let start;
            let end;
            if (day.endTime === null) {
                day.endTime = Date.now();
            }
            if (moment(day.startTime).isBefore(dayEnd) && moment(day.endTime).isAfter(dayStartIn)) {
                start = moment(day.startTime).isBefore(dayStartIn) ? dayStartIn : moment(day.startTime);
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
};

export function MonitorChart(props) {
    var block = [];
    var { timeBlock, uptimePercent } = props.probe && props.probe.probeStatus ? calculateTime(props.probe.probeStatus) : calculateTime([]);
    for (var i = 0; i < 90; i++) {
        block.unshift(<BlockChart time={timeBlock[i]} key={i} id={i} />);
    }

    let { startDate, endDate } = props;

    let data = props.monitor.logs && props.monitor.logs.length > 0 ? props.monitor.logs.filter(
        log => moment(new Date(log.createdAt)).isBetween(new Date(startDate), new Date(endDate), 'day', '[]')
    ) : [];
    let checkLogs = data && data.length > 0;

    let responseTime = props.probe && props.probe.responseTime ? props.probe.responseTime : '0';
    let status = getMonitorStatus(props.monitor);
    let monitorStatus = toPascalCase(props.probe && props.probe.status ? props.probe.status : status);
    let uptime = uptimePercent || uptimePercent === 0 ? uptimePercent.toString().split('.')[0] : '100';

    let monitorType = props.monitor.type;
    let monitorInfo;

    let statusColor;
    switch (status) {
        case 'degraded':
            statusColor = 'yellow';
            break;
        case 'offline':
            statusColor = 'red';
            break;
        default:
            statusColor = 'blue'
    }

    if (monitorType === 'server-monitor') {
        monitorInfo = <Fragment>
            <div className="db-Trend">
                <div className="block-chart-side line-chart">
                    <div className="db-TrendRow">
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Current CPU Load">
                                <div className="db-Trend-title"><span className="chart-font">Current CPU Load</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatDecimal(data[0].data.load.currentload, 2) : 0} %</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Average CPU Load">
                                <div className="db-Trend-title"><span className="chart-font">Average CPU Load</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatDecimal(data[0].data.load.avgload, 2) : 0} %</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Cores">
                                <div className="db-Trend-title"><span className="chart-font">CPU Cores</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].data.load.cpus.length : 0}</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <AreaChart type={monitorType} data={data} name={'load'} />
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
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].data.memory.used) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Memory Available">
                                <div className="db-Trend-title"><span className="chart-font">Memory Available</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].data.memory.total) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Swap Used">
                                <div className="db-Trend-title"><span className="chart-font">Swap Used</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].data.memory.swapused) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <AreaChart type={monitorType} data={data} name={'memory'} />
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
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].data.disk[0].used) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Storage Available">
                                <div className="db-Trend-title"><span className="chart-font">Storage Available</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].data.disk[0].size) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Storage Usage">
                                <div className="db-Trend-title"><span className="chart-font">Storage Usage</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].data.disk[0].use : 0} %</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <AreaChart type={monitorType} data={data} name={'disk'} />
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
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].data.temperature.main : 0} &deg;C</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Max. Temperature">
                                    <div className="db-Trend-title"><span className="chart-font">Max. Temperature</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].data.temperature.max : 0} &deg;C</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation"></div>
                        </div>
                    </div>
                    <div className="block-chart-main line-chart">
                        <AreaChart type={monitorType} data={data} name={'temperature'} />
                    </div>
                </div>
            </ShouldRender>
        </Fragment>
    } else if (monitorType === 'url' || monitorType === 'api') {
        monitorInfo = <div className="db-Trend">
            <div className="block-chart-side line-chart">
                <div className="db-TrendRow">
                    <div className="db-Trend-colInformation">
                        <div className="db-Trend-rowTitle" title="Response Time">
                            <div className="db-Trend-title"><span className="chart-font">Response Time</span></div>
                        </div>
                        <div className="db-Trend-row">
                            <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{responseTime} ms</span></span></div>
                        </div>
                    </div>
                    <div className="db-Trend-colInformation">
                        <div className="db-Trend-rowTitle" title="Monitor Status">
                            <div className="db-Trend-title"><span className="chart-font">Monitor Status</span></div>
                        </div>
                        <div className="db-Trend-row">
                            <div className="db-Trend-col db-Trend-colValue"><span> <span className={`chart-font Text-color--${statusColor}`}>{monitorStatus}</span></span></div>
                        </div>
                    </div>
                    <div className="db-Trend-colInformation">
                        <div className="db-Trend-rowTitle" title="Uptime Stats">
                            <div className="db-Trend-title"><span className="chart-font">Uptime Stats</span></div>
                        </div>
                        <div className="db-Trend-row">
                            <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{uptime} %</span></span></div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="block-chart-main line-chart">
                <AreaChart type={monitorType} data={data} name={'response time'} symbol="ms" />
            </div>
        </div>
    } else {
        monitorInfo = <div className="db-Trend">
            <span></span>
            {
                props.monitor.type !== 'manual' ?
                    <div className="db-Trend-colInformation">
                        <div className="db-Trend-rowTitle" title="Gross volume">
                            <div className="db-Trend-title"><span className="chart-font">Response Time</span></div>
                        </div>
                        <div className="db-Trend-row">
                            <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{responseTime} ms</span></span></div>
                        </div>
                    </div> : null
            }
            <div className="db-Trend-colInformation">
                <div className="db-Trend-rowTitle" title="Gross volume">
                    <div className="db-Trend-title"><span className="chart-font">Monitor Status</span></div>
                </div>
                <div className="db-Trend-row">
                    <div className="db-Trend-col db-Trend-colValue"><span> <span className={`chart-font Text-color--${statusColor}`}>{monitorStatus}</span></span></div>
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
            <div className="block-chart-main">
                <div className="block-chart">
                    {block}
                </div>
            </div>
        </div>
    }

    return (
        <div className="db-Trends-content">
            <div className="db-TrendsRows">
                {monitorInfo}
            </div>
        </div>
    );
}

MonitorChart.displayName = 'MonitorChart';

MonitorChart.propTypes = {
    probe: PropTypes.object,
    startDate: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    endDate: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    monitor: PropTypes.object,
    showAll: PropTypes.bool
};

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch)

const mapStateToProps = (state) => {
    return {
        activeProbe: state.monitor.activeProbe
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorChart);