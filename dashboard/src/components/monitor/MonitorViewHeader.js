import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import MonitorChart from './MonitorChart';
import uuid from 'uuid';
import DateRangeWrapper from './DateRangeWrapper';
import MonitorTitle from './MonitorTitle';
import moment from 'moment';
import { editMonitorSwitch, deleteMonitor } from '../../actions/monitor';
import DeleteMonitor from '../modals/DeleteMonitor';
import { FormLoader } from '../basic/Loader';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import Badge from '../common/Badge';
import ShouldRender from '../basic/ShouldRender';
import { selectedProbe } from '../../actions/monitor';
import { openModal, closeModal } from '../../actions/modal';
import { history } from '../../store';

const endDate = moment().format('YYYY-MM-DD');
const startDate = moment().subtract(30, 'd').format('YYYY-MM-DD');

export class MonitorViewHeader extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleteModalId: uuid.v4(),
            monitorStart: startDate,
            monitorEnd: endDate
        }

        this.deleteMonitor = this.deleteMonitor.bind(this);
    }

    handleMonitorChange = (startDate, endDate) => {
        this.setState({
            monitorStart: startDate,
            monitorEnd: endDate
        });
    }

    editMonitor = () => {
        this.props.editMonitorSwitch(this.props.index);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Edit Monitor Switch Clicked', {});
        }
    }

    deleteMonitor = () => {
        let promise = this.props.deleteMonitor(this.props.monitor._id, this.props.monitor.projectId._id || this.props.monitor.projectId);
        history.push(`/project/${this.props.currentProject._id}/monitoring`);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Monitor Deleted', {
                ProjectId: this.props.currentProject._id,
                monitorId: this.props.monitor._id
            });
        }
        return promise;
    }

    selectbutton = (data) => {
        this.props.selectedProbe(data);
    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId })
            default:
                return false;
        }
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

        const subProjectId = this.props.monitor.projectId._id || this.props.monitor.projectId;
        const subProject = this.props.subProjects.find(subProject => subProject._id === subProjectId);

        let { deleteModalId } = this.state;
        let deleting = false;
        if (this.props.monitorState && this.props.monitorState.deleteMonitor && this.props.monitorState.deleteMonitor === this.props.monitor._id) {
            deleting = true;
        }

        let type = this.props.monitor.type;

        return (
            <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium" onKeyDown={this.handleKeyBoard}>
                {
                    this.props.currentProject._id === subProjectId ?
                        this.props.subProjects.length > 0 ?
                            <div className="Box-root Padding-top--20 Padding-left--20">
                                <Badge color={'red'}>Project</Badge>
                            </div> :
                            null
                        :
                        <div className="Box-root Padding-top--20 Padding-left--20">
                            <Badge color={'blue'}>{subProject && subProject.name}</Badge>
                        </div>
                }
                <div className="Box-root">
                    <div className="db-Trends-header">
                        <MonitorTitle monitor={this.props.monitor} />
                        <div className="db-Trends-controls">
                            <div className="db-Trends-timeControls">
                                <DateRangeWrapper
                                    selected={this.state.monitorStart}
                                    onChange={this.handleMonitorChange}
                                    dateRange={30}
                                />
                            </div>
                            <div>
                                <RenderIfSubProjectAdmin subProjectId={subProjectId}>
                                    <button className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings' type='button' onClick={this.editMonitor}><span>Edit</span></button>
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
                            </div>
                        </div>
                    </div>
                    <ShouldRender if={this.props.monitor && this.props.monitor.probes && this.props.monitor.probes.length > 1}>
                        <ShouldRender if={type !== 'manual' && type !== 'device' && type !== 'server-monitor'}>
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
                        </ShouldRender>
                        <MonitorChart startDate={this.state.monitorStart} endDate={this.state.monitorEnd} key={uuid.v4()} monitor={this.props.monitor} showAll={true} probe={this.props.monitor && this.props.monitor.probes && this.props.monitor.probes[this.props.activeProbe]} />
                    </ShouldRender>
                    {this.props.monitor && this.props.monitor.probes && this.props.monitor.probes.length < 2 ? <MonitorChart startDate={this.state.monitorStart} endDate={this.state.monitorEnd} key={uuid.v4()} monitor={this.props.monitor} showAll={true} probe={this.props.monitor && this.props.monitor.probes && this.props.monitor.probes[0]} /> : ''}<br />
                </div>
            </div>
        );
    }
}

MonitorViewHeader.displayName = 'MonitorViewHeader'

MonitorViewHeader.propTypes = {
    monitor: PropTypes.object.isRequired,
    editMonitorSwitch: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    deleteMonitor: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    index: PropTypes.string.isRequired,
    subProjects: PropTypes.array.isRequired,
    currentProject: PropTypes.object.isRequired,
    activeProbe: PropTypes.number,
    selectedProbe: PropTypes.func.isRequired
}

const mapDispatchToProps = dispatch => bindActionCreators({
    editMonitorSwitch,
    deleteMonitor,
    selectedProbe,
    openModal,
    closeModal
}, dispatch);

const mapStateToProps = (state) => {
    return {
        monitorState: state.monitor,
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
        activeProbe: state.monitor.activeProbe,
    };
}

MonitorViewHeader.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewHeader);