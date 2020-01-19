import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { LargeSpinner as Loader } from '../basic/Loader';
import { ResponsiveContainer, AreaChart as Chart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import {
    getIncidents,
    getIncidentsError,
    getIncidentsRequest,
    getIncidentsSuccess
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

class Incidents extends Component {
    constructor(props) {
        super(props);
        this.state = {
            incidents: []
        }
    }

    componentDidMount() {
        const { getIncidents, currentProject, filter, startDate, endDate } = this.props;

        getIncidents(currentProject, filter, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps, prevState) {
        const {
            getIncidents,
            currentProject,
            filter,
            startDate,
            endDate,
            incidentReports
        } = nextProps;

        if (filter !== this.props.filter || startDate !== this.props.startDate || endDate !== this.props.endDate) {
            getIncidents(currentProject, filter, startDate, endDate);
        }

        if (prevState.incidents !== incidentReports.reports) {
            this.setState({
                incidents: nextProps.incidentReports.reports
            });
        }
    }

    render() {
        const { incidents } = this.state;
        const { incidentReports, filter } = this.props;

        if (incidents && incidents.length > 0) {
            return (
                <ResponsiveContainer width="100%" height={300}>
                    <Chart data={incidents}>
                        <Legend verticalAlign="top" height={36} />
                        <XAxis dataKey={filter} />
                        <YAxis />
                        <Tooltip content={<CustomTooltip />} />
                        <CartesianGrid strokeDasharray="3 3" />
                        <Area type="linear" isAnimationActive={false} name="Incidents" dataKey="incidents" stroke="#000000" strokeWidth={1.5} fill="#e2e1f2" />
                    </Chart>
                </ResponsiveContainer>
            );
        } else {
            return (
                <div style={noDataStyle}>
                    {incidentReports.requesting ? <Loader /> : <h3>NO INCIDENTS</h3>}
                </div>
            );
        }
    }
}

Incidents.displayName = 'Incidents';

const actionCreators = {
    getIncidents,
    getIncidentsError,
    getIncidentsRequest,
    getIncidentsSuccess
};

const mapStateToProps = state => ({
    incidentReports: state.report.incidents
});

const mapDispatchToProps = dispatch => ({
    ...bindActionCreators(actionCreators, dispatch),
});

Incidents.propTypes = {
    getIncidents: PropTypes.func,
    filter: PropTypes.string,
    startDate: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string]),
    endDate: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string]),
    currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    incidentReports: PropTypes.object
};

export default connect(mapStateToProps, mapDispatchToProps)(Incidents);