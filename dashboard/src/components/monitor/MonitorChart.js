import React, { Fragment, useState, useEffect } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import BlockChart from '../blockchart/BlockChart';
import AreaChart from '../areachart';
import toPascalCase from 'to-pascal-case';
import moment from 'moment';
import ShouldRender from '../basic/ShouldRender';
import { formatDecimal, formatBytes } from '../../config';

const calculateTime = (incidents, activeProbe) => {
    let timeBlock = [];
    let dayStart = moment(Date.now()).startOf('day');
    let totalUptime = 0;
    let totalTime = 0;
    for (let i = 0; i < 90; i++) {
        let dayStartIn = dayStart;
        let dayEnd = i && i > 0 ? dayStart.clone().endOf('day') : moment(Date.now());
        let timeObj = {
            date: dayStart.toString(),
            downTime: 0,
            upTime: 0,
            degradedTime: 0
        };
        incidents.forEach(incident => {
            const probes = incident.probes;
            const activeProbeCheck = probes && probes.length === 0 ? true :
                (probes && probes.length > 0 ? (probes.filter(
                    probe => probe && probe.probeId && activeProbe && probe.probeId._id === activeProbe._id
                ).length > 0 ? true : false)
                    : false
                );
            if (activeProbeCheck) {
                let start;
                let end;
                if (incident.resolvedAt === null) {
                    incident.resolvedAt = Date.now();
                }
                if (moment(incident.createdAt).isBefore(dayEnd) && moment(incident.resolvedAt).isAfter(dayStartIn)) {
                    start = moment(incident.createdAt).isBefore(dayStartIn) ? dayStartIn : moment(incident.createdAt);
                    end = moment(incident.resolvedAt).isAfter(dayEnd) ? dayEnd : moment(incident.resolvedAt);
                    if (incident.incidentType === 'offline') {
                        timeObj.downTime = timeObj.downTime + end.diff(start, 'seconds');
                    }
                    if (incident.incidentType === 'degraded') {
                        timeObj.degradedTime = timeObj.degradedTime + end.diff(start, 'seconds');
                    }
                    if (incident.incidentType === 'online') {
                        timeObj.upTime = timeObj.upTime + end.diff(start, 'seconds');
                    }
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

export function MonitorChart({ monitor, data, status, showAll, activeProbe, probes }) {
    const [now, setNow] = useState(Date.now());

    const activeProbeObj = (probes && probes.length > 0 && probes[activeProbe || 0] ? probes[activeProbe || 0] : null);
    const lastAlive = activeProbeObj && activeProbeObj.lastAlive ? activeProbeObj.lastAlive : null;

    const { timeBlock, uptimePercent } = monitor.incidents && monitor.incidents.length > 0 ? calculateTime(monitor.incidents.length > 3 ?
        monitor.incidents.splice(0, 3) : monitor.incidents, activeProbeObj)
        : calculateTime([], activeProbeObj);

    const type = monitor.type;
    const checkLogs = data && data.length > 0;

    const responseTime = checkLogs ? data[0].responseTime : '0';
    const monitorStatus = toPascalCase(status);
    const uptime = uptimePercent || uptimePercent === 0 ? uptimePercent.toString().split('.')[0] : '100';

    useEffect(() => {
        let nowHandler = setTimeout(() => {
            setNow(Date.now());
        }, 65000);

        return () => {
            clearTimeout(nowHandler);
        };
    });

    let block = [];
    for (let i = 0; i < 90; i++) {
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
                    <AreaChart type={type} data={data} name={'load'} />
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
                    <AreaChart type={type} data={data} name={'memory'} />
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
                    <AreaChart type={type} data={data} name={'disk'} />
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
                        <AreaChart type={type} data={data} name={'temperature'} />
                    </div>
                </div>
            </ShouldRender>
        </Fragment>
    } else if (type === 'url' || type === 'api') {
        monitorInfo = <div className="db-Trend">
            <div className="block-chart-side line-chart">
                <div className="db-TrendRow">
                    {(lastAlive && moment(now).diff(moment(lastAlive), 'minutes') > 1) || !lastAlive ?
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
                        </>
                    }
                </div>
            </div>
            <div className="block-chart-main line-chart">
                <AreaChart type={type} data={data} name={'response time'} symbol="ms" />
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
                <AreaChart type={type} data={timeBlock} name={'downtime'} symbol="secs" />
            </div>
        </div>
    } else {
        monitorInfo = <div className="db-Trend">
            <span></span>
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
    monitor: PropTypes.object,
    data: PropTypes.array,
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