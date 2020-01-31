import React, { Fragment, useState, useEffect } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import BlockChart from '../blockchart/BlockChart';
import AreaChart from '../areachart';
import toPascalCase from 'to-pascal-case';
import moment from 'moment';
import ShouldRender from '../basic/ShouldRender';
import { formatDecimal, formatBytes } from '../../config';

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
                    timeObj.downTime = timeObj.downTime + end.diff(start, 'seconds');
                    timeObj.date = monitorStatus.endTime;
                }
                if (monitorStatus.status === 'degraded') {
                    timeObj.degradedTime = timeObj.degradedTime + end.diff(start, 'seconds');
                }
                if (monitorStatus.status === 'online') {
                    timeObj.upTime = timeObj.upTime + end.diff(start, 'seconds');
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

export function MonitorChart({ start, end, monitor, data, statuses, status, showAll, activeProbe, probes }) {
    const [now, setNow] = useState(Date.now());

    const activeProbeObj = probes && probes.length > 0 && probes[activeProbe || 0] ? probes[activeProbe || 0] : null;
    const lastAlive = activeProbeObj && activeProbeObj.lastAlive ? activeProbeObj.lastAlive : null;

    const range = moment(end).diff(moment(start), 'days');
    const { timeBlock, uptimePercent } = statuses && statuses.length > 0 ? calculateTime(statuses, end, range) : calculateTime([], end, range);

    const type = monitor.type;
    const checkLogs = data && data.length > 0;

    const responseTime = checkLogs ? data[0].responseTime : '0';
    const monitorStatus = toPascalCase(status);
    const uptime = uptimePercent || uptimePercent === 0 ? uptimePercent.toString().split('.')[0] : '100';

    useEffect(() => {
        setNow(Date.now());

        let nowHandler = setTimeout(() => {
            setNow(Date.now());
        }, 300000);

        return () => {
            clearTimeout(nowHandler);
        };
    }, [lastAlive]);

    let block = [];
    for (let i = 0; i < range; i++) {
        block.unshift(<BlockChart time={timeBlock[i]} key={i} id={i} />);
    }

    let statusColor;
    switch (status) {
        case 'degraded':
            statusColor = 'yellow';
            break;
        case 'offline':
            statusColor = 'red';
            break;
        case 'online':
            statusColor = 'green';
            break;
        default:
            statusColor = 'blue'
    }

    let isCurrentlyNotMonitoring = (lastAlive && moment(now).diff(moment(lastAlive), 'seconds') >= 300) || !lastAlive;

    let monitorInfo;
    if (type === 'server-monitor') {
        monitorInfo = <Fragment>
            <div className="db-Trend">
                <div className="block-chart-side line-chart">
                    <div className="db-TrendRow">
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Current CPU Load">
                                <div className="db-Trend-title"><span className="chart-font">Current CPU Load</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatDecimal(data[0].cpuLoad, 2) : 0} %</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Average CPU Load">
                                <div className="db-Trend-title"><span className="chart-font">Average CPU Load</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatDecimal(data[0].avgCpuLoad, 2) : 0} %</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Cores">
                                <div className="db-Trend-title"><span className="chart-font">CPU Cores</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].cpuCores : 0}</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <ShouldRender if={!isCurrentlyNotMonitoring}>
                        <AreaChart type={type} data={data} name={'load'} />
                    </ShouldRender>
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
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].memoryUsed) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Memory Available">
                                <div className="db-Trend-title"><span className="chart-font">Memory Available</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].totalMemory) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Swap Used">
                                <div className="db-Trend-title"><span className="chart-font">Swap Used</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].swapUsed) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <ShouldRender if={!isCurrentlyNotMonitoring}>
                        <AreaChart type={type} data={data} name={'memory'} />
                    </ShouldRender>
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
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].storageUsed) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Storage Available">
                                <div className="db-Trend-title"><span className="chart-font">Storage Available</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? formatBytes(data[0].totalStorage) : '0 Bytes'}</span></span></div>
                            </div>
                        </div>
                        <div className="db-Trend-colInformation">
                            <div className="db-Trend-rowTitle" title="Storage Usage">
                                <div className="db-Trend-title"><span className="chart-font">Storage Usage</span></div>
                            </div>
                            <div className="db-Trend-row">
                                <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].storageUsage : 0} %</span></span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="block-chart-main line-chart">
                    <ShouldRender if={!isCurrentlyNotMonitoring}>
                        <AreaChart type={type} data={data} name={'disk'} />
                    </ShouldRender>
                </div>
            </div>
            <ShouldRender if={showAll}>
                <div className="db-Trend">
                    <div className="block-chart-side line-chart">
                        <div className="db-TrendRow">
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Main Temperature">
                                    <div className="db-Trend-title"><span className="chart-font">Main Temperature</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].mainTemp : 0} &deg;C</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Max. Temperature">
                                    <div className="db-Trend-title"><span className="chart-font">Max. Temperature</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{checkLogs ? data[0].maxTemp : 0} &deg;C</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation"></div>
                        </div>
                    </div>
                    <div className="block-chart-main line-chart">
                        <ShouldRender if={!isCurrentlyNotMonitoring}>
                            <AreaChart type={type} data={data} name={'temperature'} />
                        </ShouldRender>
                    </div>
                </div>
            </ShouldRender>
        </Fragment>
    } else if (type === 'url' || type === 'api' || type === 'device') {
        monitorInfo = <div className="db-Trend">
            <div className="block-chart-side line-chart">
                <div className="db-TrendRow">
                    {isCurrentlyNotMonitoring ?
                        <div className="db-Trend-colInformation probe-offline">
                            <div className="db-Trend-rowTitle" title="Currently not monitoring">
                                <div className="db-Trend-title"><strong><span className="chart-font">Currently not monitoring</span></strong></div>
                            </div>
                            <div className="db-Trend-rowTitle">
                                <div className="db-Trend-title description"><small><span className="chart-font">We&apos;re currently not monitoring this monitor from this probe because the probe is offline.</span></small></div>
                            </div>
                        </div>
                        :
                        <>
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
                            <ShouldRender if={data && data.length > 0}>
                                <div className="db-Trend-colInformation">
                                    <div className="db-Trend-rowTitle" title="Response Time">
                                        <div className="db-Trend-title"><span className="chart-font">Response Time</span></div>
                                    </div>
                                    <div className="db-Trend-row">
                                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{responseTime} ms</span></span></div>
                                    </div>
                                </div>
                            </ShouldRender>
                        </>
                    }
                </div>
            </div>
            <div className="block-chart-main line-chart">
                <ShouldRender if={!isCurrentlyNotMonitoring}>
                    <AreaChart type={type} data={data} name={'response time'} symbol="ms" />
                </ShouldRender>
            </div>
        </div>
    } else if (type === 'manual') {
        monitorInfo = <div className="db-Trend">
            <div className="block-chart-side line-chart">
                <div className="db-TrendRow">
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
                <ShouldRender if={!isCurrentlyNotMonitoring}>
                    <AreaChart type={type} data={timeBlock} name={'downtime'} symbol="secs" />
                </ShouldRender>
            </div>
        </div>
    } else {
        monitorInfo = <div className="db-Trend">
            <span></span>
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
            <ShouldRender if={block && block.length > 0}>
                <div className="db-Trend-colInformation">
                    <div className="db-Trend-rowTitle" title="Gross volume">
                        <div className="db-Trend-title"><span className="chart-font">Response Time</span></div>
                    </div>
                    <div className="db-Trend-row">
                        <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{responseTime} ms</span></span></div>
                    </div>
                </div>
            </ShouldRender>
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
    start: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    end: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    monitor: PropTypes.object,
    data: PropTypes.array,
    statuses: PropTypes.array,
    status: PropTypes.string,
    showAll: PropTypes.bool,
    activeProbe: PropTypes.number,
    probes: PropTypes.array
};

const mapStateToProps = (state) => {
    return {
        activeProbe: state.monitor.activeProbe,
        probes: state.probe.probes.data
    };
};

export default connect(mapStateToProps)(MonitorChart);