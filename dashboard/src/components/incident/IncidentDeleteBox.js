import uuid from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import DeleteIncident from '../modals/DeleteIncident';
import { deleteIncident } from '../../actions/incident';
import { history } from '../../store';
import DataPathHoC from '../DataPathHoC';

export class IncidentDeleteBox extends Component {

    constructor(props) {
        super(props);
        this.state = { deleteModalId: uuid.v4() }
    }

    deleteIncident = () => {
        const projectId = this.props.incident.projectId._id || this.props.incident.projectId;
        const incidentId = this.props.incident._id;

        let promise = this.props.deleteIncident(projectId, incidentId);
        promise.then(()=>{
            history.push(`/project/${this.props.currentProject._id}/monitoring`);
            if (window.location.href.indexOf('localhost') <= -1) {
                this.context.mixpanel.track('Incident Deleted', {
                    projectId,
                    incidentId
                });
            }
        })
       return promise;
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

        
        const { deleting } = this.props;
        const { deleteModalId } = this.state;

        return (
            <div onKeyDown={this.handleKeyBoard} className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Delete This Incident
                                    </span>
                                </span>
                                <p>
                                    <span>Click the button to permanantly delete this incident.</span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button className="bs-Button bs-Button--red Box-background--red" disabled={deleting} 
                                        onClick={() =>
                                            this.props.openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () => this.deleteIncident(),
                                                content: DataPathHoC(DeleteIncident, { deleting })
                                            })}>
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

IncidentDeleteBox.displayName = 'IncidentDeleteBox'

const mapStateToProps = () => ({});

const mapDispatchToProps = dispatch => (
    bindActionCreators({ openModal, closeModal, deleteIncident }, dispatch)
)

IncidentDeleteBox.propTypes = {
    currentProject: PropTypes.object.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    incident: PropTypes.object.isRequired,
    deleteIncident: PropTypes.func.isRequired,
    deleting: PropTypes.bool.isRequired,
}

IncidentDeleteBox.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(IncidentDeleteBox));