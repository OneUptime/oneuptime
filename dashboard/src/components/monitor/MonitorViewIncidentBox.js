import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import IncidentList from '../incident/IncidentList';
import { fetchMonitorsIncidents } from '../../actions/monitor';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import DataPathHoC from '../DataPathHoC';
import uuid from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import { createNewIncident } from '../../actions/incident';
import CreateManualIncident from '../modals/CreateManualIncident';

export class MonitorViewIncidentBox extends Component {

    constructor(props){
        super(props);
        this.state = {
            createIncidentModalId: uuid.v4()
        }
    }

    prevClicked = () => {
        this.props.fetchMonitorsIncidents(this.props.monitor.projectId._id, this.props.monitor._id, (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) - 5) : 5), 5);
        if (window.location.href.indexOf('localhost') <= -1) {
          this.context.mixpanel.track('Previous Incident Requested', {
            projectId: this.props.monitor.projectId._id,
          });
        }
    }
    
    nextClicked = () => {
        this.props.fetchMonitorsIncidents(this.props.monitor.projectId._id, this.props.monitor._id, (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) + 5) : 5), 5);
        if (window.location.href.indexOf('localhost') <= -1) {
          this.context.mixpanel.track('Next Incident Requested', {
            projectId: this.props.monitor.projectId._id,
          });
        }
    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.createIncidentModalId })
            default:
                return false;
        }
    }
        
    render() {
        let { createIncidentModalId } = this.state;
        let creating = this.props.create ? this.props.create : false;
        return (
            <div onKeyDown={this.handleKeyBoard}>
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>
                                Incident Log
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here&#39;s a log of all of your incidents created for this monitor.
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <button className={creating ? 'bs-Button bs-Button--blue' : 'bs-Button bs-ButtonLegacy ActionIconParent'} type="button" disabled={creating}
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
                        </div>
                    </div>
                    </div>
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <IncidentList incidents={this.props.monitor} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                </div>
            </div>
        );
    }
}

MonitorViewIncidentBox.displayName = 'MonitorViewIncidentBox'

MonitorViewIncidentBox.propTypes = {
    monitor: PropTypes.object.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    create: PropTypes.bool,
    closeModal: PropTypes.func
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {fetchMonitorsIncidents, openModal, closeModal, createNewIncident}, dispatch
)

const mapStateToProps = (state) => {
    return {
        currentProject: state.project.currentProject,
        create: state.incident.newIncident.requesting,
    };
}

MonitorViewIncidentBox.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewIncidentBox);