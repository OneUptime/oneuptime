import React, { Component } from 'react';
import PropTypes from 'prop-types';
//import { Translate } from 'react-auto-translate';
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
import { connect } from 'react-redux';
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
                <h3>{payload[0].payload.name}</h3>
                <p className="label">{`${payload[0].name} : ${payload[0].payload.display}`}</p>
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
            default:
                return display ? `${data || 0} ${symbol || ''}` : data || 0;
        }
    }

    parseDate(a: $TSFixMe) {
        return new Date(a).toLocaleString();
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { type, data, name, symbol, colors } = this.props;
        const { strokeChart, fillChart } = colors;
        const stroke = `rgb(
            ${strokeChart.r},
            ${strokeChart.g},
            ${strokeChart.b}
        )`;
        const fill = `rgb(
            ${fillChart.r},
            ${fillChart.g},
            ${fillChart.b}
        )`;
        if (data && data.length > 0) {
            const processedData = (type === 'manual'
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
            return (
                <ResponsiveContainer width="100%" height={50}>
                    <Chart data={processedData}>
                        <Tooltip content={<CustomTooltip />} />
                        <CartesianGrid
                            horizontal={false}
                            strokeDasharray="3 3"
                        />
                        {type === 'manual' ? <YAxis reversed hide /> : ''}
                        <Area
                            type="linear"
                            isAnimationActive={false}
                            name={_.startCase(
                                _.toLower(
                                    `${
                                        type === 'manual' ? 'average' : 'max'
                                    } ${name}`
                                )
                            )}
                            dataKey="v"
                            stroke={stroke}
                            strokeWidth={1.5}
                            fill={fill}
                        />
                    </Chart>
                </ResponsiveContainer>
            );
        } else {
            return (
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ textAlign: string; flexBasis: number; }' i... Remove this comment to see the full error message
                <div style={noDataStyle}>
                    {
                        <h3>
                            We&apos;re currently in the process of collecting
                            data for this monitor. <br />
                            More info will be available in few minutes.
                        </h3>
                    }
                </div>
            );
        }
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
    colors: PropTypes.object,
};

export default connect(state => {
    const {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'DefaultR... Remove this comment to see the full error message
        status: {
            statusPage: { colors },
        },
    } = state;
    return { colors };
})(AreaChart);
