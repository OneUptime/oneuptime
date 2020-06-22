import React, { Component } from 'react';
import PropTypes from 'prop-types';
import BlockChart from './BlockChart';
import moment from 'moment';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchMonitorStatuses } from '../actions/status';
import { filterProbeData, getMonitorStatus } from '../config';

const calculateTime = (statuses, start, range) => {
    const timeBlock = [];
    let totalUptime = 0;
    let totalTime = 0;

    let dayStart = moment(start).startOf('day');

    const reversedStatuses = statuses.slice().reverse();

    for (let i = 0; i < range; i++) {
        const dayStartIn = dayStart;
        const dayEnd =
            i && i > 0 ? dayStart.clone().endOf('day') : moment(Date.now());

        const timeObj = {
            date: dayStart.toISOString(),
            downTime: 0,
            upTime: 0,
            degradedTime: 0,
            emptytime: dayStart.toISOString(),
        };

        reversedStatuses.forEach(monitorStatus => {
            if (monitorStatus.endTime === null) {
                monitorStatus.endTime = new Date().toISOString();
            }

            if (
                moment(monitorStatus.startTime).isBefore(dayEnd) &&
                moment(monitorStatus.endTime).isAfter(dayStartIn)
            ) {
                const start = moment(monitorStatus.startTime).isBefore(
                    dayStartIn
                )
                    ? dayStartIn
                    : moment(monitorStatus.startTime);
                const end = moment(monitorStatus.endTime).isAfter(dayEnd)
                    ? dayEnd
                    : moment(monitorStatus.endTime);

                if (monitorStatus.status === 'offline') {
                    timeObj.downTime =
                        timeObj.downTime + end.diff(start, 'seconds');
                }
                if (monitorStatus.status === 'degraded') {
                    timeObj.degradedTime =
                        timeObj.degradedTime + end.diff(start, 'seconds');
                }
                if (monitorStatus.status === 'online') {
                    timeObj.upTime =
                        timeObj.upTime + end.diff(start, 'seconds');
                }

                timeObj.date = end.toISOString();
                timeObj.emptytime = null;
            }
        });

        totalUptime = totalUptime + timeObj.upTime;
        totalTime =
            totalTime +
            timeObj.upTime +
            timeObj.degradedTime +
            timeObj.downTime;

        timeBlock.push(Object.assign({}, timeObj));

        dayStart = dayStart.subtract(1, 'days');
    }

    return { timeBlock, uptimePercent: (totalUptime / totalTime) * 100 };
};

class MonitorInfo extends Component {
    componentDidMount() {
        const { monitor } = this.props;

        if (monitor && !monitor.statuses) {
            const endDate = moment(Date.now());
            const startDate = moment(Date.now()).subtract(90, 'days');
            this.props.fetchMonitorStatuses(
                monitor.projectId._id || monitor.projectId,
                monitor._id,
                startDate,
                endDate
            );
        }
    }

    componentDidUpdate(prevProps) {
        const { monitor } = this.props;

        if (prevProps.monitor !== monitor) {
            if (monitor && !monitor.statuses) {
                const endDate = moment(Date.now());
                const startDate = moment(Date.now()).subtract(90, 'days');
                this.props.fetchMonitorStatuses(
                    monitor.projectId._id || monitor.projectId,
                    monitor._id,
                    startDate,
                    endDate
                );
            }
        }
    }

    render() {
        const {
            monitorState,
            monitor,
            probes,
            activeProbe,
            colors,
            selectedCharts,
        } = this.props;
        const now = Date.now();
        const range = 90;

        let monitorData = monitorState.filter(a => a._id === monitor._id);
        monitorData =
            monitorData && monitorData.length > 0 ? monitorData[0] : null;

        const probe =
            probes && probes.length > 0
                ? probes[probes.length < 2 ? 0 : activeProbe]
                : null;
        const statuses = filterProbeData(monitorData, probe);

        const { timeBlock, uptimePercent } =
            statuses && statuses.length > 0
                ? calculateTime(statuses, now, range)
                : calculateTime([], now, range);
        const monitorStatus = getMonitorStatus(statuses);

        const uptime =
            uptimePercent || uptimePercent === 0
                ? uptimePercent.toString().split('.')[0]
                : '100';
        const upDays = timeBlock.length;

        const block = [];
        if (selectedCharts.uptime)
            for (let i = 0; i < range; i++) {
                block.unshift(
                    <BlockChart
                        monitorId={monitor._id}
                        monitorName={monitor.name}
                        time={timeBlock[i]}
                        key={i}
                        id={i}
                    />
                );
            }

        const status = {
            display: 'inline-block',
            borderRadius: '2px',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
        };

        const subheading = {};
        const primaryText = {};
        if (colors) {
            subheading.color = `rgba(${colors.subheading.r}, ${colors.subheading.g}, ${colors.subheading.b}, ${colors.subheading.a})`;
            primaryText.color = `rgba(${colors.primaryText.r}, ${colors.primaryText.g}, ${colors.primaryText.b}, ${colors.primaryText.a})`;
            if (monitorStatus === 'degraded') {
                status.backgroundColor = `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b})`; // "degraded-status";
            } else if (monitorStatus === 'online') {
                status.backgroundColor = `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b})`; // "online-status";
            } else {
                status.backgroundColor = `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b})`; // "red-downtime";
            }
        }

        return (
            <div
                className="uptime-graph-section dashboard-uptime-graph"
                id={this.props.id}
            >
                <div
                    className="uptime-graph-header"
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                    }}
                >
                    <div>
                        <span style={status}></span>
                        <span className="uptime-stat-name" style={subheading}>
                            {monitor.name}
                        </span>
                        <br />
                        <span className="url">
                            <span
                                style={{
                                    color: '#8898aa',
                                    textDecoration: 'none',
                                    paddingLeft: '0px',
                                }}
                            >
                                {selectedCharts.description}
                            </span>
                        </span>
                    </div>
                    <div>
                        <span className="percentage" style={primaryText}>
                            <em>{uptime}%</em> uptime for the last{' '}
                            {upDays > range ? range : upDays} day
                            {upDays > 1 ? 's' : ''}
                        </span>
                    </div>
                </div>
                {selectedCharts.uptime && (
                    <div className="block-chart">{block}</div>
                )}
            </div>
        );
    }
}

MonitorInfo.displayName = 'UptimeGraphs';

function mapStateToProps(state) {
    return {
        monitorState: state.status.statusPage.monitorsData,
        activeProbe: state.status.activeProbe,
        probes: state.probe.probes,
        colors: state.status.statusPage.colors,
    };
}

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchMonitorStatuses,
        },
        dispatch
    );

MonitorInfo.propTypes = {
    monitor: PropTypes.object,
    colors: PropTypes.object,
    fetchMonitorStatuses: PropTypes.func,
    id: PropTypes.string,
    activeProbe: PropTypes.number,
    monitorState: PropTypes.array,
    probes: PropTypes.array,
    selectedCharts: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorInfo);
