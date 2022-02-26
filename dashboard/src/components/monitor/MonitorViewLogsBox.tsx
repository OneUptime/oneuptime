import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { getMonitorLogs } from '../../actions/monitor';
import MonitorLogsList from '../monitor/MonitorLogsList';
import Select from '../../components/basic/Select';
import ShouldRender from '../../components/basic/ShouldRender';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import moment from 'moment';

const endDate = moment();
const startDate = moment().subtract(1, 'd');
export class MonitorViewLogsBox extends Component {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            probeValue: { value: '', label: 'All Probes' },
            startDate: startDate,
            endDate: endDate,
            page: 1,
        };
    }

    prevClicked = (monitorId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, getMonitorLogs } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
        const incidentId = this.props.incidentId ? this.props.incidentId : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
        const start = incidentId ? '' : this.state.startDate.clone().utc();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
        const end = incidentId ? '' : this.state.endDate.clone().utc();
        getMonitorLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) - 10 : 10,
            limit,
            start,
            end,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeValue' does not exist on type 'Read... Remove this comment to see the full error message
            this.state.probeValue.value,
            incidentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.monitorType
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page - 1 });
    };

    nextClicked = (monitorId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, getMonitorLogs } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
        const incidentId = this.props.incidentId ? this.props.incidentId : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
        const start = incidentId ? '' : this.state.startDate.clone().utc();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
        const end = incidentId ? '' : this.state.endDate.clone().utc();
        getMonitorLogs(
            currentProject._id,
            monitorId,
            skip ? parseInt(skip, 10) + 10 : 10,
            limit,
            start,
            end,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeValue' does not exist on type 'Read... Remove this comment to see the full error message
            this.state.probeValue.value,
            incidentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.monitorType
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };
    handleStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.handleDateChange(startDate, this.state.endDate);
    };
    handleEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
        this.handleDateChange(this.state.startDate, endDate);
    };

    handleDateChange = (startDate: $TSFixMe, endDate: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeValue' does not exist on type 'Read... Remove this comment to see the full error message
            this.state.probeValue.value,
            null,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.monitorType
        );
    };

    handleTimeChange = (startDate: $TSFixMe, endDate: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, getMonitorLogs, monitorId } = this.props;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            0,
            10,
            startDate.clone().utc(),
            endDate.clone().utc(),
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeValue' does not exist on type 'Read... Remove this comment to see the full error message
            this.state.probeValue.value,
            null,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.monitorType
        );
    };

    handleProbeChange = (data: $TSFixMe) => {
        this.setState({ probeValue: data });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, getMonitorLogs, monitorId } = this.props;
        getMonitorLogs(
            currentProject._id,
            monitorId,
            0,
            10,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
            this.state.startDate.clone().utc(),
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.state.endDate.clone().utc(),
            data.value,
            null,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.monitorType
        );
    };

    render() {
        const probeOptions =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.probes && this.props.probes.length > 0
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
                ? this.props.probes.map((p: $TSFixMe) => {
                      return { value: p._id, label: p.probeName };
                  })
                : [];
        probeOptions.unshift({ value: '', label: 'All Probes' });
        return (
            <div
                className="Box-root Card-shadow--medium"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
                                    {this.props.incidentId ? (
                                        <span>
                                            Here&#39;s all of the monitor logs
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type 'Rea... Remove this comment to see the full error message
                                            of {this.props.monitorName} that
                                            created this incident.
                                        </span>
                                    ) : (
                                        <span>
                                            Here&#39;s all of the logs for the
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type 'Rea... Remove this comment to see the full error message
                                            monitor {this.props.monitorName}{' '}
                                            created by the{' '}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
                                            {this.props.monitorType ===
                                                'server-monitor' &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'agentless' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'Read... Remove this comment to see the full error message
                                this.props.incidentId ||
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
                                (this.props.monitorType === 'server-monitor' &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'agentless' does not exist on type 'Reado... Remove this comment to see the full error message
                                    !this.props.agentless)
                            )
                        }
                    >
                        <br />
                        <div className="db-Trends-controls">
                            <div className="db-Trends-timeControls">
                                <DateTimeRangePicker
                                    currentDateRange={{
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type 'Reado... Remove this comment to see the full error message
                                        startDate: this.state.startDate,
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
                                    this.props.monitorType !==
                                    'incomingHttpRequest'
                                }
                            >
                                <div style={{ height: '28px', width: '250px' }}>
                                    <Select
                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ name: string; value: any; onChange: (data:... Remove this comment to see the full error message
                                        name="probe_selector"
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeValue' does not exist on type 'Read... Remove this comment to see the full error message
                                        value={this.state.probeValue}
                                        onChange={this.handleProbeChange}
                                        placeholder="All Probes"
                                        className="db-select-pr"
                                        id="probe_selector"
                                        isDisabled={
                                            !(
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorLogs' does not exist on type 'Rea... Remove this comment to see the full error message
                                                this.props.monitorLogs &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorLogs' does not exist on type 'Rea... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
                        monitorId={this.props.monitorId}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorName' does not exist on type 'Rea... Remove this comment to see the full error message
                        monitorName={this.props.monitorName}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorType' does not exist on type 'Rea... Remove this comment to see the full error message
                        monitorType={this.props.monitorType}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'agentless' does not exist on type 'Reado... Remove this comment to see the full error message
                        agentless={this.props.agentless}
                        prevClicked={this.prevClicked}
                        nextClicked={this.nextClicked}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        page={this.state.page}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                        projectId={this.props.projectId}
                    />
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorViewLogsBox.displayName = 'MonitorViewLogsBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
    projectId: PropTypes.string,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ getMonitorLogs }, dispatch);

function mapStateToProps(state: $TSFixMe, props: $TSFixMe) {
    const monitorId = props.monitorId ? props.monitorId : null;
    return {
        monitorLogs: monitorId ? state.monitor.monitorLogs[monitorId] : {},
        probes: state.probe.probes.data,
        currentProject: state.project.currentProject,
    };
}

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
MonitorViewLogsBox.contextTypes = {};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewLogsBox);
