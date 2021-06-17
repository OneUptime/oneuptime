import React, { Component, createRef } from 'react';
import PropTypes from 'prop-types';
import BlockChart from './BlockChart';
import moment from 'moment';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchMonitorStatuses, calculateTime } from '../actions/status';
import { filterProbeData, getMonitorStatus } from '../config';
import ShouldRender from './ShouldRender';

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
        const {
            monitor,
            calculateTime,
            monitorState,
            probes,
            activeProbe,
        } = this.props;

        if (JSON.stringify(prevProps.probes) !== JSON.stringify(probes)) {
            let range = !this.props.theme && 90;
            const now = Date.now();

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
            const statuses = filterProbeData(monitorData, probe) || [];
            calculateTime(statuses, now, range, monitor._id);
        }

        if (JSON.stringify(prevProps.monitor) !== JSON.stringify(monitor)) {
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
            monitorInfo,
        } = this.props;
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

        const calculatingTime = monitor
            ? monitorInfo.requesting[monitor._id]
            : true;

        const info = monitor ? monitorInfo.info[monitor._id] || {} : {};
        const timeBlock = info.timeBlock || [];
        const uptimePercent = info.uptimePercent || 0;

        const monitorStatus = monitor.status
            ? monitor.status
            : getMonitorStatus(statuses);

        const uptime =
            uptimePercent !== 100 && !isNaN(uptimePercent)
                ? uptimePercent.toFixed(3)
                : '100';

        const block = [];
        if (
            !(calculatingTime || timeBlock.length !== range) &&
            selectedCharts &&
            selectedCharts.uptime
        ) {
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
                                        (this.props.ongoing &&
                                            this.props.ongoing.length > 0) ||
                                        status.font === 'rgba(255, 222, 36, 1)'
                                            ? '#e39f48'
                                            : status.font ===
                                              'rgba(108, 219, 86, 1)'
                                            ? '#49c3b1'
                                            : status.font ===
                                              'rgba(250, 109, 70, 1)'
                                            ? '#FA6D46'
                                            : status.font,
                                    textTransform: 'capitalize',
                                }}
                            >
                                {this.props.ongoing &&
                                this.props.ongoing.length > 0
                                    ? 'Ongoing Scheduled Event'
                                    : monitorStatus === 'online'
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
                                        {calculatingTime ||
                                        timeBlock.length !== range ? (
                                            <div ref={this.scrollContent}>
                                                loading...
                                            </div>
                                        ) : (
                                            <div
                                                ref={this.scrollContent}
                                                className="scroll-content"
                                            >
                                                {block}
                                            </div>
                                        )}
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
                                        <em>{uptime}%</em>
                                        {' Uptime'}
                                    </ShouldRender>
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
                                {calculatingTime ||
                                timeBlock.length !== range ? (
                                    <div ref={this.scrollContent}>
                                        Loading...
                                    </div>
                                ) : (
                                    <div
                                        ref={this.scrollContent}
                                        className="scroll-content"
                                    >
                                        {block}
                                    </div>
                                )}
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
    const ongoing =
        state.status &&
        state.status.ongoing &&
        state.status.ongoing.ongoing &&
        state.status.ongoing.ongoing.filter(
            ongoingSchedule => !ongoingSchedule.cancelled
        );
    return {
        monitorState: state.status.statusPage.monitorsData,
        checkUptime: state.status.statusPage.hideUptime,
        activeProbe: state.status.activeProbe,
        probes: state.probe.probes,
        colors: state.status.statusPage.colors,
        ongoing,
        monitorInfo: state.status.monitorInfo,
    };
}

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchMonitorStatuses,
            calculateTime,
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
    ongoing: PropTypes.array,
    calculateTime: PropTypes.func,
    monitorInfo: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorInfo);
