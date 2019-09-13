import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import IncidentList from '../incident/IncidentList';
import uuid from 'uuid';
import { editMonitorSwitch, deleteMonitor, fetchMonitorsIncidents } from '../../actions/monitor';
import { openModal, closeModal } from '../../actions/modal';
import { createNewIncident } from '../../actions/incident';
import DeleteMonitor from '../modals/DeleteMonitor';
import moment from 'moment';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import { FormLoader } from '../basic/Loader';
import CreateManualIncident from '../modals/CreateManualIncident';
import ShouldRender from '../basic/ShouldRender';
import MonitorUrl from '../modals/MonitorUrl';
import DataPathHoC from '../DataPathHoC';
import Badge from '../common/Badge';
import { history } from '../../store';
import MonitorBarChart from './MonitorBarChart';



export class MonitorDetail extends Component {

    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleteModalId: uuid.v4(),
            createIncidentModalId: uuid.v4()
        }
        this.deleteMonitor = this.deleteMonitor;
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

    deleteMonitor = () => {
        let promise = this.props.deleteMonitor(this.props.monitor._id, this.props.monitor.projectId._id || this.props.monitor.projectId);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Monitor Deleted', {
                ProjectId: this.props.currentProject._id,
                monitorId: this.props.monitor._id
            });
        }
        return promise;
    }

    handleKeyBoard = (e) => {
        let canNext = (this.props.monitor && this.props.monitor.count) && this.props.monitor.count > this.props.monitor.skip + this.props.monitor.limit ? true : false;
        let canPrev = this.props.monitor && this.props.monitor.skip <= 0 ? false : true;
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId })
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
        let { createIncidentModalId, deleteModalId } = this.state;
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
        var enddate = new Date();
        var startdate = new Date().setDate(enddate.getDate() - 90);

        let deleting = false;
        if (this.props.monitorState && this.props.monitorState.deleteMonitor && this.props.monitorState.deleteMonitor === this.props.monitor._id) {
            deleting = true;
        }

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
                    <div className="db-Trends-controls">
                        <div className="db-Trends-timeControls">

                            <div className="db-DateRangeInputWithComparison">
                                <div className="db-DateRangeInput bs-Control" style={{ cursor: 'default' }}>
                                    <div className="db-DateRangeInput-input" role="button" tabIndex="0" style={{ cursor: 'default' }}>
                                        <span className="db-DateRangeInput-start" style={{ padding: '3px' }}>{moment(startdate).format('ll')}</span>
                                        <span className="db-DateRangeInput-input-arrow" style={{ padding: '3px' }}></span>
                                        <span className="db-DateRangeInput-end" style={{ padding: '3px' }}>{moment(enddate).format('ll')}</span></div>
                                </div>
                            </div>
                        </div>
                        <div>
                            {this.props.monitor.type === 'device' &&
                                <button
                                    className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--eye' type='button'
                                    disabled={deleting}
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
                            <button id={`more_details_${this.props.monitor.name}`} className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help' type='button' onClick={() => { history.push('/project/' + this.props.currentProject._id + '/monitors/' + this.props.monitor._id) }}><span>More</span></button>

                                    <button className={creating ? 'bs-Button bs-Button--blue' : 'bs-Button bs-ButtonLegacy ActionIconParent'} type="button" disabled={creating}
                                        id={`create_incident_${this.props.monitor.name}`}
                                        onClick={() =>
                                            this.props.openModal({
                                                id: createIncidentModalId,
                                                monitorId: this.props.monitor._id,
                                                content: DataPathHoC(CreateManualIncident)
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
                            <RenderIfSubProjectAdmin subProjectId={this.props.monitor.projectId._id || this.props.monitor.projectId}>
                                <button id={`edit_${this.props.monitor.name}`} className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings' type='button' disabled={deleting} onClick={this.editMonitor}><span>Edit</span></button>
                                <button id={`delete_${this.props.monitor.name}`} className={deleting ? 'bs-Button bs-Button--blue' : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete'} type="button" disabled={deleting}
                                    onClick={() =>
                                        this.props.openModal({
                                            id: deleteModalId,
                                            onClose: () => '',
                                            onConfirm: () => this.deleteMonitor(),
                                            content: DeleteMonitor
                                        })}>
                                    <ShouldRender if={!deleting}>
                                        <span>Delete</span>
                                    </ShouldRender>
                                    <ShouldRender if={deleting}>
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                            </RenderIfSubProjectAdmin>
                        </div></div>
                </div>

                <MonitorBarChart key={uuid.v4()} monitor={this.props.monitor} />

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
        )
    }
}

MonitorDetail.displayName = 'MonitorDetail'

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ editMonitorSwitch, deleteMonitor, openModal, closeModal, fetchMonitorsIncidents, createNewIncident }, dispatch)
}


function mapStateToProps(state) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        create: state.incident.newIncident.requesting,
        subProject: state.subProject
    };
}

MonitorDetail.propTypes = {
    currentProject: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    editMonitorSwitch: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    deleteMonitor: PropTypes.func.isRequired,
    index: PropTypes.number.isRequired,
    openModal: PropTypes.func,
    create: PropTypes.bool,
    closeModal: PropTypes.func
}

MonitorDetail.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorDetail);
