import React, { Fragment } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { fetchMonitorLogs } from '../actions/status';
import AreaChart from './areachart';

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
        const monitorLogs = {
            requesting: true,
            name: this.props.name,
            data: [],
        };
        for (const log of this.props.logs) {
            if (log.monitorId === monitorId) {
                monitorLogs.requesting = log.requesting;
                monitorLogs.data = log.logs;
                break;
            }
        }
        if (requesting) return <div>Loading</div>;
        
        let earliestDate = data.length===0? Date.now():data[data.length-1].createdAt
        while(data.length<90){
          earliestDate=moment(earliestDate).subtract(1,'day').format();
          data.push({
            createdAt:earliestDate,
            cpuLoad:0,
            memoryUsed:0,
            storageUsed:0,
            mainTemp:0,
            responseTime:0,
          })
        }

        return (
            <Fragment>
                {this.props.name}
                <AreaChart {...monitorLogs} />
            </Fragment>
        );
    }
}

LineChartsContainer.displayName = 'LineChartsContainer';

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
