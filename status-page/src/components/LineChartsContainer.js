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
        this.props.fetchMonitorLogs(projectId, monitorId);
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
