import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { ResponsiveContainer, AreaChart as Chart, Area, CartesianGrid, Tooltip } from 'recharts';

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
  getValue(data, name, display) {
    switch (name) {
      case 'load': return display ? `${formatDecimal(data.currentload, 2)} %` : data.currentload;
      case 'memory': return display ? `${formatBytes(data.used)}` : data.used;
      case 'disk': return display ? `${formatBytes(data.used)}` : data.used;
      case 'temperature': return display ? `${data.main} °C` : data.main;
      default: return data;
    }
  }

  parseDate(a) {
    return new Date(a).toDateString();
  }

  render() {
    const { data, name } = this.props;

    if (data && data.length > 0) {
      const _data = data.flatMap(a => {
        const b = a.data[name];
        const c = b.length > 0 ? b[0] : b;
        return { name: this.parseDate(a.createdAt), v: this.getValue(c, name), display: this.getValue(c, name, true) };
      }).splice(0, 90).reverse();

      return (
        <ResponsiveContainer width="100%" height={75}>
          <Chart data={_data}>
            <Tooltip content={<CustomTooltip />} />
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <Area type="linear" name={name} dataKey="v" stroke="#14aad9" strokeWidth={2} fill="#e2e1f2" />
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
  name: PropTypes.string
};

export default AreaChart;