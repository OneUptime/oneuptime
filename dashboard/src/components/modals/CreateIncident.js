import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import { createIncidentRequest, createIncidentError, createIncidentSuccess, createNewIncident } from '../../actions/incident';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject'
import { history } from '../../store';

function validate(value) {

	const errors = {};

	if (!Validate.text(value.monitors)) {
		errors.name = 'Please select a monitor!'
	}

	return errors;
}

class CreateIncident extends Component {
	submitForm = (values) => {
		const { createNewIncident, closeThisDialog, currentProject, monitors, data } = this.props;
		if (values.monitors) {
			values = values.monitors;
		}
		var projectId = currentProject._id;
		const subProjectMonitor = monitors.find(subProjectMonitor => subProjectMonitor._id === data.subProjectId);
		subProjectMonitor.monitors.forEach((monitor)=>{
			if(monitor._id === values) projectId = monitor.projectId._id || monitor.projectId;
		});
		createNewIncident(projectId, values)
			.then(function () {
				closeThisDialog();
			}, function () {
				//do nothing. 
			});
	}

	handleKeyBoard = (e) => {
		switch (e.key) {
			case 'Escape':
				return this.props.closeThisDialog()
			default:
				return false;
		}
	}

	render() {
		const { handleSubmit, closeThisDialog, data, monitors } = this.props;
		const subProjectMonitor = monitors.find(subProjectMonitor => subProjectMonitor._id === data.subProjectId);
		
		const monitorOptions = subProjectMonitor && subProjectMonitor.monitors.map((monitor, i) =>
				<RenderIfUserInSubProject subProjectId={monitor.projectId._id || monitor.projectId} key={i}>
					<option value={monitor._id}>{monitor.name}</option>
				</RenderIfUserInSubProject>
			);

		return (
			<div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
				<div className="bs-BIM">
					<div className="bs-Modal bs-Modal--large">
						<div className="bs-Modal-header">
							<div className="bs-Modal-header-copy" 
							style={{ marginBottom: '10px', marginTop:'10px' }}>
							<span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
								<span>Create New Incident</span>
								</span>
							</div>
						</div>
						<form id="frmIncident" onSubmit={handleSubmit(this.submitForm)}>
							<div className="bs-Modal-content bs-u-paddingless">
								<div className="bs-Modal-block bs-u-paddingless">

									<div className="bs-Modal-content">
										<span className="bs-Fieldset">
											{ subProjectMonitor && subProjectMonitor.monitors && subProjectMonitor.monitors.length > 0 ?
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row">
														<label className="bs-Fieldset-label"><span> Monitor </span></label>

														
															<Field id="monitorList" name="monitors" component="select" className="select-dropdown bs-Button bs-Button--icon bs-Button--icon--right" style={{ width: '200px' }}>
																<option>Select a monitor</option>
																{
																	monitorOptions
																}
															</Field> 
														<img src="/assets/img/show-more-button.svg" className="select-arrow" alt="arrow" />
													</div>
												</div> :
												<label className="bs-Fieldset-label"><span> No monitor added yet. </span>
												<div 
													className="bs-ObjectList-copy bs-is-highlighted" 
													style={{ display: 'inline', textAlign: 'left', cursor: 'pointer' }}
													onClick={()=>{
														closeThisDialog();
														history.push('/project/' + this.props.currentProject._id + '/monitoring')
													}}
												>Please create one.</div></label>
											}
										</span>
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
									<button className="bs-Button bs-DeprecatedButton" type="button" onClick={closeThisDialog}><span>Cancel</span></button>
									<ShouldRender if={subProjectMonitor && subProjectMonitor.monitors && subProjectMonitor.monitors.length > 0}>
										<button
											id="createIncident"
											className="bs-Button bs-DeprecatedButton bs-Button--blue"
											disabled={this.props.newIncident && this.props.newIncident.requesting}
											type="submit">
											{this.props.newIncident && !this.props.newIncident.requesting && <span>Create</span>}
											{this.props.newIncident && this.props.newIncident.requesting && <FormLoader />}
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

CreateIncident.displayName = 'CreateIncidentFormModal'

let CreateIncidentForm = reduxForm({
	form: 'CreateNewIncident', // a unique identifier for this form
	validate
})(CreateIncident);

const mapDispatchToProps = (dispatch) => {
	return bindActionCreators({ createIncidentRequest, createIncidentError, createIncidentSuccess, createNewIncident }, dispatch)
}

function mapStateToProps(state) {

	return {
		monitors: state.monitor.monitorsList.monitors,
		currentProject: state.project.currentProject,
		newIncident: state.incident.newIncident,
	};
}

CreateIncident.propTypes = {
	closeThisDialog: PropTypes.func.isRequired,
	createNewIncident: PropTypes.func.isRequired,
	currentProject: PropTypes.object,
	handleSubmit: PropTypes.func,
	monitors: PropTypes.array,
	newIncident: PropTypes.object,
	error: PropTypes.object,
	requesting: PropTypes.bool,
	data: PropTypes.object,
}

export default connect(mapStateToProps, mapDispatchToProps)(CreateIncidentForm);