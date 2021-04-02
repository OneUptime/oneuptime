import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { LargeSpinner as Loader } from '../basic/Loader';
import { Chart } from 'react-google-charts';
import {
    getResolveTime,
    getResolveTimeError,
    getResolveTimeRequest,
    getResolveTimeSuccess,
} from '../../actions/reports';

const noDataStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '150px',
};

class ResolveTime extends Component {
    constructor(props) {
        super(props);
        this.state = {
            resolveTime: [],
        };
    }

    componentDidMount() {
        const {
            getResolveTime,
            currentProject,
            filter,
            startDate,
            endDate,
        } = this.props;

        getResolveTime(currentProject, filter, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps, prevState) {
        const {
            getResolveTime,
            currentProject,
            filter,
            startDate,
            endDate,
            resolveTimeReports,
        } = nextProps;

        if (
            filter !== this.props.filter ||
            startDate !== this.props.startDate ||
            endDate !== this.props.endDate ||
            currentProject !== this.props.currentProject
        ) {
            getResolveTime(currentProject, filter, startDate, endDate);
        }

        if (prevState.resolveTime !== resolveTimeReports.reports) {
            this.setState({
                resolveTime: nextProps.resolveTimeReports.reports,
            });
        }
    }

    render() {
        const { resolveTime } = this.state;
        const { resolveTimeReports, filter } = this.props;
        const chartData = [
            [
                filter ? filter.charAt(0).toUpperCase() + filter.slice(1) : '',
                'Average Resolve Time',
                {
                    role: 'tooltip',
                    type: 'string',
                    p: { html: true },
                },
            ],
        ];
        resolveTime.map(element => {
            const value = [
                element[filter],
                element.averageResolved,
                `<div class="custom-tooltip"> <h3>${element[filter]} </h3> <p class="label"> Average Resolve Time : ${element.averageResolved} secs </p></div>`,
            ];
            chartData.push(value);
            return element;
        });

        // calculate each columns' width in the chart
        // for 9 or more columns, use 90%
        // for less, subtract 10% for each step-down
        const barGroupWidth = `${90 - (9 - resolveTime.length) * 10}%`;

        if (resolveTime && resolveTime.length > 0) {
            return (
                <Chart
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
                        chartArea: { left: '5%', width: '100%' },
                        hAxis: {
                            title: 'Date',
                            textStyle: {
                                color: '#797979',
                            },
                        },
                        vAxis: {
                            title: 'Resolve Time (Minutes)',

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
                />
            );
        } else {
            return (
                <div style={noDataStyle}>
                    {resolveTimeReports.requesting ? (
                        <Loader />
                    ) : (
                        <h3>NO AVG RESOLVE TIME</h3>
                    )}
                </div>
            );
        }
    }
}

ResolveTime.displayName = 'ResolveTime';

const actionCreators = {
    getResolveTime,
    getResolveTimeError,
    getResolveTimeRequest,
    getResolveTimeSuccess,
};

const mapStateToProps = state => ({
    resolveTimeReports: state.report.averageTime,
});

const mapDispatchToProps = dispatch => ({
    ...bindActionCreators(actionCreators, dispatch),
});

ResolveTime.propTypes = {
    getResolveTime: PropTypes.func,
    filter: PropTypes.string,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    resolveTimeReports: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(ResolveTime);
