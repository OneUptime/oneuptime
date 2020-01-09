import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { getMonitorLogs } from '../../actions/monitor';
import MonitorLogsList from '../monitor/MonitorLogsList';
import DateTimeRangeWrapper from './DateTimeRangeWrapper';
import moment from 'moment';
import Select from 'react-select-fyipe';
import ShouldRender from '../../components/basic/ShouldRender';

export class MonitorViewLogsBox extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            startDate: props.incidentId ? '' : moment().subtract(1, 'd'),
            endDate: props.incidentId ? '' :moment(),
            probeValue: { value: '', label: 'All Probes' },
        }
    }

    prevClicked = (monitorId, skip, limit) => {
        const { currentProject,getMonitorLogs} = this.props;
        const incidentId = this.props.incidentId ? this.props.incidentId : null;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            (skip ? (parseInt(skip, 10) - 10) : 10),
            limit,
            moment(this.state.startDate).utc(),
            moment(this.state.endDate).utc(),
            this.state.probeValue.value,
            incidentId);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Previous Incident Requested', {
                projectId: currentProject._id,
            });
        }
    }

    nextClicked = (monitorId, skip, limit) => {
        const { currentProject,getMonitorLogs} = this.props;
        const incidentId = this.props.incidentId ? this.props.incidentId : null;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            (skip ? (parseInt(skip, 10) + 10) : 10),
            limit,
            moment(this.state.startDate).utc(),
            moment(this.state.endDate).utc(),
            this.state.probeValue.value,
            incidentId);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Next Incident Requested', {
                projectId: currentProject._id,
            });
        }
    }

    handleDateChange = (startDate, endDate) => {
        this.setState({ startDate, endDate });
        const { currentProject,getMonitorLogs,monitorId} = this.props;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            0,
            10,
            moment(startDate).utc(),
            moment(endDate).utc(),
            this.state.probeValue.value);
    }

    handleProbeChange = (data) => {
        this.setState({ probeValue: data });
        const { currentProject,getMonitorLogs,monitorId} = this.props;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            0,
            10,
            moment(this.state.startDate).utc(),
            moment(this.state.endDate).utc(),
            data.value);
    }

    render() {
        var probeOptions = this.props.monitorLogs && this.props.monitorLogs.probes ?
        this.props.monitorLogs.probes.map(p => {
            return { value: p._id, label: p.probeName}
        }) : [];
        probeOptions.unshift({ value: '', label: 'All Probes' });
        return (
            <div className="Box-root Card-shadow--medium" tabIndex='0' onKeyDown={this.handleKeyBoard}>
                <div className="db-Trends-header Box-background--white Box-divider--surface-bottom-1">
                    <div className="ContentHeader Box-root Box-background--white Flex-flex Flex-direction--column">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Monitor Logs
                                </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {this.props.incidentId ?
                                    <span>Here&#39;s all of the monitor logs that created this incident.</span> :
                                    <span>Here&#39;s all of the logs for the monitor created by the probes.</span>}
                                </span>
                            </div>
                        </div>
                    </div>
                    <ShouldRender if={!this.props.incidentId}>
                    <br />
                    <div className="db-Trends-controls">
                        <div className="db-Trends-timeControls">
                            <DateTimeRangeWrapper
                                selected={this.state.startDate}
                                onChange={this.handleDateChange}
                                dateRange={1}
                            />
                        </div>
                        <div style={{ height: '28px', width: '250px' }}>
                            <Select
                                name='probe_selector'
                                value={this.state.probeValue}
                                onChange={this.handleProbeChange}
                                placeholder='All Probes'
                                className="db-select-pr"
                                id='probe_selector'
                                isDisabled={!(this.props.monitorLogs && !this.props.monitorLogs.requesting)}
                                style={{ height: '28px' }}
                                options={probeOptions}
                            />
                        </div>
                    </div>
                    </ShouldRender>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <MonitorLogsList monitorId={this.props.monitorId} monitorName={this.props.monitorName} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                </div>
            </div>
        );
    }
}

MonitorViewLogsBox.displayName = 'MonitorViewLogsBox'

MonitorViewLogsBox.propTypes = {
  currentProject: PropTypes.object,
  getMonitorLogs: PropTypes.func,
  incidentId: PropTypes.string,
  monitorId: PropTypes.string,
  monitorLogs: PropTypes.object,
  monitorName: PropTypes.string
}

const mapDispatchToProps = dispatch => bindActionCreators(
    { getMonitorLogs }, dispatch
)

function mapStateToProps(state, props) {
    let monitorId = props.monitorId ? props.monitorId : null;
    return {
        monitorLogs: monitorId ? state.monitor.monitorLogs[monitorId] : {},
        currentProject: state.project.currentProject
    };
}

MonitorViewLogsBox.contextTypes = {
    mixpanel: PropTypes.object
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewLogsBox);