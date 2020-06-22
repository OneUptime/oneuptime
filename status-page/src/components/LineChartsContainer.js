import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import moment from 'moment';
import { fetchMonitorLogs } from '../actions/status';
import AreaChart from './areachart';

const ChartContainer = ({ label, name, data }) => (
    <Fragment>
        {label}
        <AreaChart name={name} data={data} />
    </Fragment>
);

ChartContainer.displayName = 'ChartContainer';

ChartContainer.propTypes = {
    label: PropTypes.string,
    name: PropTypes.string,
    data: PropTypes.array.isRequired,
};

class LineChartsContainer extends React.Component {
    async componentDidMount() {
        const {
            _id: monitorId,
            projectId: { _id: projectId },
        } = this.props.monitor;
        const {
            memory,
            cpu,
            storage,
            responseTime,
            temperature,
        } = this.props.selectedCharts;
        const data = {
            memory,
            cpu,
            storage,
            responseTime,
            temperature,
        };
        this.props.fetchMonitorLogs(projectId, monitorId, data);
    }
    render() {
        const { _id: monitorId } = this.props.monitor;
        let requesting = true;
        let data = [];
        for (const log of this.props.logs) {
            if (log.monitorId === monitorId) {
                requesting = log.requesting;
                data = log.logs;
                break;
            }
        }

        if (requesting) return null;

        let earliestDate =
            data.length === 0 ? Date.now() : data[data.length - 1].createdAt;
        while (data.length < 90) {
            earliestDate = moment(earliestDate)
                .subtract(1, 'day')
                .format();
            data.push({
                createdAt: earliestDate,
                cpuLoad: 0,
                memoryUsed: 0,
                storageUsed: 0,
                mainTemp: 0,
                responseTime: 0,
            });
        }

        return (
            <Fragment>
                {this.props.selectedCharts.memory && (
                    <ChartContainer label="Memory" name="memory" data={data} />
                )}
                {this.props.selectedCharts.cpu && (
                    <ChartContainer label="CPU" name="load" data={data} />
                )}
                {this.props.selectedCharts.storage && (
                    <ChartContainer label="Storage" name="disk" data={data} />
                )}
                {this.props.selectedCharts.responseTime && (
                    <ChartContainer
                        label="Response time"
                        name="response time"
                        data={data}
                    />
                )}
                {this.props.selectedCharts.temperature && (
                    <ChartContainer
                        label="Temperature"
                        name="temperature"
                        data={data}
                    />
                )}
                {this.props.selectedCharts.runtime && (
                    <ChartContainer
                        label="Runtime"
                        name="runtime"
                        data={data}
                    />
                )}
            </Fragment>
        );
    }
}

LineChartsContainer.displayName = 'LineChartsContainer';

LineChartsContainer.propTypes = {
    monitor: PropTypes.object,
    selectedCharts: PropTypes.object.isRequired,
    fetchMonitorLogs: PropTypes.func.isRequired,
    logs: PropTypes.array.isRequired,
};

const mapStateToProps = state => {
    const {
        status: { logs },
    } = state;
    return { logs };
};
const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchMonitorLogs,
        },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(LineChartsContainer);
