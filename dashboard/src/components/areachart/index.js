import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { ResponsiveContainer, AreaChart as Chart, Area, CartesianGrid, Tooltip } from 'recharts';
import * as _ from 'lodash';

const noDataStyle = {
  textAlign: 'center',
  flexBasis: 1
};

const formatDecimal = (value, decimalPlaces) => {
  return Number(Math.round(parseFloat(value + 'e' + decimalPlaces)) + 'e-' + decimalPlaces).toFixed(decimalPlaces);
};

const formatBytes = (a, b, c, d, e) => {
  return formatDecimal((b = Math, c = b.log, d = 1e3, e = c(a) / c(d) | 0, a / b.pow(d, e)), 2) + ' ' + (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
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

CustomTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array
};

CustomTooltip.displayName = 'CustomTooltip';

class AreaChart extends Component {
  getValue(data, name, display, symbol) {
    switch (name) {
      case 'load': return display ? `${formatDecimal(data.currentload, 2)} ${symbol || '%'}` : data.currentload;
      case 'memory': return display ? `${formatBytes(data.used)} ${symbol || ''}` : data.used;
      case 'disk': return display ? `${formatBytes(data.used)} ${symbol || ''}` : data.used;
      case 'temperature': return display ? `${data.main} ${symbol || '°C'}` : data.main;
      default: return display ? `${data} ${symbol || ''}` : data;
    }
  }

  parseDate(a) {
    return new Date(a).toDateString();
  }

  render() {
    const { type, data, name, symbol } = this.props;

    if (data && data.length > 0) {
      const _data = type === 'server-monitor' ? data.flatMap(a => {
        const b = a.data[name];
        const c = b.length > 0 ? b[0] : b;
        return { name: this.parseDate(a.createdAt), v: this.getValue(c, name), display: this.getValue(c, name, true, symbol) };
      }).reverse() : data.map(a => {
        return { name: this.parseDate(a.createdAt), v: this.getValue(a.responseTime), display: this.getValue(a.responseTime, null, true, symbol) };
      });

      return (
        <ResponsiveContainer width="100%" height={75}>
          <Chart data={_data}>
            <Tooltip content={<CustomTooltip />} />
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <Area type="linear" name={_.capitalize(name)} dataKey="v" stroke="#14aad9" strokeWidth={2} fill="#e2e1f2" />
          </Chart>
        </ResponsiveContainer>
      );
    } else {
      return (
        <div style={noDataStyle}>
          <h3>NO DATA</h3>
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
  symbol: PropTypes.string
};

export default AreaChart;