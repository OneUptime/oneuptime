import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { LargeSpinner as Loader } from '../basic/Loader';
import {
    getIncidents,
    getIncidentsError,
    getIncidentsRequest,
    getIncidentsSuccess,
} from '../../actions/reports';
import { Chart } from 'react-google-charts';

const noDataStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '150px',
};

class Incidents extends Component {
    constructor(props) {
        super(props);
        this.state = {
            incidents: [],
        };
    }

    componentDidMount() {
        const {
            getIncidents,
            currentProject,
            filter,
            startDate,
            endDate,
        } = this.props;

        getIncidents(currentProject, filter, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps, prevState) {
        const {
            getIncidents,
            currentProject,
            filter,
            startDate,
            endDate,
            incidentReports,
        } = nextProps;

        if (
            filter !== this.props.filter ||
            startDate !== this.props.startDate ||
            endDate !== this.props.endDate
        ) {
            getIncidents(currentProject, filter, startDate, endDate);
        }

        if (prevState.incidents !== incidentReports.reports) {
            this.setState({
                incidents: nextProps.incidentReports.reports,
            });
        }
    }

    render() {
        const { incidents } = this.state;
        const { incidentReports, filter } = this.props;
        const areaChartData = [
            [
                filter ? filter.charAt(0).toUpperCase() + filter.slice(1) : '',
                'Incidents',
                {
                    role: 'tooltip',
                    type: 'string',
                    p: { html: true },
                },
            ],
        ];
        incidents.map(element => {
            const value = [
                element[filter],
                element.incidents,
                `<div class="custom-tooltip"> <h3>${
                    element[filter]
                } </h3> <p class="label"> ${element.incidents} ${
                    element.incidents > 1 ? 'Incidents' : 'Incident'
                } </p></div>`,
            ];
            areaChartData.push(value);
            return element;
        });

        if (incidents && incidents.length > 0) {
            return (
                <Chart
                    width={'100%'}
                    height={'400px'}
                    chartType="AreaChart"
                    loader={<Loader />}
                    data={areaChartData}
                    options={{
                        animation: {
                            startup: true,
                        },
                        hAxis: {
                            textStyle: {
                                color: '#757575',
                            },
                        },
                        vAxis: {
                            minValue: 0,
                            gridlines: {
                                minSpacing: 20,
                                count: 5,
                            },
                            minorGridlines: {
                                count: 0,
                            },
                            textStyle: {
                                color: '#757575',
                            },
                        },
                        // For the legend to fit, we make the chart area smaller
                        chartArea: {
                            width: '70%',
                            height: '70%',
                        },
                        // lineWidth: 25
                        colors: ['#000000'],
                        lineWidth: '1.5',
                        legend: {
                            position: 'top',
                            alignment: 'center',
                            textStyle: { color: '#757575', fontSize: 16 },
                        },
                        tooltip: { isHtml: true },
                    }}
                />
            );
        } else {
            return (
                <div style={noDataStyle}>
                    {incidentReports.requesting ? (
                        <Loader />
                    ) : (
                        <h3>NO INCIDENTS</h3>
                    )}
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
    getIncidentsSuccess,
};

const mapStateToProps = state => ({
    incidentReports: state.report.incidents,
});

const mapDispatchToProps = dispatch => ({
    ...bindActionCreators(actionCreators, dispatch),
});

Incidents.propTypes = {
    getIncidents: PropTypes.func,
    filter: PropTypes.string,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    incidentReports: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(Incidents);
