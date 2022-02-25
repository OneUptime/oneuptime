import React, { Component } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { LargeSpinner as Loader } from '../basic/Loader';
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

        const chartData = [];
        resolveTime.map(element => {
            const value = {};
            value.resolveTime = element.averageResolved;
            value.date = element[filter];
            chartData.push(value);
            return element;
        });

        if (resolveTime && resolveTime.length > 0) {
            return (
                <div style={{ height: 400 }}>
                    <ResponsiveBar
                        data={chartData}
                        keys={['resolveTime']}
                        indexBy="date"
                        margin={{ top: 50, right: 50, bottom: 50, left: 60 }}
                        padding={0.6}
                        valueScale={{ type: 'linear' }}
                        groupMode={'grouped'}
                        colors="#45b2e8"
                        borderColor={{
                            from: 'color',
                            modifiers: [['darker', 1.6]],
                        }}
                        tooltip={point => {
                            return (
                                <div className="custom-tooltip">
                                    {' '}
                                    <h3>{point.indexValue} </h3>{' '}
                                    <p className="label">
                                        {' '}
                                        Average Resolve Time : {
                                            point.value
                                        }{' '}
                                        secs{' '}
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
                            legend: 'Resolve Time (Minutes)',
                            legendPosition: 'middle',
                            legendOffset: -40,
                        }}
                    />
                </div>
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
