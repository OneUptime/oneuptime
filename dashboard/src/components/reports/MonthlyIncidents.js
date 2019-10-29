import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux'
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  getMonthlyIncidents,
  getMonthlyIncidentsError,
  getMonthlyIncidentsRequest,
  getMonthlyIncidentsSuccess
} from '../../actions/reports';

class MonthlyIncidents extends Component {
  constructor(props) {
    super(props);
    this.state = {
      months: []
    }
  }

  componentDidMount() {
    const { getMonthlyIncidents, currentProject } = this.props;
    getMonthlyIncidents(currentProject);
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    if (this.state.months !== nextProps.monthlyIncidents.months) {
      this.setState({
        months: nextProps.monthlyIncidents.months
      })
    }
  }


  render() {
    return (
      <div>
        <BarChart
          width={1000}
          height={300}
          data={this.state.months}
          margin={{ top: 15, right: 10, left: 20, bottom: 15 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Legend verticalAlign="top" height={36} />
          <Bar dataKey="incidents" fill="#8884d8" />
        </BarChart>
      </div>
    );
  }
}

MonthlyIncidents.displayName = 'MonthlyIncidents';

const actionCreators = {
  getMonthlyIncidents,
  getMonthlyIncidentsError,
  getMonthlyIncidentsRequest,
  getMonthlyIncidentsSuccess
}

const mapStateToProps = state => ({
  monthlyIncidents: state.report.monthlyIncidents
})

const mapDispatchToProps = dispatch => ({
  ...bindActionCreators(actionCreators, dispatch),
})

MonthlyIncidents.propTypes = {
  getMonthlyIncidents: PropTypes.func,
  currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
  monthlyIncidents: PropTypes.object
};

export default connect(mapStateToProps, mapDispatchToProps)(MonthlyIncidents);
