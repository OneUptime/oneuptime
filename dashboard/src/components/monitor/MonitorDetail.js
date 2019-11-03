import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import IncidentList from '../incident/IncidentList';
import uuid from 'uuid';
import DateRangeWrapper from './DateRangeWrapper';
import { editMonitorSwitch, selectedProbe, fetchMonitorsIncidents } from '../../actions/monitor';
import { openModal } from '../../actions/modal';
import { createNewIncident } from '../../actions/incident';
import moment from 'moment';
import { FormLoader } from '../basic/Loader';
import CreateManualIncident from '../modals/CreateManualIncident';
import ShouldRender from '../basic/ShouldRender';
import MonitorUrl from '../modals/MonitorUrl';
import DataPathHoC from '../DataPathHoC';
import Badge from '../common/Badge';
import { history } from '../../store';
import MonitorBarChart from './MonitorBarChart';
import { Link } from 'react-router-dom';

const endDate = moment().format('YYYY-MM-DD');
const startDate = moment().subtract(30, 'd').format('YYYY-MM-DD');

export class MonitorDetail extends Component {

    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            createIncidentModalId: uuid.v4(),
            monitorStart: startDate,
            monitorEnd: endDate
        }
        this.selectbutton = this.selectbutton.bind(this);
    }

    handleMonitorChange = (startDate, endDate) => {
        this.setState({
            monitorStart: startDate,
            monitorEnd: endDate
        });
    }

    selectbutton = (data) => {
        this.props.selectedProbe(data);
    }

    prevClicked = () => {
        this.props.fetchMonitorsIncidents(this.props.monitor.projectId._id, this.props.monitor._id, (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) - 3) : 3), 3);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Previous Incident Requested', {
                ProjectId: this.props.monitor.projectId._id,
                monitorId: this.props.monitor._id,
                skip: (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) - 3) : 3)
            });
        }
    }

    nextClicked = () => {
        this.props.fetchMonitorsIncidents(this.props.monitor.projectId._id, this.props.monitor._id, (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) + 3) : 3), 3);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Next Incident Requested', {
                ProjectId: this.props.monitor.projectId._id,
                monitorId: this.props.monitor._id,
                skip: (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) + 3) : 3)
            });
        }
    }

    editMonitor = () => {
        this.props.editMonitorSwitch(this.props.index);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Edit Monitor Switch Clicked', {});
        }
    }

    handleKeyBoard = (e) => {
        let canNext = (this.props.monitor && this.props.monitor.count) && this.props.monitor.count > this.props.monitor.skip + this.props.monitor.limit ? true : false;
        let canPrev = this.props.monitor && this.props.monitor.skip <= 0 ? false : true;
        switch (e.key) {
            case 'ArrowRight':
                return canNext && this.nextClicked()
            case 'ArrowLeft':
                return canPrev && this.prevClicked()
            default:
                return false;
        }
    }

    replaceDashWithSpace = (string) => {
        return string.replace('-', ' ');
    }

    render() {
        var greenBackground = {
            display: 'inline-block',
            borderRadius: '50%',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
            backgroundColor: 'rgb(117, 211, 128)'// "green-status"
        }
        var yellowBackground = {
            display: 'inline-block',
            borderRadius: '50%',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
            backgroundColor: 'rgb(255, 222, 36)'// "yellow-status"
        }
        var redBackground = {
            display: 'inline-block',
            borderRadius: '50%',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
            backgroundColor: 'rgb(250, 117, 90)'// "red-status"
        }
        let { createIncidentModalId } = this.state;
        let creating = this.props.create ? this.props.create : false;
        let monitor = this.props.monitor;
        monitor.error = null;
        if (this.props.monitorState.monitorsList.error && this.props.monitorState.monitorsList.error.monitorId && this.props.monitor && this.props.monitor._id) {
            if (this.props.monitorState.monitorsList.error.monitorId === this.props.monitor._id) {
                monitor.error = this.props.monitorState.monitorsList.error.error
            }
        }
        monitor.success = this.props.monitorState.monitorsList.success;
        monitor.requesting = this.props.monitorState.monitorsList.requesting;

        let badgeColor;
        switch (this.props.monitor.type) {
            case 'manual':
                badgeColor = 'red';
                break;
            case 'device':
                badgeColor = 'green';
                break;
            default:
                badgeColor = 'blue';
                break;
        }
        let url = this.props.monitor && this.props.monitor.data && this.props.monitor.data.url ? this.props.monitor.data.url : null;
        let probeUrl = `/project/${this.props.monitor.projectId._id}/settings/probe`;

        return (
            <div className="Box-root Card-shadow--medium" tabIndex='0' onKeyDown={this.handleKeyBoard}>
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                        <span id={`monitor_title_${this.props.monitor.name}`}>
                                            {this.props.monitor.name}
                                        </span>
                                    </span>
                                    <ShouldRender if={this.props.monitor && this.props.monitor.type}>
                                        {
                                            this.props.monitor.type === 'url' || this.props.monitor.type === 'api' || this.props.monitor.type === 'script' ?
                                                <ShouldRender if={this.props.monitor.probes && !this.props.monitor.probes.length > 0}>
                                                    <span className="Text-fontSize--14">This monitor cannot be monitored because there are are 0 probes. You can view probes <Link to={probeUrl}>here</Link></span>
                                                </ShouldRender>
                                                : ''
                                        }
                                    </ShouldRender>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        {url && <span>
                                            Monitor for &nbsp;
                                        <a href={url}>{url}</a>
                                        </span>}
                                    </span>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                    <div className="Box-root">
                                        <Badge color={badgeColor}>{this.replaceDashWithSpace(this.props.monitor.type)}</Badge>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    {
                        this.props.monitor && this.props.monitor.type ?
                            this.props.monitor.type === 'url' || this.props.monitor.type === 'api' || this.props.monitor.type === 'script' ?
                                <ShouldRender if={this.props.monitor.probes && this.props.monitor.probes.length > 0}>
                                    <div className="db-Trends-controls">
                                        <div className="db-Trends-timeControls">
                                            <DateRangeWrapper
                                                selected={this.state.monitorStart}
                                                onChange={this.handleMonitorChange}
                                                dateRange={30}
                                            />
                                        </div>
                                        <div>
                                            <button className={creating ? 'bs-Button bs-Button--blue' : 'bs-Button bs-ButtonLegacy ActionIconParent'} type="button" disabled={creating}
                                                id={`create_incident_${this.props.monitor.name}`}
                                                onClick={() =>
                                                    this.props.openModal({
                                                        id: createIncidentModalId,
                                                        content: DataPathHoC(CreateManualIncident, { monitorId: this.props.monitor._id, projectId: this.props.monitor.projectId._id })
                                                    })}>
                                                <ShouldRender if={!creating}>
                                                    <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                        <span>Create New Incident</span>
                                                    </span>
                                                </ShouldRender>
                                                <ShouldRender if={creating}>
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                            <button id={`more_details_${this.props.monitor.name}`} className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help' type='button' onClick={() => { history.push('/project/' + this.props.currentProject._id + '/monitors/' + this.props.monitor._id) }}><span>More</span></button>
                                        </div>
                                    </div>
                                </ShouldRender> :
                                <div className="db-Trends-controls">
                                    <div className="db-Trends-timeControls">
                                        <DateRangeWrapper
                                            selected={this.state.monitorStart}
                                            onChange={this.handleMonitorChange}
                                            dateRange={30}
                                        />
                                    </div>
                                    <div>
                                        {this.props.monitor.type === 'device' &&
                                            <button
                                                className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--eye' type='button'
                                                onClick={() =>
                                                    this.props.openModal({
                                                        id: this.props.monitor._id,
                                                        onClose: () => '',
                                                        content: DataPathHoC(MonitorUrl, this.props.monitor)
                                                    })
                                                }
                                            >
                                                <span>Show URL</span>
                                            </button>
                                        }

                                        <button className={creating ? 'bs-Button bs-Button--blue' : 'bs-Button bs-ButtonLegacy ActionIconParent'} type="button" disabled={creating}
                                            id={`create_incident_${this.props.monitor.name}`}
                                            onClick={() =>
                                                this.props.openModal({
                                                    id: createIncidentModalId,
                                                    content: DataPathHoC(CreateManualIncident, { monitorId: this.props.monitor._id, projectId: this.props.monitor.projectId._id })
                                                })}>
                                            <ShouldRender if={!creating}>
                                                <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                    <span>Create New Incident</span>
                                                </span>
                                            </ShouldRender>
                                            <ShouldRender if={creating}>
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                        <button id={`more_details_${this.props.monitor.name}`} className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help' type='button' onClick={() => { history.push('/project/' + this.props.currentProject._id + '/monitors/' + this.props.monitor._id) }}><span>More</span></button>
                                    </div>
                                </div> : ''
                    }
                </div>
                <ShouldRender if={this.props.monitor && this.props.monitor.probes && this.props.monitor.probes.length > 1}>
                    <div className="btn-group">
                        {this.props.monitor && this.props.monitor.probes.map((location, index) => (<button
                            key={`probes-btn${index}`}
                            id={`probes-btn${index}`}
                            disabled={false}
                            onClick={() => this.selectbutton(index)}
                            className={this.props.activeProbe === index ? 'icon-container selected' : 'icon-container'}>
                            <span style={location.status === 'offline' ? redBackground : location.status === 'degraded' ? yellowBackground : greenBackground}></span>
                            <span>{location.probeName}</span>
                        </button>)
                        )}
                    </div>
                    <MonitorBarChart startDate={this.state.monitorStart} endDate={this.state.monitorEnd} key={uuid.v4()} probe={this.props.monitor && this.props.monitor.probes && this.props.monitor.probes[this.props.activeProbe]} monitor={this.props.monitor} />
                </ShouldRender>

                {this.props.monitor && this.props.monitor.type ?
                    this.props.monitor.type === 'url' || this.props.monitor.type === 'api' || this.props.monitor.type === 'script' ?
                        <div>
                            <ShouldRender if={this.props.monitor.probes && this.props.monitor.probes.length > 0}>
                                {this.props.monitor && this.props.monitor.probes && this.props.monitor.probes.length < 2 ? <MonitorBarChart startDate={this.state.monitorStart} endDate={this.state.monitorEnd} key={uuid.v4()} probe={this.props.monitor && this.props.monitor.probes && this.props.monitor.probes[0]} monitor={this.props.monitor} /> : ''}
                                <div className="db-RadarRulesLists-page">
                                    <div className="Box-root Margin-bottom--12">
                                        <div className="">
                                            <div className="Box-root">
                                                <div>
                                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center"><span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span><span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>Heres a list of recent incidents which belong to this monitor.</span></span></div>
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <IncidentList incidents={monitor} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </ShouldRender>
                            <ShouldRender if={this.props.monitor.probes && !this.props.monitor.probes.length > 0}>
                                <div class="Margin-bottom--12"></div>
                            </ShouldRender>
                        </div>
                        :
                        <div>
                            {this.props.monitor && this.props.monitor.probes && this.props.monitor.probes.length < 2 ? <MonitorBarChart startDate={this.state.monitorStart} endDate={this.state.monitorEnd} key={uuid.v4()} probe={this.props.monitor && this.props.monitor.probes && this.props.monitor.probes[0]} monitor={this.props.monitor} /> : ''}
                            <div className="db-RadarRulesLists-page">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center"><span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span><span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>Heres a list of recent incidents which belong to this monitor.</span></span></div>
                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <IncidentList incidents={monitor} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    : ''
                }

            </div>
        )
    }
}

MonitorDetail.displayName = 'MonitorDetail'

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        editMonitorSwitch,
        openModal,
        fetchMonitorsIncidents,
        createNewIncident,
        selectedProbe,
    }, dispatch)
}


function mapStateToProps(state) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        create: state.incident.newIncident.requesting,
        subProject: state.subProject,
        activeProbe: state.monitor.activeProbe,
    };
}

MonitorDetail.propTypes = {
    currentProject: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    editMonitorSwitch: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    index: PropTypes.string,
    openModal: PropTypes.func,
    create: PropTypes.bool,
    selectedProbe: PropTypes.func.isRequired,
    activeProbe: PropTypes.number
}

MonitorDetail.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorDetail);
