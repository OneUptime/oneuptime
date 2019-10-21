import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux'
import { Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import {
  getMonthlyResolveTime,
  getMonthlyResolveTimeError,
  getMonthlyResolveTimeRequest,
  getMonthlyResolveTimeSuccess
} from '../../actions/reports';

class CustomTooltip extends Component {


  render() {
    const { active } = this.props;

    if (active) {
      const { payload, label } = this.props;
      return (
        <div style={{ width: '100%', height: '100%', }} className="custom-tooltip">
          <p className="intro">{label}</p>
          <p className="label" style={{ color: '#8884d8' }}>{`average-resolve-time : ${payload && payload[0] ? payload[0].value : 0} secs`}</p>
        </div>
      );
    }

    return null;
  }
}

CustomTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  label: PropTypes.string
}

CustomTooltip.displayName = 'CustomTooltip'

class AverageTimeChart extends Component {
  constructor(props) {
    super(props);
    this.state = {
      months: []
    }
  }

  componentDidMount() {
    const { getMonthlyResolveTime, currentProject } = this.props;
    getMonthlyResolveTime(currentProject);
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    if (this.state.months !== nextProps.averageTime.months) {
      this.setState({
        months: nextProps.averageTime.months
      })
    }
  }

  render() {
    return (
      <div>
        <LineChart width={1000} height={300} data={this.state.months}
          margin={{ top: 15, right: 10, left: 20, bottom: 15 }}>
          <XAxis dataKey="month" padding={{ left: 30, right: 30 }} />
          <YAxis />
          <CartesianGrid strokeDasharray="3 3" />
          <Tooltip content={<CustomTooltip />} />
          <Legend verticalAlign="top" height={36} />
          <Line type="monotone" dataKey="averageResolved" stroke="#8884d8" activeDot={{ r: 8 }} />
        </LineChart>
      </div>
    );
  }
}

AverageTimeChart.displayName = 'AverageTimeChart';

const actionCreators = {
  getMonthlyResolveTime,
  getMonthlyResolveTimeError,
  getMonthlyResolveTimeRequest,
  getMonthlyResolveTimeSuccess
}

const mapStateToProps = state => ({
  averageTime: state.report.averageTime
})

const mapDispatchToProps = dispatch => ({
  ...bindActionCreators(actionCreators, dispatch),
})

AverageTimeChart.propTypes = {
  getMonthlyResolveTime: PropTypes.func,
  currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
  averageTime: PropTypes.object
};

export default connect(mapStateToProps, mapDispatchToProps)(AverageTimeChart);