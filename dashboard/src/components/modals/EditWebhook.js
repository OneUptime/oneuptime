import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, compose } from 'redux';
import { Validate } from '../../config';
import { reduxForm, Field } from 'redux-form';
import { updateWebHook } from '../../actions/webHook';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { ValidateField } from '../../config';

function validate(values) {

	const errors = {};

	if (!Validate.url(values.endpoint)) {
		errors.endpoint = 'Webhook url is required!'
	}

	return errors;
}

class EditWebHook extends React.Component {

	submitForm = values => {
		const { updateWebHook, closeThisDialog, data, currentProject } = this.props;

		const postObj = {};
        postObj.endpoint = values.endpoint;
        postObj.monitorId = values.monitorId;
        postObj.endpointType = values.endpointType;
		postObj.type = 'webhook';
		postObj.monitorId = data.currentMonitorId ? data.currentMonitorId : values.monitorId;
		postObj.incidentCreated = values.incidentCreated ? values.incidentCreated: false;
		postObj.incidentResolved = values.incidentResolved ? values.incidentResolved: false;
		postObj.incidentAcknowledged = values.incidentAcknowledged ? values.incidentAcknowledged: false;

        updateWebHook(
                currentProject._id,
                data._id,
                postObj
            ).then(() => {
				if (this.props.newWebHook && !this.props.newWebHook.error) {
					closeThisDialog();
				}
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

    render(){
		const { handleSubmit, closeThisDialog, data } = this.props;

        const monitorList = [];

		const allMonitors = this.props.monitor.monitorsList.monitors.map(monitor => monitor.monitors).flat();
		if (allMonitors && allMonitors.length > 0) {
			allMonitors.map(monitor =>
				monitorList.push({
					value: monitor._id,
					label: monitor.name
				})
			);
		}

        return(
			<div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
				<div className="bs-BIM">
					<div className="bs-Modal" style={{ width: 500 }}>
						<div className="bs-Modal-header">
							<div className="bs-Modal-header-copy"
							style={{ marginBottom: '10px',marginTop:'10px' }}>
							<span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
								<span>Update Webhook</span>
								</span>
							</div>
						</div>
						<form onSubmit={handleSubmit(this.submitForm)}>
							<div className="bs-Modal-content Padding-horizontal--12">
								<div className="bs-Modal-block bs-u-paddingless">

									<div className="bs-Modal-content">

										<div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
											<fieldset className="Margin-bottom--16">
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row" style={{ padding: 0 }}>
														<label className="bs-Fieldset-label Text-align--left" htmlFor="endpoint">
															<span>Endpoint URL</span>
														</label>
														<div className="bs-Fieldset-fields">
															<div className="bs-Fieldset-field" style={{ width: '70%' }}>
																<Field
																	component={RenderField}
																	name="endpoint"
																	placeholder="Enter webhook url"
																	id="endpoint"
																	type="url"
																	className="db-BusinessSettings-input TextInput bs-TextInput"
																	style={{ width: 300, padding: '3px 5px' }}
																/>
															</div>
														</div>
													</div>
												</div>
											</fieldset>

											<ShouldRender if={!data.currentMonitorId}>
												<fieldset className="Margin-bottom--16">
													<div className="bs-Fieldset-rows">
														<div className="bs-Fieldset-row" style={{ padding: 0 }}>
															<label className="bs-Fieldset-label Text-align--left" htmlFor="monitorId">
																<span>Monitor</span>
															</label>
															<div className="bs-Fieldset-fields">
																<div className="bs-Fieldset-field" style={{ width: '300px' }}>
																	<Field
																		className="db-select-nw db-MultiSelect-input"
																		component={RenderSelect}
																		name="monitorId"
																		id="monitorId"
																		placeholder="Select monitor"
																		disabled={this.props.newWebHook.requesting}
																		validate={ValidateField.select}
																		options={[
																			{ value: '', label: 'Select amount' },
																			...(monitorList && monitorList.length > 0 ? monitorList.map(monitor => ({ value: monitor.value, label: monitor.label })) : [])
																		]}
																		style={{ width: '300px' }}
																	/>
																</div>
															</div>
														</div>
													</div>
												</fieldset>
											</ShouldRender>

											<fieldset className="Margin-bottom--16">
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row" style={{ padding: 0 }}>
														<label className="bs-Fieldset-label Text-align--left" htmlFor="monitorId">
															<span>Endpoint Type</span>
														</label>
														<div className="bs-Fieldset-fields">
															<div className="bs-Fieldset-field" style={{ width: '300px' }}>
																<Field
																	component={RenderSelect}
																	name="endpointType"
																	id="endpointType"
																	placeholder="Select endpoint type"
																	disabled={this.props.newWebHook.requesting}
																	validate={ValidateField.select}
																	options={[
																		{ value: '', label: 'Select endpoint type' },
																		{ value: 'get', label: 'GET' },
																		{ value: 'post', label: 'POST' },
																	]}
																	className="db-select-nw db-MultiSelect-input"
																/>
															</div>
														</div>
													</div>
												</div>
											</fieldset>

											<fieldset className="Margin-bottom--16">
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row" style={{ padding: 0 }}>
														<label className="bs-Fieldset-label Text-align--left" htmlFor="monitorId"><span></span></label>
														<div className="bs-Fieldset-fields" style={{ paddingTop: '6px' }}>
															<div className="bs-Fieldset-field">
																<label className="Checkbox" style={{ marginRight: '12px' }}>
																	<Field
																		component="input"
																		type="checkbox"
																		name='incidentCreated'
																		className="Checkbox-source"
																		id='incidentCreated'
																	/>
																	<div className="Checkbox-box Box-root Margin-right--2">
																		<div className="Checkbox-target Box-root">
																			<div className="Checkbox-color Box-root"></div>
																		</div>
																	</div>
																	<div className="Box-root" style={{ 'paddingLeft': '5px' }}>
																		<label><span>Ping when incident is Created</span></label>
																	</div>
																</label>
															</div>
														</div>
													</div>
												</div>
											</fieldset>

											<fieldset className="Margin-bottom--16">
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row" style={{ padding: 0 }}>
														<label className="bs-Fieldset-label Text-align--left" htmlFor="monitorId"><span></span></label>
														<div className="bs-Fieldset-fields" style={{ paddingTop: '6px' }}>
															<div className="bs-Fieldset-field">
																<label className="Checkbox" style={{ marginRight: '12px' }}>
																	<Field
																		component="input"
																		type="checkbox"
																		name='incidentAcknowledged'
																		className="Checkbox-source"
																		id='incidentAcknowledged'
																	/>
																	<div className="Checkbox-box Box-root Margin-right--2">
																		<div className="Checkbox-target Box-root">
																			<div className="Checkbox-color Box-root"></div>
																		</div>
																	</div>
																	<div className="Box-root" style={{ 'paddingLeft': '5px' }}>
																		<label><span>Ping when incident is Acknowledged</span></label>
																	</div>
																</label>
															</div>
														</div>
													</div>
												</div>
											</fieldset>

											<fieldset className="Margin-bottom--16">
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row" style={{ padding: 0 }}>
														<label className="bs-Fieldset-label Text-align--left" htmlFor="monitorId"><span></span></label>
														<div className="bs-Fieldset-fields" style={{ paddingTop: '6px' }}>
															<div className="bs-Fieldset-field">
																<label className="Checkbox"  style={{ marginRight: '12px' }}>
																	<Field
																		component="input"
																		type="checkbox"
																		name='incidentResolved'
																		className="Checkbox-source"
																		id='incidentResolved'
																	/>
																	<div className="Checkbox-box Box-root Margin-right--2">
																		<div className="Checkbox-target Box-root">
																			<div className="Checkbox-color Box-root"></div>
																		</div>
																	</div>
																	<div className="Box-root" style={{ 'paddingLeft': '5px' }}>
																		<label><span>Ping when incident is Resolved</span></label>
																	</div>
																</label>
															</div>
														</div>
													</div>
												</div>
											</fieldset>

										</div>
									</div>
								</div>
							</div>
							<div className="bs-Modal-footer">
								<div className="bs-Modal-footer-actions">
									<ShouldRender if={this.props.newWebHook && this.props.newWebHook.error}>
										<div className="bs-Tail-copy">
											<div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
												<div className="Box-root Margin-right--8">
													<div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
													</div>
												</div>
												<div className="Box-root">
													<span style={{ color: 'red' }}>{this.props.newWebHook.error}</span>
												</div>
											</div>
										</div>
									</ShouldRender>
									<button className="bs-Button bs-DeprecatedButton" type="button" onClick={closeThisDialog}><span>Cancel</span></button>
									<button
										className="bs-Button bs-DeprecatedButton bs-Button--blue"
										disabled={this.props.newWebHook && this.props.newWebHook.requesting}
										type="submit">
										{this.props.newWebHook && !this.props.newWebHook.requesting && <span>Update</span>}
										{this.props.newWebHook && this.props.newWebHook.requesting && <FormLoader />}
									</button>
								</div>
							</div>
						</form>
					</div>
				</div>
			</div>
        )
    }
}

EditWebHook.displayName = 'CreateWebHook';

EditWebHook.contextTypes = {
	mixpanel: PropTypes.object.isRequired
};

EditWebHook.propTypes = {
	currentProject: PropTypes.object,
	updateWebHook: PropTypes.func.isRequired,
	closeThisDialog: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
	monitor: PropTypes.object,
	newWebHook: PropTypes.object,
	data: PropTypes.object.isRequired
};

const NewEditWebHook = compose(
  reduxForm({
    form: 'NewEditWebHook',
    validate,
    enableReinitialize: true,
	destroyOnUnmount: true,
	keepDirtyOnReinitialize: true,
	updateUnregisteredFields: true
  })
)(EditWebHook);

const mapDispatchToProps = dispatch => bindActionCreators(
    {
		updateWebHook
	}
    , dispatch);

const mapStateToProps = (state, props) => {
	let currentMonitorValue = { value: '', label: 'Select monitor' };

	if (props.data && props.data.monitorId) {
		currentMonitorValue.label = props.data.monitorId.name
		currentMonitorValue.value = props.data.monitorId._id
	}
	return(
    {
        webhook: state.webhook,
        monitor: state.monitor,
        currentProject: state.project.currentProject,
		newWebHook: state.webHooks.updateWebHook,
		initialValues: {
			endpoint: props.data.data.endpoint,
			endpointType: props.data.data.endpointType,
			monitorId: currentMonitorValue.value,
			incidentCreated: props.data.notificationOptions.incidentCreated,
			incidentResolved: props.data.notificationOptions.incidentResolved,
			incidentAcknowledged: props.data.notificationOptions.incidentAcknowledged,
		}
	}
)};

export default connect(mapStateToProps, mapDispatchToProps)(NewEditWebHook);
