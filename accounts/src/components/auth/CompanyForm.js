import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { Field, reduxForm } from 'redux-form';
import CountrySelector from '../basic/CountrySelector';
import CompanySizeSelector from '../basic/CompanySizeSelector';
import { connect } from 'react-redux';
import {RenderField} from '../basic/RenderField'
import {Validate} from  '../../config';
import {FlatLoader} from '../basic/Loader.js';


const errorStyle = {
    color:'red'
}

class CompanyForm extends Component {

	render() {
		return (
			<div id="main-body" className="box css">
				<div className="inner">
					<div className="title extra">

						<h2><span> {this.props.register.error ? <span style={errorStyle} > {this.props.register.error}</span> : 'One Last Step...'} </span></h2>
					</div>
					<form onSubmit={this.props.handleSubmit(this.props.submitForm)}>
						<p className="text">
							<span>
								<label htmlFor="companyName">Company Name</label>
								<Field
									type="text"
									name="companyName"
									id="companyName"
									component={RenderField}
									placeholder="Company Name"
								/>
							</span>
						</p>
						<p className="text">
							<span>
								<label htmlFor="companyRole">Job Title</label>
								<Field
									type="text"
									name="companyRole"
									id="companyRole"
									component={RenderField}
									placeholder="Your Job Title"
								/>
							</span>
						</p>
						<p className="text">
							<span>
								<label htmlFor="companyCountry">Country</label>
								<Field
									type="text"
									component={CountrySelector}
									name="companyCountry"
									id="companyCountry"
									placeholder="Company Country"

								/>
							</span>
						</p>
						<p className="text">
							<span>
								<label htmlFor="companySize">Company Size</label>
								<Field
									type="text"
									component={CompanySizeSelector}
									name="companySize"
									id="companySize"
									placeholder="company Size"

								/>
							</span>
						</p>
						<p className="text">
							<span>
								<label htmlFor="companyPhoneNumber">Phone Number</label>
								<Field
									type="text"
									component={RenderField}
									name="companyPhoneNumber"
									id="companyPhoneNumber"
									placeholder="+1-123-456-7890"
								/>
							</span>
						</p>
						<p className="text">
							<span>
								<label htmlFor="reference">Where did you hear about us?</label>
								<Field
									type="text"
									component={RenderField}
									name="reference"
									id="reference"
									placeholder="e.g Facebook"
								/>
							</span>
						</p>
						<p className="text">
							<span>
								<label htmlFor="reference">Promo Code(optional)</label>
								<Field
									type="text"
									component={RenderField}
									name="promocode"
									id="promocode"
									placeholder="Promocode (Optional)"
								/>
							</span>
						</p>
						<div>
							<p className="submit">
								<button type="submit" className="button blue medium" id="create-account-button" disabled={this.props.register.requesting}>
									{ !this.props.register.requesting && <span>Create Fyipe Account</span> }
									{ this.props.register.requesting &&	<FlatLoader /> }
								</button>
							</p>
						</div>
					</form>
				</div>
			</div>
		)
	}
}

CompanyForm.displayName = 'CompanyForm'

const validate = function(values){
	const error = {};

	if(!Validate.text(values.companyName)){
		error.companyName = 'Company name is required.'
	}

	if(!Validate.text(values.companyRole)){
		error.companyRole = 'Job Title is required.'
	}

	if(!Validate.text(values.companyPhoneNumber)){
		error.companyPhoneNumber ='Phone Number is required.'
	}

	if(!Validate.text(values.comapnySize)){
		error.comapnySize ='Phone Number is required.'
	}

	if(!Validate.text(values.reference)){
		error.reference ='This is required.'
	}

	return error;
}


const companyForm = reduxForm({
	form: 'CompanyForm',              // <------ same form name
	destroyOnUnmount: false,         // <------ preserve form data
	forceUnregisterOnUnmount: true,
	validate  // <------ unregister fields on unmoun
})(CompanyForm);

const mapDispatchToProps = (dispatch_Ignored) => {
	return {

	}
}

function mapStateToProps(state) {
	return {
		register: state.register
	};
}

CompanyForm.propTypes = {
	handleSubmit: PropTypes.func.isRequired,
	register: PropTypes.object.isRequired,
	submitForm: PropTypes.func.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(companyForm);
