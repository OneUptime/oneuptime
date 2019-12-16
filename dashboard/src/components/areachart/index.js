import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { LargeSpinner as Loader } from '../basic/Loader';
import { ResponsiveContainer, AreaChart as Chart, Area, CartesianGrid, Tooltip } from 'recharts';
import * as _ from 'lodash';
import { formatDecimal, formatBytes } from '../../config';

const noDataStyle = {
    textAlign: 'center',
    flexBasis: 1
};

const CustomTooltip = ({ active, payload }) => {
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
    payload: PropTypes.array
};

class AreaChart extends Component {
    parseValue(data, name, display, symbol) {
        switch (name) {
            case 'load': return display ? `${formatDecimal(data.currentload, 2)} ${symbol || '%'}` : data.currentload;
            case 'memory': return display ? `${formatBytes(data.used)} ${symbol || ''}` : data.used;
            case 'disk': return display ? `${formatBytes(data.used)} ${symbol || ''}` : data.used;
            case 'temperature': return display ? `${data.main} ${symbol || '°C'}` : data.main;
            default: return display ? `${data} ${symbol || ''}` : data;
        }
    }

    parseDate(a) {
        return new Date(a).toLocaleString();
    }

    render() {
        const { type, data, name, symbol, requesting } = this.props;

        if (data && data.length > 0) {
            const _data = (type === 'server-monitor' ? data.flatMap(a => {
                const b = a.data[name], c = b.length > 0 ? b[0] : b;
                return { name: this.parseDate(a.createdAt), v: this.parseValue(c, name), display: this.parseValue(c, name, true, symbol) };
            }) : type === 'manual' ? data.map(a => {
                return { name: this.parseDate(a.date), v: this.parseValue(a.downTime), display: this.parseValue(a.downTime, null, true, symbol) };
            }) : data.map(a => {
                return { name: this.parseDate(a.createdAt), v: this.parseValue(a.responseTime), display: this.parseValue(a.responseTime, null, true, symbol) };
            })).reverse();

            return (
                <ResponsiveContainer width="100%" height={75}>
                    <Chart data={_data}>
                        <Tooltip content={<CustomTooltip />} />
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <Area type="linear" isAnimationActive={false} name={_.capitalize(name)} dataKey="v" stroke="#14aad9" strokeWidth={1.5} fill="#e2e1f2" />
                    </Chart>
                </ResponsiveContainer>
            );
        } else {
            return (
                <div style={noDataStyle}>
                    {requesting ? <Loader /> : <h3>NO DATA</h3>}
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
    requesting: PropTypes.bool
};

function mapStateToProps(state) {
    return {
        requesting: state.monitor.fetchMonitorLogsRequest
    };
}

export default connect(mapStateToProps)(AreaChart);