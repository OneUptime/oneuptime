import React, { Component, createRef } from 'react';
import PropTypes from 'prop-types';
import BlockChart from './BlockChart';
import moment from 'moment';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchMonitorStatuses } from '../actions/status';
import { filterProbeData, getMonitorStatus } from '../config';
import ShouldRender from './ShouldRender';

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
            disabledTime: 0,
            status: null,
            emptytime: dayStart.toISOString(),
        };
        /**
         * If two incidents of the same time overlap, we merge them
         * If two incidents of different type overlap, The priority will be:
         * offline, degraded and online.
         *      if the less important incident starts after and finish before the other incident, we remove it.
         *      if the less important incident overlaps with the other incident, we update its start/end time.
         *      if the less important incident start before and finish after the other incident, we divide it into two parts
         *          the first part ends before the important incident,
         *          the second part start after the important incident.
         * The time report will be generate after the following steps:
         * 1- selecting the incident that happendend during the selected day.
         *   In other words: The incidents that overlap with `dayStartIn` and `dayEnd`.
         * 2- Sorting them, to reduce the complexity of the next step (https://www.geeksforgeeks.org/merging-intervals/).
         * 3- Checking for overlaps between incidents. Merge incidents of the same type, reduce the time of the less important incidents.
         * 4- Fill the timeObj
         */
        //First step
        let incidentsHappenedDuringTheDay = [];
        reversedStatuses.forEach(monitor => {
            const monitorStatus = Object.assign({}, monitor);
            if (monitorStatus.endTime === null) {
                monitorStatus.endTime = new Date().toISOString();
            }

            if (
                moment(monitorStatus.startTime).isBefore(dayEnd) &&
                moment(monitorStatus.endTime).isAfter(dayStartIn)
            ) {
                if (
                    monitor.endTime === null &&
                    (monitor.status === 'offline' ||
                        (monitorStatus.status === 'degraded' &&
                            timeObj.status !== 'offline') ||
                        timeObj.status === null)
                ) {
                    timeObj.status = monitorStatus.status;
                }

                if (monitor.endTime === null && monitor.status === 'disabled') {
                    timeObj.status = monitor.status;
                }
                const start = moment(monitorStatus.startTime).isBefore(
                    dayStartIn
                )
                    ? dayStartIn
                    : moment(monitorStatus.startTime);
                const end = moment(monitorStatus.endTime).isAfter(dayEnd)
                    ? dayEnd
                    : moment(monitorStatus.endTime);

                incidentsHappenedDuringTheDay.push({
                    start,
                    end,
                    status: monitorStatus.status,
                });

                timeObj.date = end.toISOString();
                timeObj.emptytime = null;
            }
        });
        //Second step
        incidentsHappenedDuringTheDay.sort((a, b) =>
            moment(a.start).isSame(b.start)
                ? 0
                : moment(a.start).isAfter(b.start)
                ? 1
                : -1
        );
        //Third step
        for (let i = 0; i < incidentsHappenedDuringTheDay.length - 1; i++) {
            const firstIncidentIndex = i;
            const nextIncidentIndex = i + 1;
            const firstIncident =
                incidentsHappenedDuringTheDay[firstIncidentIndex];
            const nextIncident =
                incidentsHappenedDuringTheDay[nextIncidentIndex];
            if (moment(firstIncident.end).isSameOrBefore(nextIncident.start))
                continue;

            if (firstIncident.status === nextIncident.status) {
                const end = moment(firstIncident.end).isAfter(nextIncident.end)
                    ? firstIncident.end
                    : nextIncident.end;
                firstIncident.end = end;
                incidentsHappenedDuringTheDay.splice(nextIncidentIndex, 1);
            } else {
                //if the firstIncident has a higher priority
                if (
                    firstIncident.status === 'disabled' ||
                    (firstIncident.status === 'offline' &&
                        nextIncident.status !== 'disabled') ||
                    (firstIncident.status === 'degraded' &&
                        nextIncident.status === 'online')
                ) {
                    if (moment(firstIncident.end).isAfter(nextIncident.end)) {
                        incidentsHappenedDuringTheDay.splice(
                            nextIncidentIndex,
                            1
                        );
                    } else {
                        nextIncident.start = firstIncident.end;
                        //we will need to shift the next incident to keep the array sorted.
                        incidentsHappenedDuringTheDay.splice(
                            nextIncidentIndex,
                            1
                        );
                        let j = nextIncidentIndex;
                        while (j < incidentsHappenedDuringTheDay.length) {
                            if (
                                moment(nextIncident.start).isBefore(
                                    incidentsHappenedDuringTheDay[j].start
                                )
                            )
                                break;
                            j += 1;
                        }
                        incidentsHappenedDuringTheDay.splice(
                            j,
                            0,
                            nextIncident
                        );
                    }
                } else {
                    if (moment(firstIncident.end).isBefore(nextIncident.end)) {
                        firstIncident.end = nextIncident.start;
                    } else {
                        /**
                         * The firstIncident is less important than the next incident,
                         * it also starts before and ends after the nextIncident.
                         * In the case The first incident needs to be devided into to two parts.
                         * The first part comes before the nextIncident,
                         * the second one comes after the nextIncident.
                         */
                        const newIncident = {
                            start: nextIncident.end,
                            end: firstIncident.end,
                            status: firstIncident.status,
                        };
                        firstIncident.end = nextIncident.start;
                        let j = nextIncidentIndex + 1;
                        while (j < incidentsHappenedDuringTheDay.length) {
                            if (
                                moment(newIncident.start).isBefore(
                                    incidentsHappenedDuringTheDay[j].start
                                )
                            )
                                break;
                            j += 1;
                        }
                        incidentsHappenedDuringTheDay.splice(j, 0, newIncident);
                    }
                }
            }
            i--;
        }
        //Remove events having start and end time equal.
        incidentsHappenedDuringTheDay = incidentsHappenedDuringTheDay.filter(
            event => !moment(event.start).isSame(event.end)
        );
        //Last step
        for (const incident of incidentsHappenedDuringTheDay) {
            const { start, end, status } = incident;
            if (status === 'disabled') {
                timeObj.disabledTime =
                    timeObj.disabledTime + end.diff(start, 'seconds');
                timeObj.date = end.toISOString();
            }
            if (status === 'offline') {
                timeObj.downTime =
                    timeObj.downTime + end.diff(start, 'seconds');
                timeObj.date = end.toISOString();
            }
            if (status === 'degraded') {
                timeObj.degradedTime =
                    timeObj.degradedTime + end.diff(start, 'seconds');
            }
            if (status === 'online') {
                timeObj.upTime = timeObj.upTime + end.diff(start, 'seconds');
            }
        }

        totalUptime = totalUptime + timeObj.upTime;
        totalTime =
            totalTime +
            timeObj.upTime +
            timeObj.degradedTime +
            timeObj.downTime +
            timeObj.disabledTime;
        if (timeObj.status === null || timeObj.status === 'online') {
            if (timeObj.disabledTime > 0) timeObj.status = 'disabled';
            else if (timeObj.downTime > 0) timeObj.status = 'offline';
            else if (timeObj.degradedTime > 0) timeObj.status = 'degraded';
            else if (timeObj.upTime > 0) timeObj.status = 'online';
        }
        timeBlock.push(Object.assign({}, timeObj));

        dayStart = dayStart.subtract(1, 'days');
    }

    return { timeBlock, uptimePercent: (totalUptime / totalTime) * 100 };
};

function debounce(fn, ms) {
    let timer;
    // eslint-disable-next-line no-unused-vars
    return _ => {
        clearTimeout(timer);
        // eslint-disable-next-line no-unused-vars
        timer = setTimeout(_ => {
            timer = null;
            fn.apply(this, arguments);
        }, ms);
    };
}

class MonitorInfo extends Component {
    constructor(props) {
        super(props);

        this.container = createRef();
        this.scrollWrapper = createRef();
        this.scrollContent = createRef();
        this.resizeHandler = this.resizeHandler.bind(this);
        this.state = {
            windowSize: window.innerWidth,
        };
    }

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

        this.resizeHandler();
        window.addEventListener('resize', debounce(this.resizeHandler, 100));
        window.addEventListener('resize', () => {
            this.setState({
                windowSize: window.innerWidth,
            });
        });
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

    componentWillUnmount() {
        window.removeEventListener('resize', debounce(this.resizeHandler, 100));
        window.removeEventListener('resize', () => {
            this.setState({
                windowSize: window.innerWidth,
            });
        });
    }

    resizeHandler() {
        // block chart scroll wrapper
        const scrollWrapper = this.scrollWrapper.current;
        if (!scrollWrapper) return;
        scrollWrapper.style.width = 'auto';

        // block chart scroll content
        const scrollContent = this.scrollContent.current;
        scrollContent.style.width = 'auto';

        // uptime graph container
        const container = this.container.current;

        setTimeout(() => {
            // adjust width
            scrollWrapper.style.width = `${container.clientWidth}px`;
            if (!this.props.theme) {
                scrollContent.style.width = 'max-content';
            } else {
                scrollContent.style.display = 'flex';
                scrollContent.style.justifyContent = 'space-between';
            }

            // scroll to end of chart
            scrollWrapper.scrollLeft =
                scrollContent.clientWidth - scrollWrapper.clientWidth;
        }, 400);
    }

    render() {
        const {
            monitorState,
            monitor,
            probes,
            activeProbe,
            colors,
            selectedCharts,
            resourceCategory,
            isGroupedByMonitorCategory,
        } = this.props;
        const now = Date.now();
        let range = !this.props.theme && 90;

        if (this.props.theme) {
            const { windowSize } = this.state;
            if (windowSize <= 600) {
                range = 30;
            }
            if (windowSize > 600 && windowSize < 1000) {
                range = 60;
            }
            if (windowSize >= 1000) {
                range = 90;
            }
        }

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
            uptimePercent !== 100 && !isNaN(uptimePercent)
                ? uptimePercent.toFixed(3)
                : '100';
        const upDays = timeBlock.length;

        const block = [];
        if (selectedCharts && selectedCharts.uptime)
            for (let i = 0; i < range; i++) {
                block.unshift(
                    <BlockChart
                        monitorId={monitor._id}
                        monitorName={monitor.name}
                        time={timeBlock[i]}
                        key={i}
                        id={i}
                        theme={this.props.theme}
                        windowSize={this.state.windowSize}
                        range={range}
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
        const monitorCategoryStyle = {
            display: 'inline-block',
            marginBottom: 10,
            fontSize: 10,
            color: '#8898aa',
            fontWeight: 'Bold',
            textTransform: 'uppercase',
        };

        const subheading = {};
        const primaryText = {};
        if (colors) {
            subheading.color = `rgba(${colors.subheading.r}, ${colors.subheading.g}, ${colors.subheading.b}, ${colors.subheading.a})`;
            primaryText.color = `rgba(${colors.primaryText.r}, ${colors.primaryText.g}, ${colors.primaryText.b}, ${colors.primaryText.a})`;
            if (monitorStatus === 'degraded') {
                status.backgroundColor = `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b}, ${colors.degraded.a})`; // "degraded-status";
                status.font = `rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b}, ${colors.degraded.a})`; // "degraded-status";
            } else if (monitorStatus === 'online') {
                status.backgroundColor = `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`; // "online-status";
                status.font = `rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b}, ${colors.uptime.a})`; // "online-status";
            } else if (monitorStatus === 'offline') {
                status.backgroundColor = `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b}, ${colors.downtime.a})`; // "red-downtime";
                status.font = `rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b}, ${colors.downtime.a})`; // "red-downtime";
            } else {
                status.backgroundColor = `rgba(${colors.disabled.r}, ${colors.disabled.g}, ${colors.disabled.b}, ${colors.disabled.a})`; // "grey-disabled";
                status.font = `rgba(${colors.disabled.r}, ${colors.disabled.g}, ${colors.disabled.b}, ${colors.disabled.a})`; // "grey-disabled";
            }
        }

        return (
            <>
                <ShouldRender if={this.props.theme}>
                    <>
                        <div className="op-disp">
                            <div className="op-info">
                                <div className="ba-resource">
                                    <ShouldRender
                                        if={isGroupedByMonitorCategory}
                                    >
                                        <div
                                            id={`monitorCategory_${monitor.name}`}
                                            style={monitorCategoryStyle}
                                        >
                                            <span>
                                                {resourceCategory
                                                    ? resourceCategory.name
                                                    : 'Uncategorized'}
                                            </span>
                                        </div>
                                    </ShouldRender>
                                    <div className="ba-flex monitor-list">
                                        <div className="collecion_item">
                                            <span
                                                className="uptime-stat-name"
                                                style={{
                                                    paddingRight: '0px',
                                                    ...subheading,
                                                }}
                                                id={`monitor-${monitor.name}`}
                                            >
                                                {monitor.name}
                                            </span>
                                        </div>
                                        <div className="tooltip">
                                            <ShouldRender
                                                if={
                                                    selectedCharts &&
                                                    selectedCharts.description
                                                }
                                            >
                                                <span className="ques_mark">
                                                    ?
                                                </span>
                                                <span className="tooltiptext tooltip1">
                                                    {selectedCharts &&
                                                        selectedCharts.description}
                                                </span>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div
                                style={{
                                    color:
                                        status.font === 'rgba(108, 219, 86, 1)'
                                            ? '#49c3b1'
                                            : status.font ===
                                              'rgba(250, 109, 70, 1)'
                                            ? '#FA6D46'
                                            : status.font ===
                                              'rgba(255, 222, 36, 1)'
                                            ? '#e39f48'
                                            : status.font,
                                    textTransform: 'capitalize',
                                }}
                            >
                                {monitorStatus === 'online'
                                    ? 'operational'
                                    : monitorStatus}
                            </div>
                        </div>
                        <ShouldRender
                            if={selectedCharts && selectedCharts.uptime}
                        >
                            <div
                                className="uptime-graph-section dashboard-uptime-graph ma-t-20"
                                id={this.props.id}
                                ref={this.container}
                            >
                                {selectedCharts && selectedCharts.uptime && (
                                    <div
                                        ref={this.scrollWrapper}
                                        className="block-chart"
                                        style={{
                                            overflowX: this.props.theme
                                                ? 'none'
                                                : 'scroll',
                                            overflow: this.props.theme
                                                ? 'visible'
                                                : 'scroll',
                                        }}
                                    >
                                        <div
                                            ref={this.scrollContent}
                                            className="scroll-content"
                                        >
                                            {block}
                                        </div>
                                    </div>
                                )}

                                <div className="alerts_days">
                                    <div
                                        style={
                                            subheading.color ===
                                            'rgba(76, 76, 76, 1)'
                                                ? { color: '#aaaaaa' }
                                                : subheading
                                        }
                                    >
                                        {range} days ago
                                    </div>
                                    <div
                                        style={
                                            subheading.color ===
                                            'rgba(76, 76, 76, 1)'
                                                ? { color: '#aaaaaa' }
                                                : subheading
                                        }
                                        className={
                                            this.props.checkUptime
                                                ? 'spacer bs-mar-right'
                                                : 'spacer'
                                        }
                                    ></div>
                                    <ShouldRender if={!this.props.checkUptime}>
                                        <div
                                            style={
                                                subheading.color ===
                                                'rgba(76, 76, 76, 1)'
                                                    ? { color: '#aaaaaa' }
                                                    : subheading
                                            }
                                        >
                                            {uptime}% uptime
                                        </div>
                                    </ShouldRender>
                                    <div
                                        style={
                                            subheading.color ===
                                            'rgba(76, 76, 76, 1)'
                                                ? { color: '#aaaaaa' }
                                                : subheading
                                        }
                                        className={
                                            this.props.checkUptime
                                                ? 'spacer bs-mar-left'
                                                : 'spacer'
                                        }
                                    ></div>
                                    <div
                                        style={
                                            subheading.color ===
                                            'rgba(76, 76, 76, 1)'
                                                ? { color: '#aaaaaa' }
                                                : subheading
                                        }
                                    >
                                        Today
                                    </div>
                                </div>
                            </div>
                        </ShouldRender>
                    </>
                </ShouldRender>

                <ShouldRender if={!this.props.theme}>
                    <div
                        className="uptime-graph-section dashboard-uptime-graph monitorLists"
                        id={this.props.id}
                        ref={this.container}
                    >
                        <div className="uptime-graph-header">
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                <ShouldRender if={isGroupedByMonitorCategory}>
                                    <div
                                        id={`monitorCategory_${monitor.name}`}
                                        style={monitorCategoryStyle}
                                    >
                                        <span>
                                            {resourceCategory
                                                ? resourceCategory.name
                                                : 'Uncategorized'}
                                        </span>
                                    </div>
                                </ShouldRender>
                                <div style={{ display: 'flex' }}>
                                    <ShouldRender if={!this.props.theme}>
                                        <div>
                                            <span style={status}></span>
                                        </div>
                                    </ShouldRender>
                                    <div>
                                        <span
                                            className="uptime-stat-name"
                                            style={subheading}
                                        >
                                            {monitor.name}
                                        </span>
                                        <br />
                                        <div
                                            style={{
                                                color: '#8898aa',
                                                textDecoration: 'none',
                                                paddingLeft: '0px',
                                                fontSize: '12px',
                                                width: '300px',
                                                wordWrap: 'break-word',
                                            }}
                                        >
                                            {selectedCharts &&
                                                selectedCharts.description}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <span
                                    className="percentage"
                                    style={primaryText}
                                >
                                    <ShouldRender if={!this.props.checkUptime}>
                                        <em>{uptime}%</em>{' '}
                                    </ShouldRender>
                                    Uptime for the last{' '}
                                    {upDays > range ? range : upDays} day
                                    {upDays > 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                        {selectedCharts && selectedCharts.uptime && (
                            <div
                                ref={this.scrollWrapper}
                                className="block-chart"
                                style={{
                                    overflowX: this.props.theme
                                        ? 'none'
                                        : 'scroll',
                                }}
                            >
                                <div
                                    ref={this.scrollContent}
                                    className="scroll-content"
                                >
                                    {block}
                                </div>
                            </div>
                        )}
                    </div>
                </ShouldRender>
            </>
        );
    }
}

MonitorInfo.displayName = 'UptimeGraphs';

function mapStateToProps(state) {
    return {
        monitorState: state.status.statusPage.monitorsData,
        checkUptime: state.status.statusPage.hideUptime,
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
    resourceCategory: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    isGroupedByMonitorCategory: PropTypes.bool,
    theme: PropTypes.string,
    checkUptime: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorInfo);
