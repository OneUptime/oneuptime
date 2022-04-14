import React, { Component } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { LargeSpinner as Loader } from '../basic/Loader';
import {
    getIncidents,
    getIncidentsError,
    getIncidentsRequest,
    getIncidentsSuccess,
} from '../../actions/reports';

const noDataStyle: $TSFixMe = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '150px',
};

interface IncidentsProps {
    getIncidents?: Function;
    filter?: string;
    startDate?: object;
    endDate?: object;
    currentProject?: object | string;
    incidentReports?: object;
}

class Incidents extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            incidents: [],
        };
    }

    override componentDidMount() {
        const {

            getIncidents,

            currentProject,

            filter,

            startDate,

            endDate,
        } = this.props;

        getIncidents(currentProject, filter, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps: ComponentProps, prevstate: RootState) {
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

            endDate !== this.props.endDate ||

            currentProject !== this.props.currentProject
        ) {
            getIncidents(currentProject, filter, startDate, endDate);
        }

        if (prevState.incidents !== incidentReports.reports) {
            this.setState({
                incidents: nextProps.incidentReports.reports,
            });
        }
    }

    override render() {

        const { incidents } = this.state;

        const { incidentReports, filter } = this.props;

        const chartData: $TSFixMe = [];
        incidents.map((element: $TSFixMe) => {
            const value: $TSFixMe = {};

            value.resolveTime = element.incidents;

            value.date = element[filter];
            chartData.push(value);
            return element;
        });

        if (incidents && incidents.length > 0) {
            return (
                <>
                    <div style={{ height: 400 }}>
                        <ResponsiveBar
                            data={chartData}
                            keys={['resolveTime']}
                            indexBy="date"
                            margin={{
                                top: 50,
                                right: 50,
                                bottom: 50,
                                left: 60,
                            }}
                            borderColor={{
                                from: 'color',
                                modifiers: [['darker', 1.6]],
                            }}
                            defs={[
                                {
                                    id: 'dots',
                                    type: 'patternDots',
                                    background: 'inherit',
                                    color: '#38bcb2',
                                    size: 4,
                                    padding: 1,
                                    stagger: true,
                                },
                                {
                                    id: 'lines',
                                    type: 'patternLines',
                                    background: 'inherit',
                                    color: '#eed312',
                                    rotation: -45,
                                    lineWidth: 6,
                                    spacing: 10,
                                },
                            ]}
                            padding={0.6}
                            valueScale={{ type: 'linear' }}
                            colors="#45b2e8"
                            tooltip={point => {
                                return (
                                    <div className="custom-tooltip">
                                        {' '}
                                        <h3>{point.indexValue} </h3>{' '}
                                        <p className="label">
                                            {' '}
                                            {point.value}{' '}
                                            {point.value > 1
                                                ? 'Incidents'
                                                : 'Incident'}{' '}
                                        </p>
                                    </div>
                                );
                            }}
                            animate={true}
                            enableLabel={false}
                            axisTop={null}
                            axisRight={null}
                            axisBottom={{
                                tickSize: 5,
                                tickPadding: 5,
                                tickRotation: 0,
                                legend: 'Date',
                                legendPosition: 'middle',
                                legendOffset: 40,
                            }}
                            axisLeft={{
                                tickSize: 5,
                                tickPadding: 5,
                                tickRotation: 0,
                                legend: 'Number of Incidents',
                                legendPosition: 'middle',
                                legendOffset: -40,
                            }}
                        />
                    </div>
                    {/* <Chart
                        width={'100%'}
                        height={'400px'}
                        chartType="ColumnChart"
                        loader={<Loader />}
                        data={chartData}
                        options={{
                            animation: {
                                startup: true,
                            },
                            bar: {
                                groupWidth: barGroupWidth,
                            },
                            bars: 'vertical',
                            chartArea: { left: '5%', width: '100%' },
                            hAxis: {
                                title: 'Date',
                                textStyle: {
                                    color: '#797979',
                                },
                            },
                            vAxis: {
                                title: 'Number of Incidents',
                                minValue: 0,
                                gridlines: {
                                    minSpacing: 20,
                                    count: 5,
                                },
                                minorGridlines: {
                                    count: 0,
                                },
                                textStyle: {
                                    color: '#797979',
                                },
                            },
                            colors: ['#000000'],
                            legend: {
                                position: 'top',
                                alignment: 'center',
                                textStyle: { color: '#757575', fontSize: 16 },
                            },
                            tooltip: { isHtml: true },
                        }}
                    /> */}
                </>
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

const actionCreators: $TSFixMe = {
    getIncidents,
    getIncidentsError,
    getIncidentsRequest,
    getIncidentsSuccess,
};

const mapStateToProps: Function = (state: RootState) => ({
    incidentReports: state.report.incidents
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => ({
    ...bindActionCreators(actionCreators, dispatch)
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
