import React from 'react';
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

export function MonitorBarChart(props) {
    var block = [];
    var { timeBlock, uptimePercent } = props.probe && props.probe.probeStatus ? calculateTime(props.probe.probeStatus) : calculateTime([]);
    for (var i = 0; i < 90; i++) {
        block.unshift(<BlockChart time={timeBlock[i]} key={i} id={i} />);
    }
    var responseTime = props.probe && props.probe.responseTime ? props.probe.responseTime : '0';
    var monitorStatus = props.probe && props.probe.status ? toPascalCase(props.probe.status) : 'Online';
    var uptime = uptimePercent || uptimePercent === 0 ? uptimePercent.toString().split('.')[0] : '100';

    return (<div className="db-Trends-content">
        <span>
            <div className="db-TrendsRows">
                <span>
                    <div className="db-Trend">
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
                        <div className="block-chart-main">
                            <div className="block-chart">
                                {block}
                            </div>
                        </div>

                    </div></span>
            </div>
        </span>
    </div>)
}

MonitorBarChart.displayName = 'MonitorBarChart'

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch)

function mapStateToProps(state) {
    return {
        activeProbe: state.monitor.activeProbe,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(MonitorBarChart);