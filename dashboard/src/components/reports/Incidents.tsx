import React, { Component } from 'react';
import { ResponsiveBar } from '@nivo/bar';
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

const noDataStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '150px',
};

class Incidents extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            incidents: [],
        };
    }

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getIncidents' does not exist on type 'Re... Remove this comment to see the full error message
            getIncidents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filter' does not exist on type 'Readonly... Remove this comment to see the full error message
            filter,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
        } = this.props;

        getIncidents(currentProject, filter, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps: $TSFixMe, prevState: $TSFixMe) {
        const {
            getIncidents,
            currentProject,
            filter,
            startDate,
            endDate,
            incidentReports,
        } = nextProps;

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filter' does not exist on type 'Readonly... Remove this comment to see the full error message
            filter !== this.props.filter ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate !== this.props.startDate ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate !== this.props.endDate ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
        const { incidents } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentReports' does not exist on type ... Remove this comment to see the full error message
        const { incidentReports, filter } = this.props;

        const chartData: $TSFixMe = [];
        incidents.map((element: $TSFixMe) => {
            const value = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTime' does not exist on type '{}'... Remove this comment to see the full error message
            value.resolveTime = element.incidents;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'date' does not exist on type '{}'.
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Incidents.displayName = 'Incidents';

const actionCreators = {
    getIncidents,
    getIncidentsError,
    getIncidentsRequest,
    getIncidentsSuccess,
};

const mapStateToProps = (state: $TSFixMe) => ({
    incidentReports: state.report.incidents
});

const mapDispatchToProps = (dispatch: $TSFixMe) => ({
    ...bindActionCreators(actionCreators, dispatch)
});

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Incidents.propTypes = {
    getIncidents: PropTypes.func,
    filter: PropTypes.string,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    incidentReports: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(Incidents);
