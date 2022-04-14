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

} from 'recharts';

import * as _ from 'lodash';
import { connect } from 'react-redux';
import { formatDecimal, formatBytes } from '../../config';

const noDataStyle = {
    textAlign: 'center',
    flexBasis: 1,
};

interface CustomTooltipProps {
    active?: boolean;
    payload?: unknown[];
}

const CustomTooltip: Function = ({
    active,
    payload
}: CustomTooltipProps) => {
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

interface AreaChartProps {
    data?: unknown[];
    type: string;
    name?: string;
    symbol?: string;
    colors?: object;
}

class AreaChart extends Component<ComponentProps> {
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

                    ? `${formatBytes(
                        data.maxMemoryUsed || data.memoryUsed || 0
                    )} ${symbol || ''}`
                    : data.maxMemoryUsed || data.memoryUsed || 0;
            case 'disk':
                return display

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

    override render() {

        const { type, data, name, symbol, colors } = this.props;
        const { strokeChart, fillChart } = colors;
        const stroke:string = `rgb(
            ${strokeChart.r},
            ${strokeChart.g},
            ${strokeChart.b}
        )`;
        const fill:string = `rgb(
            ${fillChart.r},
            ${fillChart.g},
            ${fillChart.b}
        )`;
        if (data && data.length > 0) {
            const processedData: Function = (type === 'manual'
                ? data.map((a: $TSFixMe) => {
                    return {
                        name: this.parseDate(a.date),

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
                                    `${type === 'manual' ? 'average' : 'max'
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


AreaChart.displayName = 'AreaChart';


AreaChart.propTypes = {
    data: PropTypes.array,
    type: PropTypes.string.isRequired,
    name: PropTypes.string,
    symbol: PropTypes.string,
    colors: PropTypes.object,
};

export default connect(state => {
    const {

        status: {
            statusPage: { colors },
        },
    } = state;
    return { colors };
})(AreaChart);
