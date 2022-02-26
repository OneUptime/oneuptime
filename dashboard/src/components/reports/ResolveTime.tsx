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
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            resolveTime: [],
        };
    }

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getResolveTime' does not exist on type '... Remove this comment to see the full error message
            getResolveTime,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'filter' does not exist on type 'Readonly... Remove this comment to see the full error message
            filter,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            startDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            endDate,
        } = this.props;

        getResolveTime(currentProject, filter, startDate, endDate);
    }

    UNSAFE_componentWillReceiveProps(nextProps: $TSFixMe, prevState: $TSFixMe) {
        const {
            getResolveTime,
            currentProject,
            filter,
            startDate,
            endDate,
            resolveTimeReports,
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
            getResolveTime(currentProject, filter, startDate, endDate);
        }

        if (prevState.resolveTime !== resolveTimeReports.reports) {
            this.setState({
                resolveTime: nextProps.resolveTimeReports.reports,
            });
        }
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTime' does not exist on type 'Rea... Remove this comment to see the full error message
        const { resolveTime } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTimeReports' does not exist on ty... Remove this comment to see the full error message
        const { resolveTimeReports, filter } = this.props;

        const chartData: $TSFixMe = [];
        resolveTime.map((element: $TSFixMe) => {
            const value = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveTime' does not exist on type '{}'... Remove this comment to see the full error message
            value.resolveTime = element.averageResolved;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'date' does not exist on type '{}'.
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ResolveTime.displayName = 'ResolveTime';

const actionCreators = {
    getResolveTime,
    getResolveTimeError,
    getResolveTimeRequest,
    getResolveTimeSuccess,
};

const mapStateToProps = (state: $TSFixMe) => ({
    resolveTimeReports: state.report.averageTime
});

const mapDispatchToProps = (dispatch: $TSFixMe) => ({
    ...bindActionCreators(actionCreators, dispatch)
});

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ResolveTime.propTypes = {
    getResolveTime: PropTypes.func,
    filter: PropTypes.string,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    currentProject: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    resolveTimeReports: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(ResolveTime);
