import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Validate } from '../../config';
import { reduxForm, Field } from 'redux-form';
import { createWebHookRequest, createWebHook, createWebHookSuccess, createWebHookError } from '../../actions/webHook';
import MultiSelectMonitor from '../multiSelect/MultiSelectMonitor';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RadioInput } from '../webHooks/RadioInput';
import { RenderField } from '../basic/RenderField';

function validate(values) {

	const errors = {};

	if (!Validate.url(values.endpoint)) {
		errors.endpoint = 'Webhook url is required!'
	}
	if (!values.monitorIds) {
		errors.monitorIds = 'Atleast one monitor is required!'
	}
	else if (!values.monitorIds.length) {
		errors.monitorIds = 'Atleast one monitor is required!'
	}

	return errors;
}

class CreateWebHook extends React.Component {

	submitForm = (values) => {
		const { createWebHook, closeThisDialog } = this.props;
		const postObj = {};
		postObj.endpoint = values.endpoint;
		postObj.monitorIds = values.monitorIds;
		postObj.endpointType = values.endpointType;
		postObj.type = 'webhook';

		postObj.monitorIds = postObj.monitorIds.map(({ value }) => value);
		createWebHook(this.props.currentProject._id, postObj)
			.then(() => {
				closeThisDialog();
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
		const { handleSubmit, closeThisDialog } = this.props;
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

		return (
			<div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
				<div className="bs-BIM">
					<div className="bs-Modal" style={{ width: 500 }}>
						<div className="bs-Modal-header">
							<div className="bs-Modal-header-copy"
								style={{ marginBottom: '10px', marginTop: '10px' }}>
								<span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
									<span>Create Webhook</span>
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
																	type="url"
																	placeholder="Enter webhook url"
																	id="endpoint"
																	className="bs-TextInput bs-Button"
																	style={{ width: 300, padding: '3px 5px' }}
																/>
															</div>
														</div>
													</div>
												</div>
											</fieldset>

											<fieldset className="Margin-bottom--16">
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row" style={{ padding: 0 }}>
														<label className="bs-Fieldset-label Text-align--left" htmlFor="monitorIds">
															<span>Monitors</span>
														</label>
														<div className="bs-Fieldset-fields">
															<div className="bs-Fieldset-field" style={{ width: '300px' }}>
																<Field
																	component={MultiSelectMonitor}
																	name="monitorIds"
																	id="monitorIds"
																	placeholder="Select monitors"
																	data={monitorList}
																	valueField="value"
																	textField="label"
																	className="bs-TextInput bs-Button db-MultiSelect-input"
																/>
															</div>
														</div>
													</div>
												</div>
											</fieldset>

											<fieldset className="Margin-bottom--8">
												<div className="bs-Fieldset-rows">
													<div className="bs-Fieldset-row" style={{ padding: 0 }}>
														<label className="bs-Fieldset-label Text-align--left" htmlFor="endpointType">
															<span>Endpoint Type</span>
														</label>
														<div className="bs-Fieldset-fields">
															<div className="bs-Fieldset-field" style={{ width: '70%' }}>
																<div className="Flex-flex ">
																	<RadioInput
																		value="get"
																		details="GET"
																		id="endpointType"
																	/>
																	<div style={{ paddingTop: 5, marginLeft: 40 }}>
																		<RadioInput
																			value="post"
																			details="POST"
																			id="endpointType"
																		/>
																	</div>
																</div>
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
										{this.props.newWebHook && !this.props.newWebHook.requesting && <span>Create</span>}
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

CreateWebHook.displayName = 'CreateWebHook';

CreateWebHook.contextTypes = {
	mixpanel: PropTypes.object.isRequired
};

CreateWebHook.propTypes = {
	currentProject: PropTypes.object,
	createWebHook: PropTypes.func.isRequired,
	closeThisDialog: PropTypes.func.isRequired,
	handleSubmit: PropTypes.func.isRequired,
	monitor: PropTypes.object,
	newWebHook: PropTypes.object
};

let NewCreateWebHook = reduxForm({
	form: 'newCreateWebHook', // a unique identifier for this form
	enableReinitialize: true,
	validate, // <--- validation function given to redux-for
	destroyOnUnmount: true
})(CreateWebHook);

const mapDispatchToProps = dispatch => bindActionCreators(
	{
		createWebHookRequest,
		createWebHook,
		createWebHookSuccess,
		createWebHookError
	}
	, dispatch);

const mapStateToProps = state => (
	{
		webhook: state.webhook,
		monitor: state.monitor,
		currentProject: state.project.currentProject,
		newWebHook: state.webHooks.createWebHook,
		initialValues: { endpoint: '', endpointType: 'get', monitorIds: [] }
	}
);

export default connect(mapStateToProps, mapDispatchToProps)(NewCreateWebHook);