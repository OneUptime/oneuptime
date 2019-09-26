import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { createNewIncident } from '../../actions/incident';
import { closeModal } from '../../actions/modal';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';


class CreateManualIncident extends Component {

	submitForm = (values) => {
		const { createNewIncident, createIncidentModalId, closeModal } = this.props;
		const { projectId, monitorId } = this.props.data;
		createNewIncident(projectId, monitorId, values.incidentType)
			.then(() => {
				closeModal({
					id: createIncidentModalId
				});
			});
	}

	handleKeyBoard = (e) => {
		const { createIncidentModalId, closeModal } = this.props;
		switch (e.key) {
			case 'Escape':
				return closeModal({
					id: createIncidentModalId
				});
			default:
				return false;
		}
	}

	render() {
		const {
			handleSubmit,
		} = this.props;
		return (
			<div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
				<div className="bs-BIM">
					<div className="bs-Modal bs-Modal--medium">
						<div className="bs-Modal-header">
							<div className="bs-Modal-header-copy"
								style={{ marginBottom: '10px', marginTop: '10px' }}>
								<span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
									<span>Create New Incident</span>
								</span>
							</div>
						</div>
						<form onSubmit={handleSubmit(this.submitForm.bind(this))}>
							<div className="bs-Modal-content bs-u-paddingless">
								<div className="bs-Modal-block bs-u-paddingless">

									<div className="bs-Modal-content">
										<div className="bs-Fieldset-row">
											<label className="bs-Fieldset-label">Incident type</label>
											<div className="bs-Fieldset-fields">
												<Field className="db-BusinessSettings-input TextInput bs-TextInput"
													component={RenderSelect}
													name="incidentType"
													id="incidentType"
													placeholder="Incident type"
													disabled={this.props.newIncident.requesting}
													validate={ValidateField.select}
												>
													<option value="">Select type</option>
													<option value="online">Online</option>
													<option value="offline">Offline</option>
													<option value="degraded">Degraded</option>
												</Field>
											</div>
										</div>
									</div>
								</div>
							</div>
							<div className="bs-Modal-footer">
								<div className="bs-Modal-footer-actions">
									<ShouldRender if={this.props.newIncident && this.props.newIncident.error}>
										<div className="bs-Tail-copy">
											<div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
												<div className="Box-root Margin-right--8">
													<div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
													</div>
												</div>
												<div className="Box-root">
													<span style={{ color: 'red' }}>{this.props.newIncident.error}</span>
												</div>
											</div>
										</div>
									</ShouldRender>
									<button className="bs-Button bs-DeprecatedButton"
										onClick={() => {
											this.props.closeModal({
												id: this.props.createIncidentModalId
											})
										}}>
										<span>Cancel</span>
									</button>
									<button
										id="createIncident"
										className="bs-Button bs-DeprecatedButton bs-Button--blue"
										disabled={this.props.newIncident && this.props.newIncident.requesting}
										type="submit">
										{this.props.newIncident && !this.props.newIncident.requesting && <span>Create</span>}
										{this.props.newIncident && this.props.newIncident.requesting && <FormLoader />}
									</button>
								</div>
							</div>
						</form>
					</div>
				</div>
			</div>
		);
	}
}

CreateManualIncident.displayName = 'CreateManualIncident';


let CreateManualIncidentForm = reduxForm({
	form: 'CreateManualIncident'
})(CreateManualIncident);

const mapDispatchToProps = (dispatch) => {
	return bindActionCreators({
		createNewIncident,
		closeModal
	}, dispatch)
}

function mapStateToProps(state) {
	return {
		newIncident: state.incident.newIncident,
		createIncidentModalId: state.modal.modals[0].id
	};
}

CreateManualIncident.propTypes = {
	newIncident: PropTypes.object,
	createIncidentModalId: PropTypes.string,
	monitorId: PropTypes.string,
	createNewIncident: PropTypes.func.isRequired,
	closeModal: PropTypes.func.isRequired,
	handleSubmit: PropTypes.func.isRequired,
	data: PropTypes.object
}

export default connect(mapStateToProps, mapDispatchToProps)(CreateManualIncidentForm);