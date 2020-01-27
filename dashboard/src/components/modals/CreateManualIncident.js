import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { createNewIncident, createIncidentReset } from '../../actions/incident';
import { closeModal } from '../../actions/modal';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';


class CreateManualIncident extends Component {
	constructor(props) {
		super(props);
		this.state = {
			incidentType: '',
		}
	}

	submitForm = (values) => {
		const { createNewIncident, createIncidentModalId, closeModal, createIncidentReset } = this.props;
		const { projectId, monitorId } = this.props.data;
		this.setState({ incidentType: values.incidentType });
		createNewIncident(
			projectId,
			monitorId,
			values.incidentType
		).then(() => {
			createIncidentReset();
			closeModal({
				id: createIncidentModalId
			});
		});
	}

	handleKeyBoard = (e) => {
		const { createIncidentModalId, closeModal, createIncidentReset } = this.props;
		switch (e.key) {
			case 'Escape':
				createIncidentReset();
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
			newIncident
		} = this.props;
		var sameError = newIncident && newIncident.error && newIncident.error === `An unresolved incident of type ${this.state.incidentType} already exists.` ? true : false;
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
										<ShouldRender if={!sameError}>
											<div className="bs-Fieldset-row">
												<label className="bs-Fieldset-label">Incident type</label>
												<div className="bs-Fieldset-fields">
													<Field className="db-select-nw"
														component={RenderSelect}
														name="incidentType"
														id="incidentType"
														placeholder="Incident type"
														disabled={this.props.newIncident.requesting}
														validate={ValidateField.select}
														options={[
															{ value: '', label: 'Select type' },
															{ value: 'online', label: 'Online' },
															{ value: 'offline', label: 'Offline' },
															{ value: 'degraded', label: 'Degraded' }
														]}
													/>
												</div>
											</div>
										</ShouldRender>
										<ShouldRender if={sameError}>
											<span>An unresolved incident of type {this.state.incidentType} already exists. Please resolve earlier incidents of type {this.state.incidentType} to create a new incident.</span>
										</ShouldRender>
									</div>
								</div>
							</div>
							<div className="bs-Modal-footer">
								<div className="bs-Modal-footer-actions">
									<ShouldRender if={newIncident && newIncident.error && !sameError}>
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
											this.props.createIncidentReset();
											this.props.closeModal({
												id: this.props.createIncidentModalId
											})
										}}>
										<ShouldRender if={!sameError}>
											<span>Cancel</span>
										</ShouldRender>
										<ShouldRender if={sameError}>
											<span>OK</span>
										</ShouldRender>
									</button>
									<ShouldRender if={!sameError}>
										<button
											id="createIncident"
											className="bs-Button bs-DeprecatedButton bs-Button--blue"
											disabled={newIncident && newIncident.requesting}
											type="submit">
											{newIncident && !newIncident.requesting && <span>Create</span>}
											{newIncident && newIncident.requesting && <FormLoader />}
										</button>
									</ShouldRender>
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
		closeModal,
		createIncidentReset
	}, dispatch)
}

function mapStateToProps(state) {
	return {
		newIncident: state.incident.newIncident,
		createIncidentModalId: state.modal.modals[0].id
	};
}

CreateManualIncident.propTypes = {
	closeModal: PropTypes.func.isRequired,
	createIncidentModalId: PropTypes.string,
	createIncidentReset: PropTypes.func.isRequired,
	createNewIncident: PropTypes.func.isRequired,
	data: PropTypes.object,
	handleSubmit: PropTypes.func.isRequired,
	monitorId: PropTypes.string,
	newIncident: PropTypes.object
}

export default connect(mapStateToProps, mapDispatchToProps)(CreateManualIncidentForm);