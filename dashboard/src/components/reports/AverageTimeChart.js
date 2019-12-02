import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { FlatLoader as Loader } from '../basic/Loader';
import { ResponsiveContainer, AreaChart as Chart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import {
    getMonthlyResolveTime,
    getMonthlyResolveTimeError,
    getMonthlyResolveTimeRequest,
    getMonthlyResolveTimeSuccess
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
                <p className="label">{`${payload[0].name} : ${payload && payload[0] ? payload[0].value : 0} secs`}</p>
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
        const { months } = this.state;
        const { averageTime } = this.props;

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
                        <Area type="linear" isAnimationActive={false} name="Average Resolve Time" dataKey="averageResolved" stroke="#14aad9" strokeWidth={1.5} fill="#e2e1f2" />
                    </Chart>
                </ResponsiveContainer>
            );
        } else {
            return (
                <div style={noDataStyle}>
                    {averageTime.requesting ? <Loader /> : <h3>NO AVG RESOLVE TIME</h3>}
                </div>
            );
        }
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