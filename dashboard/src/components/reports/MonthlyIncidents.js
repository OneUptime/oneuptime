import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { LargeSpinner as Loader } from '../basic/Loader';
import { ResponsiveContainer, AreaChart as Chart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import {
    getMonthlyIncidents,
    getMonthlyIncidentsError,
    getMonthlyIncidentsRequest,
    getMonthlyIncidentsSuccess
} from '../../actions/reports';

const noDataStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '150px'
};

const CustomTooltip = ({ active, payload, label }) => {
    if (active) {
        return (
            <div className="custom-tooltip">
                <h3>{label}</h3>
                <p className="label">{`${payload[0].name} : ${payload && payload[0] ? payload[0].value : 0}`}</p>
            </div>
        );
    }

    return null;
};

CustomTooltip.displayName = 'CustomTooltip';

CustomTooltip.propTypes = {
    active: PropTypes.bool,
    payload: PropTypes.array,
    label: PropTypes.string
};

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
        const { months } = this.state;
        const { monthlyIncidents } = this.props;

        if (months && months.length > 0) {
            const data = months.reverse();

            return (
                <ResponsiveContainer width="100%" height={300}>
                    <Chart data={data}>
                        <Legend verticalAlign="top" height={36} />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip content={<CustomTooltip />} />
                        <CartesianGrid strokeDasharray="3 3" />
                        <Area type="linear" isAnimationActive={false} name="Incidents" dataKey="incidents" stroke="#14aad9" strokeWidth={1.5} fill="#e2e1f2" />
                    </Chart>
                </ResponsiveContainer>
            );
        } else {
            return (
                <div style={noDataStyle}>
                    {monthlyIncidents.requesting ? <Loader /> : <h3>NO MONTHLY INCIDENTS</h3>}
                </div>
            );
        }
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