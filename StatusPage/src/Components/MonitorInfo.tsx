import React, { Component, createRef } from 'react';
import PropTypes from 'prop-types';

import { Translate } from 'react-auto-translate';
import BlockChart from './BlockChart';
import moment from 'moment';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { fetchMonitorStatuses, calculateTime } from '../actions/status';
import { filterProbeData, getMonitorStatus } from '../config';
import ShouldRender from './ShouldRender';

function debounce(this: $TSFixMe, fn: $TSFixMe, ms: $TSFixMe) {
    let timer: $TSFixMe;

    return (_: $TSFixMe) => {
        clearTimeout(timer);

        timer = setTimeout(_ => {
            timer = null;
            fn.apply(this, arguments);
        }, ms);
    };
}

class MonitorInfo extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    container: $TSFixMe;
    scrollContent: $TSFixMe;
    scrollWrapper: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.container = createRef();
        this.scrollWrapper = createRef();
        this.scrollContent = createRef();
        this.resizeHandler = this.resizeHandler.bind(this);
        this.state = {
            windowSize: window.innerWidth,
        };
    }

    override componentDidMount() {

        const { monitor }: $TSFixMe = this.props;

        if (monitor) {
            const endDate: $TSFixMe = moment(Date.now());
            const startDate: $TSFixMe = moment(Date.now()).subtract(90, 'days');


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

    componentDidUpdate(prevProps: $TSFixMe) {
        const {

            monitor,

            calculateTime,

            monitorState,

            probes,

            activeProbe,

            monitorStatus,
        } = this.props;


        let { range } = this.props;

        let currentProbe =
            probes && probes.length > 0
                ? probes[probes.length < 2 ? 0 : activeProbe]
                : null;
        const prevProbe: $TSFixMe =
            prevProps.probes && prevProps.probes.length > 0
                ? prevProps.probes[
                prevProps.probes.length < 2 ? 0 : activeProbe
                ]
                : null;

        if (
            prevProbe?._id !== currentProbe?._id ||
            JSON.stringify(prevProps.monitorStatus) !==

            JSON.stringify(this.props.monitorStatus) ||
            prevProps.range !== range
        ) {

            range = !this.props.theme ? 90 : range;

            const now: $TSFixMe = Date.now();

            const monitorData: $TSFixMe = monitorState.find(
                (a: $TSFixMe) => String(a._id) === String(monitor._id)
            );

            //this fixes the problem if the monitor is just created and its an api monitor
            if (monitorData?.statuses?.length === 1) {
                currentProbe =
                    probes && probes.length > 0
                        ? probes.filter(
                            (probe: $TSFixMe) => String(probe._id) ===
                                String(monitorData.statuses[0]._id)
                        )[0]
                        : null;
            }

            const statuses: $TSFixMe = filterProbeData(
                monitorData,
                currentProbe,
                monitorStatus
            );
            calculateTime(statuses, now, range, monitor._id);
        }

        if (JSON.stringify(prevProps.monitor) !== JSON.stringify(monitor)) {
            if (monitor) {
                const endDate: $TSFixMe = moment(Date.now());
                const startDate: $TSFixMe = moment(Date.now()).subtract(90, 'days');

                this.props.fetchMonitorStatuses(
                    monitor.projectId._id || monitor.projectId,
                    monitor._id,
                    startDate,
                    endDate
                );
            }
        }
    }

    override componentWillUnmount() {
        window.removeEventListener('resize', debounce(this.resizeHandler, 100));
        window.removeEventListener('resize', () => {
            this.setState({
                windowSize: window.innerWidth,
            });
        });
    }

    resizeHandler() {
        // block chart scroll wrapper
        const scrollWrapper: $TSFixMe = this.scrollWrapper.current;
        if (!scrollWrapper) return;
        scrollWrapper.style.width = 'auto';

        // block chart scroll content
        const scrollContent: $TSFixMe = this.scrollContent.current;
        scrollContent.style.width = 'auto';

        // uptime graph container
        const container: $TSFixMe = this.container.current;

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

    handleMonitorStatus = (status: $TSFixMe) => {

        const { onlineText, offlineText, degradedText }: $TSFixMe = this.props;
        return status === 'online'
            ? onlineText
            : status === 'degraded'
                ? degradedText
                : offlineText;
    };

    checkOngoingEventMonitor = (events: $TSFixMe) => {
        let result = false;
        for (const event of events) {
            for (const monitor of event.monitors) {

                if (monitor.monitorId._id === this.props.monitor._id) {
                    result = true;
                }
            }
        }
        return result;
    };

    override render() {
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

            const { windowSize }: $TSFixMe = this.state;
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

        const monitorData: $TSFixMe = monitorState.find(
            (a: $TSFixMe) => String(a._id) === String(monitor._id)
        );

        const probe: $TSFixMe =
            probes && probes.length > 0
                ? probes[probes.length < 2 ? 0 : activeProbe]
                : null;

        const statuses: $TSFixMe = filterProbeData(monitorData, probe);

        const calculatingTime: $TSFixMe = monitor
            ? monitorInfo.requesting[monitor._id]
            : true;

        const info: $TSFixMe = monitor ? monitorInfo.info[monitor._id] || {} : {};
        const timeBlock: $TSFixMe = info.timeBlock || [];
        const uptimePercent: $TSFixMe = info.uptimePercent || 'N/A';

        const monitorStatus: $TSFixMe = monitor.status
            ? monitor.status
            : getMonitorStatus(statuses);

        const uptime: $TSFixMe =
            uptimePercent !== 100
                ? !isNaN(uptimePercent)
                    ? uptimePercent.toFixed(3)
                    : 'N/A'
                : '100';

        const block: $TSFixMe = [];

        const loadingData: $TSFixMe =
            calculatingTime ||
            timeBlock.length !== range ||
            uptimePercent === 'N/A';

        if (!loadingData && selectedCharts && selectedCharts.uptime) {
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

        const status: $TSFixMe = {
            display: 'inline-block',
            borderRadius: '2px',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
        };
        const monitorCategoryStyle: $TSFixMe = {
            display: 'inline-block',
            marginBottom: 10,
            fontSize: 10,
            color: '#8898aa',
            fontWeight: 'Bold',
            textTransform: 'uppercase',
        };

        const subheading: $TSFixMe = {};
        const primaryText: $TSFixMe = {};
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
                                                {resourceCategory ? (
                                                    resourceCategory.name
                                                ) : (
                                                    <Translate>
                                                        Uncategorized
                                                    </Translate>
                                                )}
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
                                    this.checkOngoingEventMonitor(

                                        this.props.ongoing
                                    )
                                    ? 'Ongoing Scheduled Event'
                                    : this.handleMonitorStatus(monitorStatus)}
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
                                        {loadingData ? (
                                            <div ref={this.scrollContent}>
                                                <Translate>
                                                    {statuses.length === 0
                                                        ? 'calculating...'
                                                        : 'loading...'}
                                                </Translate>
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
                                        {range} <Translate>days ago</Translate>
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
                                        {uptime === 'N/A' ? (
                                            <div
                                                style={

                                                    subheading.color ===
                                                        'rgba(76, 76, 76, 1)'
                                                        ? {
                                                            color: '#aaaaaa',
                                                        }
                                                        : subheading
                                                }
                                            >
                                                {uptime}
                                            </div>
                                        ) : (
                                            <div
                                                style={

                                                    subheading.color ===
                                                        'rgba(76, 76, 76, 1)'
                                                        ? {
                                                            color: '#aaaaaa',
                                                        }
                                                        : subheading
                                                }
                                            >
                                                {uptime}%{' '}
                                                <Translate>uptime</Translate>
                                            </div>
                                        )}
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
                                        <Translate>Today</Translate>
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
                                            {resourceCategory ? (
                                                resourceCategory.name
                                            ) : (
                                                <Translate>
                                                    Uncategorized
                                                </Translate>
                                            )}
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
                                        {uptime === 'N/A' ? (
                                            <>
                                                <em>{uptime}</em>
                                            </>
                                        ) : (
                                            <>
                                                <em>{uptime}%</em>
                                                {' Uptime'}
                                            </>
                                        )}
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
                                {loadingData ? (
                                    <div ref={this.scrollContent}>
                                        <Translate>
                                            {statuses.length === 0
                                                ? 'calculating...'
                                                : 'loading...'}
                                        </Translate>
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

function mapStateToProps(state: RootState, ownProps: $TSFixMe) {
    const ongoing: $TSFixMe =
        state.status &&
        state.status.ongoing &&
        state.status.ongoing.ongoing &&
        state.status.ongoing.ongoing.filter(
            (ongoingSchedule: $TSFixMe) => !ongoingSchedule.cancelled
        );

    const monitorStatus: $TSFixMe = state.status.monitorStatuses[ownProps.monitor._id];

    return {
        monitorState: state.status.statusPage.monitorsData,
        checkUptime: state.status.statusPage.hideUptime,
        activeProbe: state.status.activeProbe,
        probes: state.probe.probes,
        colors: state.status.statusPage.colors,
        ongoing,
        monitorInfo: state.status.monitorInfo,
        monitorStatus,
    };
}

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
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
    monitorStatus: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    onlineText: PropTypes.string,
    offlineText: PropTypes.string,
    degradedText: PropTypes.string,
    range: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorInfo);
