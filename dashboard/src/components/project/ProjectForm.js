import React from 'react';
import PropTypes from 'prop-types'
import { reduxForm, Field } from 'redux-form';
import ShouldRender from '../basic/ShouldRender';
import { Validate } from '../../config';
import PlanFields from './PlanFields';
import { Spinner } from '../basic/Loader';
import { User } from '../../config';

function validate(values) {

	const errors = {};

	if (!Validate.text(values.projectName)) {
		errors.name = 'Project Name is required!'
	}

	if (!Validate.text(values.planId)) {
		errors.name = 'Stripe PlanID is required!'
	}

	return errors;
}

export function ProjectForm(props) {
	
	const {
		handleSubmit,
		hideForm,
		submitForm,
		errorStack,
		submitFailed,
		submitting
	} = props;
	let cardRegistered = User.isCardRegistered();

	return (

		<form id="frmCreateProject" onSubmit={handleSubmit(submitForm.bind(this))}>
			<div className="bs-Modal bs-Modal--medium">
				<div className="bs-Modal-header">
					<div className="bs-Modal-header-copy">
						<span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
							<span>Create New Project</span>
						</span>
					</div>
					<div className="bs-Modal-messages">
						<ShouldRender if={submitFailed}>
							<p className="bs-Modal-message">{errorStack}</p>
						</ShouldRender>
					</div>
				</div>
				<div className="bs-Modal-content">
					<span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
						You can always change the new project name later.
					</span>
					<div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
						<fieldset className="bs-Fieldset">
							<div className="bs-Fieldset-rows">
								<div className="bs-Fieldset-row" style={{ padding: 0 }}>
									<label className="bs-Fieldset-label Text-align--left" htmlFor="name">
										<span>Project Name</span>
									</label>
									<div className="bs-Fieldset-fields">
										<div className="bs-Fieldset-field" style={{ width: '70%' }}>
											<Field
												required={true}
												component="input"
												name="projectName"
												placeholder="Enter Project Name"
												id="name"
												className="bs-TextInput"
												style={{ width: '100%', padding: '3px 5px' }}
											/>
										</div>
									</div>
								</div>
							</div>
						</fieldset>
						<fieldset className="bs-Fieldset">
							<div className="bs-Fieldset-rows">
								<div className="Margin-bottom--12 Text-fontWeight--medium">
									Choose a Plan
								</div>
								<div className="bs-Fieldset-row .Flex-justifyContent--center" style={{ padding: 0 }}>
									<PlanFields />
								</div>
							</div>
						</fieldset>
						<ShouldRender if={!cardRegistered || cardRegistered === 'false'}>
							<fieldset className="bs-Fieldset">
								<div className="bs-Fieldset-rows">
									<div className="Margin-bottom--12 Text-fontWeight--medium">
										Your Credit or Debit Card
								</div>
									<div className="bs-Fieldset-row .Flex-justifyContent--center" style={{ padding: 0 }}>
										<label className="bs-Fieldset-label Text-align--left" htmlFor="name">
											<span>Card Number</span>
										</label>
										<div className="bs-Fieldset-fields">
											<div className="bs-Fieldset-field" style={{ width: '70%' }}>
												<Field
													required={true}
													component="input"
													name="cardNumber"
													placeholder="Enter Card Number"
													id="name"
													className="bs-TextInput"
													style={{ width: '100%', padding: '3px 5px' }}
												/>
											</div>
										</div>
									</div>
									<div className="bs-Fieldset-row .Flex-justifyContent--center" style={{ padding: 0, paddingTop: '10px' }}>
										<label className="bs-Fieldset-label Text-align--left" htmlFor="name">
											<span>CVV</span>
										</label>
										<div className="bs-Fieldset-fields">
											<div className="bs-Fieldset-field" style={{ width: '70%' }}>
												<Field
													required={true}
													component="input"
													name="cvv"
													placeholder="Enter CVV"
													id="name"
													className="bs-TextInput"
													style={{ width: '100%', padding: '3px 5px' }}
												/>
											</div>
										</div>
									</div>
									<div className="bs-Fieldset-row .Flex-justifyContent--center" style={{ padding: 0, paddingTop: '10px' }}>
										<label className="bs-Fieldset-label Text-align--left" htmlFor="name">
											<span>Expiry</span>
										</label>
										<div className="bs-Fieldset-fields">
											<div className="bs-Fieldset-field" style={{ width: '70%' }}>
												<Field
													required={true}
													component="input"
													name="expiry"
													placeholder="01/2025"
													id="name"
													className="bs-TextInput"
													style={{ width: '100%', padding: '3px 5px' }}
												/>
											</div>
										</div>
									</div>
								</div>
							</fieldset>
						</ShouldRender>
					</div>
				</div>
				<div className="bs-Modal-footer">
					<div className="bs-Modal-footer-actions">
						<button
							id="btnCancelProject"
							className={`bs-Button bs-DeprecatedButton ${submitting && 'bs-is-disabled'}`}
							type="button"
							onClick={hideForm}
							disabled={submitting}
						>
							<span>Cancel</span>
						</button>
						<button
							className={`bs-Button bs-DeprecatedButton bs-Button--blue ${submitting && 'bs-is-disabled'}`}
							type="submit"
							disabled={submitting}
						>
							<ShouldRender if={submitting}>
								<Spinner />
							</ShouldRender>

							<span>Create Project</span>

						</button>
					</div>
				</div>
			</div>
		</form>
	);
}

ProjectForm.displayName = 'ProjectForm'

ProjectForm.propTypes = {
	handleSubmit: PropTypes.func.isRequired,
	hideForm: PropTypes.func.isRequired,
	submitForm: PropTypes.func.isRequired,
	errorStack: PropTypes.array,
	submitFailed: PropTypes.bool,
	submitting: PropTypes.bool
}

export default reduxForm({
	form: 'ProjectForm',
	validate
})(ProjectForm);