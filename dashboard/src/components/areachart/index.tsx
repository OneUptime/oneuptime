import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { Spinner } from '../basic/Loader';
import {
    ResponsiveContainer,
    AreaChart as Chart,
    Area,
    CartesianGrid,
    Tooltip,
    YAxis,
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'rech... Remove this comment to see the full error message
} from 'recharts';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import * as _ from 'lodash';
import { formatDecimal, formatBytes } from '../../config';

const noDataStyle = {
    textAlign: 'center',
    flexBasis: 1,
};

const CustomTooltip = ({
    active,
    payload
}: $TSFixMe) => {
    if (active) {
        return (
            <div className="custom-tooltip">
                {payload[0].payload.name ? (
                    <>
                        <h3>{payload[0].payload.name}</h3>
                        <p className="label">{`${payload[0].name} : ${payload[0].payload.display}`}</p>
                    </>
                ) : (
                    <h3>No data available</h3>
                )}
            </div>
        );
    }

    return null;
};

CustomTooltip.displayName = 'CustomTooltip';

CustomTooltip.propTypes = {
    active: PropTypes.bool,
    payload: PropTypes.array,
};
class AreaChart extends Component {
    parseValue(data: $TSFixMe, name: $TSFixMe, display: $TSFixMe, symbol: $TSFixMe) {
        switch (name) {
            case 'load':
                return display
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                    ? `${formatDecimal(
                          data.maxCpuLoad || data.cpuLoad || 0,
                          2
                      )} ${symbol || '%'}`
                    : data.maxCpuLoad || data.cpuLoad || 0;
            case 'memory':
                return display
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                    ? `${formatBytes(
                          data.maxMemoryUsed || data.memoryUsed || 0
                      )} ${symbol || ''}`
                    : data.maxMemoryUsed || data.memoryUsed || 0;
            case 'disk':
                return display
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 1.
                    ? `${formatBytes(
                          data.maxStorageUsed || data.storageUsed || 0
                      )} ${symbol || ''}`
                    : data.maxStorageUsed || data.storageUsed || 0;
            case 'temperature':
                return display
                    ? `${Math.round(
                          data.maxMainTemp || data.mainTemp || 0
                      )} ${symbol || '°C'}`
                    : data.maxMainTemp || data.mainTemp || 0;
            case 'response time':
                return display
                    ? `${Math.round(
                          data.maxResponseTime || data.responseTime || 0
                      )} ${symbol || 'ms'}`
                    : data.maxResponseTime || data.responseTime || 0;
            case 'pod':
                return data.kubernetesLog
                    ? display
                        ? `${Math.round(
                              this.calcPercent(
                                  data.kubernetesLog.podData.podStat.healthy,
                                  data.kubernetesLog.podData.podStat.totalPods
                              ) || 0
                          )} ${symbol || '%'}`
                        : this.calcPercent(
                              data.kubernetesLog.podData.podStat.healthy,
                              data.kubernetesLog.podData.podStat.totalPods
                          ) || 0
                    : 0;
            case 'job':
                return data.kubernetesLog
                    ? display
                        ? `${Math.round(
                              this.calcPercent(
                                  data.kubernetesLog.jobData.jobStat.healthy,
                                  data.kubernetesLog.jobData.jobStat.totalJobs
                              ) || 0
                          )} ${symbol || '%'}`
                        : this.calcPercent(
                              data.kubernetesLog.jobData.jobStat.healthy,
                              data.kubernetesLog.jobData.jobStat.totalJobs
                          ) || 0
                    : 0;
            case 'deployment':
                return data.kubernetesLog
                    ? display
                        ? `${Math.round(
                              this.calcPercent(
                                  data.kubernetesLog.deploymentData.healthy,
                                  data.kubernetesLog.deploymentData
                                      .allDeployments.length
                              ) || 0
                          )} ${symbol || '%'}`
                        : this.calcPercent(
                              data.kubernetesLog.deploymentData.healthy,
                              data.kubernetesLog.deploymentData.allDeployments
                                  .length
                          ) || 0
                    : 0;
            case 'statefulset':
                return data.kubernetesLog
                    ? display
                        ? `${Math.round(
                              this.calcPercent(
                                  data.kubernetesLog.statefulsetData.healthy,
                                  data.kubernetesLog.statefulsetData
                                      .allStatefulset.length
                              ) || 0
                          )} ${symbol || '%'}`
                        : this.calcPercent(
                              data.kubernetesLog.statefulsetData.healthy,
                              data.kubernetesLog.statefulsetData.allStatefulset
                                  .length
                          ) || 0
                    : 0;
            default:
                return display ? `${data || 0} ${symbol || ''}` : data || 0;
        }
    }

    calcPercent = (val: $TSFixMe, total: $TSFixMe) => {
        val = parseFloat(val);
        total = parseFloat(total);

        if (isNaN(val) || isNaN(total)) {
            return 0;
        }
        if (!total || total === 0) {
            return 0;
        }
        if (!val || val === 0) {
            return 0;
        }

        return (val / total) * 100;
    };

    parseDate(a: $TSFixMe) {
        return new Date(a).toLocaleString();
    }

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            type,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            name,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'symbol' does not exist on type 'Readonly... Remove this comment to see the full error message
            symbol,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initMonitorScanning' does not exist on t... Remove this comment to see the full error message
            initMonitorScanning,
        } = this.props;
        let processedData = [{ display: '', name: '', v: '' }];
        if (requesting || initMonitorScanning) {
            return (
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ textAlign: string; flexBasis: number; }' i... Remove this comment to see the full error message
                <div style={noDataStyle}>
                    <div
                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                        style={{
                            textAlign: 'center',
                            width: '100%',
                            fontSize: 14,
                            fontWeight: '500',
                            margin: 0,
                            color: '#4c4c4c',
                            lineHeight: 1.6,
                        }}
                    >
                        <Spinner style={{ stroke: '#8898aa' }} />{' '}
                        <span style={{ width: 10 }} />
                        We&apos;re currently in the process of collecting data
                        for this monitor. <br />
                        More info will be available in few minutes
                    </div>
                </div>
            );
        }

        if (data && data.length > 0) {
            processedData = (type === 'manual' ||
            type === 'incomingHttpRequest' ||
            type === 'script'
                ? data.map((a: $TSFixMe) => {
                      return {
                          name: this.parseDate(a.date),
                          // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
                          v: this.parseValue(a.downTime),
                          display: this.parseValue(
                              a.downTime,
                              null,
                              true,
                              symbol
                          ),
                      };
                  })
                : data.map((a: $TSFixMe) => {
                      return {
                          name: a.intervalDate || this.parseDate(a.createdAt),
                          // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 2.
                          v: this.parseValue(a, name),
                          display: this.parseValue(a, name, true, symbol),
                      };
                  })
            ).reverse();
        }
        return (
            <ResponsiveContainer width="100%" height={75}>
                <Chart data={processedData}>
                    <Tooltip content={<CustomTooltip />} />
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    {type === 'manual' ||
                    type === 'incomingHttpRequest' ||
                    type === 'script' ? (
                        <YAxis reversed hide />
                    ) : (
                        ''
                    )}
                    <Area
                        type="linear"
                        isAnimationActive={false}
                        name={_.startCase(
                            _.toLower(
                                `${
                                    type === 'manual' ||
                                    type === 'incomingHttpRequest' ||
                                    type === 'script'
                                        ? 'average'
                                        : 'max'
                                } ${name}`
                            )
                        )}
                        dataKey="v"
                        stroke="#000000"
                        strokeWidth={1.5}
                        fill="#e2e1f2"
                    />
                </Chart>
            </ResponsiveContainer>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AreaChart.displayName = 'AreaChart';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AreaChart.propTypes = {
    data: PropTypes.array,
    type: PropTypes.string.isRequired,
    name: PropTypes.string,
    symbol: PropTypes.string,
    requesting: PropTypes.bool,
    initMonitorScanning: PropTypes.bool,
};

function mapStateToProps(state: $TSFixMe) {
    return {
        requesting: state.monitor.fetchMonitorLogsRequest,
    };
}

export default connect(mapStateToProps)(AreaChart);
