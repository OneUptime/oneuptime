import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import MonitorBarChart from './MonitorBarChart';
import MonitorTitle from './MonitorTitle';
import moment from 'moment';
import { editMonitorSwitch } from '../../actions/monitor';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import Badge from '../common/Badge';

export class MonitorViewHeader extends Component {

    editMonitor = () => {
        this.props.editMonitorSwitch(this.props.index);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Edit Monitor Switch Clicked', {});
        }
    }

    render() {
        var enddate = new Date();
        var startdate = new Date().setDate(enddate.getDate() - 90);
        const subProjectId = this.props.monitor.projectId._id || this.props.monitor.projectId;
        const subProject = this.props.subProjects.find(subProject => subProject._id === subProjectId);
        return (
            <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium">
                {   
                    this.props.currentProject._id === subProjectId ?
                        <div className="Box-root Padding-top--20 Padding-left--20">
                            <Badge color={'red'}>Project</Badge>
                        </div> :
                        <div className="Box-root Padding-top--20 Padding-left--20">
                            <Badge color={'blue'}>{subProject && subProject.name}</Badge>
                        </div>
                }
                <div className="Box-root">
                    <div className="db-Trends-header">
                        <MonitorTitle monitor={ this.props.monitor } />
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
                                <RenderIfSubProjectAdmin subProjectId={subProjectId}>
                                    <button className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings' type='button' onClick={this.editMonitor}><span>Edit</span></button>
                                </RenderIfSubProjectAdmin>
                            </div>
                        </div>
                    </div>
                    <MonitorBarChart monitor={ this.props.monitor } /><br />
                </div>
            </div>
        );
    }
}

MonitorViewHeader.displayName = 'MonitorViewHeader'

MonitorViewHeader.propTypes = {
    monitor: PropTypes.object.isRequired,
    editMonitorSwitch: PropTypes.func.isRequired,
    index: PropTypes.string.isRequired,
    subProjects: PropTypes.array.isRequired,
    currentProject: PropTypes.object.isRequired,
}

const mapDispatchToProps = dispatch => bindActionCreators(
    { editMonitorSwitch }, dispatch
)

const mapStateToProps = (state) => {
    return {
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
    };
}

MonitorViewHeader.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewHeader);