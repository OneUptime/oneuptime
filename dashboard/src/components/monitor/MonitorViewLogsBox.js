import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { getMonitorLogs } from '../../actions/monitor';
import MonitorLogsList from '../monitor/MonitorLogsList';
import Select from '../../components/basic/react-select-fyipe';
import ShouldRender from '../../components/basic/ShouldRender';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import moment from 'moment';

const endDate = moment();
const startDate = moment().subtract(30, 'd');
export class MonitorViewLogsBox extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            probeValue: { value: '', label: 'All Probes' },
            startDate: startDate,
            endDate: endDate,
        };
    }

    prevClicked = (monitorId, skip, limit) => {
        const { currentProject, getMonitorLogs } = this.props;
        const incidentId = this.props.incidentId ? this.props.incidentId : null;
        const start = incidentId ? '' : this.state.startDate.clone().utc();
        const end = incidentId ? '' : this.state.endDate.clone().utc();
        getMonitorLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) - 10 : 10,
            limit,
            start,
            end,
            this.state.probeValue.value,
            incidentId
        );
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Previous Incident Requested', {
                projectId: currentProject._id,
            });
        }
    };

    nextClicked = (monitorId, skip, limit) => {
        const { currentProject, getMonitorLogs } = this.props;
        const incidentId = this.props.incidentId ? this.props.incidentId : null;
        const start = incidentId ? '' : this.state.startDate.clone().utc();
        const end = incidentId ? '' : this.state.endDate.clone().utc();
        getMonitorLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) + 10 : 10,
            limit,
            start,
            end,
            this.state.probeValue.value,
            incidentId
        );
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Next Incident Requested', {
                projectId: currentProject._id,
            });
        }
    };
    handleStartDateTimeChange = val => {
        const startDate = moment(val);
        this.handleDateChange(startDate, this.state.endDate);
    };
    handleEndDateTimeChange = val => {
        const endDate = moment(val);
        this.handleDateChange(this.state.startDate, endDate);
    };

    handleDateChange = (startDate, endDate) => {
        const { currentProject, getMonitorLogs, monitorId } = this.props;
        this.setState({
            startDate,
            endDate,
        });
        getMonitorLogs(
            currentProject._id,
            monitorId,
            0,
            10,
            startDate.clone().utc(),
            endDate.clone().utc(),
            this.state.probeValue.value
        );
    };

    handleTimeChange = (startDate, endDate) => {
        const { currentProject, getMonitorLogs, monitorId } = this.props;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            0,
            10,
            startDate.clone().utc(),
            endDate.clone().utc(),
            this.state.probeValue.value
        );
    };

    handleProbeChange = data => {
        this.setState({ probeValue: data });
        const { currentProject, getMonitorLogs, monitorId } = this.props;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            0,
            10,
            this.state.startDate.clone().utc(),
            this.state.endDate.clone().utc(),
            data.value
        );
    };

    render() {
        const probeOptions =
            this.props.probes && this.props.probes.length > 0
                ? this.props.probes.map(p => {
                      return { value: p._id, label: p.probeName };
                  })
                : [];
        probeOptions.unshift({ value: '', label: 'All Probes' });
        return (
            <div
                className="Box-root Card-shadow--medium"
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
            >
                <div className="db-Trends-header Box-background--white Box-divider--surface-bottom-1">
                    <div className="ContentHeader Box-root Box-background--white Flex-flex Flex-direction--column">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span>Monitor Logs</span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {this.props.incidentId ? (
                                        <span>
                                            Here&#39;s all of the monitor logs
                                            that created this incident.
                                        </span>
                                    ) : (
                                        <span>
                                            Here&#39;s all of the logs for the
                                            monitor created by the{' '}
                                            {this.props.monitorType ===
                                                'server-monitor' &&
                                            !this.props.agentless
                                                ? 'daemon'
                                                : 'probes'}
                                            .
                                        </span>
                                    )}
                                </span>
                            </div>
                        </div>
                    </div>
                    <ShouldRender
                        if={
                            !(
                                this.props.incidentId ||
                                (this.props.monitorType === 'server-monitor' &&
                                    !this.props.agentless)
                            )
                        }
                    >
                        <br />
                        <div className="db-Trends-controls">
                            <div className="db-Trends-timeControls">
                                <DateTimeRangePicker
                                    currentDateRange={{
                                        startDate: this.state.startDate,
                                        endDate: this.state.endDate,
                                    }}
                                    handleStartDateTimeChange={
                                        this.handleStartDateTimeChange
                                    }
                                    handleEndDateTimeChange={
                                        this.handleEndDateTimeChange
                                    }
                                    formId={'averageResolveTimeForm'}
                                    style={{
                                        height: '28px',
                                    }}
                                />
                            </div>
                            <ShouldRender
                                if={
                                    this.props.monitorType !==
                                    'incomingHttpRequest'
                                }
                            >
                                <div style={{ height: '28px', width: '250px' }}>
                                    <Select
                                        name="probe_selector"
                                        value={this.state.probeValue}
                                        onChange={this.handleProbeChange}
                                        placeholder="All Probes"
                                        className="db-select-pr"
                                        id="probe_selector"
                                        isDisabled={
                                            !(
                                                this.props.monitorLogs &&
                                                !this.props.monitorLogs
                                                    .requesting
                                            )
                                        }
                                        style={{ height: '28px' }}
                                        options={probeOptions}
                                    />
                                </div>
                            </ShouldRender>
                        </div>
                    </ShouldRender>
                </div>
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <MonitorLogsList
                        monitorId={this.props.monitorId}
                        monitorName={this.props.monitorName}
                        monitorType={this.props.monitorType}
                        agentless={this.props.agentless}
                        prevClicked={this.prevClicked}
                        nextClicked={this.nextClicked}
                    />
                </div>
            </div>
        );
    }
}

MonitorViewLogsBox.displayName = 'MonitorViewLogsBox';

MonitorViewLogsBox.propTypes = {
    currentProject: PropTypes.object,
    getMonitorLogs: PropTypes.func,
    incidentId: PropTypes.string,
    monitorId: PropTypes.string,
    monitorLogs: PropTypes.object,
    monitorName: PropTypes.string,
    monitorType: PropTypes.string,
    agentless: PropTypes.bool,
    probes: PropTypes.array,
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ getMonitorLogs }, dispatch);

function mapStateToProps(state, props) {
    const monitorId = props.monitorId ? props.monitorId : null;
    return {
        monitorLogs: monitorId ? state.monitor.monitorLogs[monitorId] : {},
        probes: state.probe.probes.data,
        currentProject: state.project.currentProject,
    };
}

MonitorViewLogsBox.contextTypes = {
    mixpanel: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewLogsBox);
