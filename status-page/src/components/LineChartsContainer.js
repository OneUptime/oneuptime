import React, { Fragment } from 'react';
import { fetchMonitorLogs } from '../actions/status';
import AreaChart from './areachart'

class ChartContainer extends React.Component {
  constructor() {
    super();
    this.state = {
      loading: true,
      data: []
    }
  }
  async componentDidMount() {
    const { _id: monitorId, projectId: { _id: projectId } } = this.props.monitor
    const result = await fetchMonitorLogs(projectId, monitorId, 100)()
    const data = (result.data[0] && result.data[0].logs) || []
    console.log(data)
    this.setState({
      // loading: false,
      data,
    })
  }
  render() {
    const { loading, data } = this.state
    if (loading) {
      return (
        <div>
        </div>
      )
    } else {
      return (
        <Fragment>
          {this.props.name}
          <AreaChart
            data={data}
            name={this.props.name}
          />
        </Fragment>
      )
    }
  }
}

export default ChartContainer;