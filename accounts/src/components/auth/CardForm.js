import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { Field, reduxForm } from 'redux-form';
import RenderCountrySelector from '../basic/CountrySelector';
import { connect } from 'react-redux';
import { RenderField } from '../basic/RenderField'
import { PricingPlan } from '../../config';
import { Validate } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';

class CardForm extends Component {

	render() {
		this.plan = PricingPlan.getPlanById(this.props.planId);

		return (
			<div id="main-body" className="box css" style={{ width: 500 }}>
				<div className="inner">
					<div className="title extra">
						<div>
							<h2>
								<span> {this.props.register.error ? <span className="error" >{this.props.register.error}</span> : 'Enter your card details'}
								</span>
							</h2>
							<p>Your card will be charged $1.00 to check its billability. You will be charged ${this.plan.amount}/{this.plan.type === 'month' ? 'mo' : 'yr'} after your 14 day free trial.</p>
						</div>
					</div>
					<form id="card-form" onSubmit={this.props.handleSubmit(this.props.submitForm)}>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="cardName">Card Holder Name</label>
									<Field
										type="text"
										name="cardName"
										id="cardName"
										placeholder="Card Holder Name"
										component={RenderField}
										required="required"
									/>
								</span>
							</p>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="cardNumber">Card Number</label>
									<Field
										type="text"
										component={RenderField}
										name="cardNumber"
										id="cardNumber"
										placeholder="1234 4534 2322 1234"
										required="required"
									/>
								</span>
							</p>
						</div>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="cvv">CVV</label>
									<Field
										type="password"
										component={RenderField}
										name="cvc"
										id="cvv"
										placeholder="CVV"
										required="required"
									/>
								</span>
							</p>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="expiry">Expiry Date</label>
									<Field
										type="text"
										component={RenderField}
										name="expiry"
										id="expiry"
										placeholder="01/2019"
										required="required"
									/>
								</span>
							</p>
						</div>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="address1">Street Address 1</label>
									<Field
										type="text"
										component={RenderField}
										name="address1"
										id="address1"
										placeholder="Street Address 1"
									/>
								</span>
							</p>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="address2">Street Address 2</label>
									<Field
										type="text"
										component={RenderField}
										name="address2"
										id="address2"
										placeholder="Street Address 2"
									/>
								</span>
							</p>
						</div>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="city">City</label>
									<Field
										type="text"
										component={RenderField}
										name="city"
										id="city"
										placeholder="City"
									/>
								</span>
							</p>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="state">State</label>
									<Field
										type="text"
										component={RenderField}
										name="state"
										id="state"
										placeholder="State (Optional)"
									/>
								</span>
							</p>
						</div>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="zipCode">Zip Code / Postal Code</label>
									<Field
										type="text"
										component={RenderField}
										name="zipCode"
										id="zipCode"
										placeholder="Zip Code or Postal Code"
										required="required"
									/>
								</span>
							</p>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0 }}>
								<span>
									<label htmlFor="country">Country</label>
									<Field
										type="text"
										component={RenderCountrySelector}
										name="country"
										id="country"
										placeholder="Select Country"
										required="required"
									/>
								</span>
							</p>
						</div>
						<div style={{ display: 'flex', justifyContent: 'space-between' }}>
							<p className="text" style={{ display: 'block', maxWidth: '50%', marginTop: 0, marginBottom: 30 }}>
								<span>
									<label htmlFor="promocode">Promo Code(optional)</label>
									<Field
										type="text"
										component={RenderField}
										name="promocode"
										id="promocode"
										placeholder="Promocode (Optional)"
									/>
								</span>
							</p>
						</div>
						<div>
							<p className="submit" style={{ width: '100%', maxWidth: '100%' }}>
								<button style={{ width: '100%' }} type="submit" className="button blue medium" id="create-account-button" disabled={this.props.register.requesting}>
									{!this.props.register.requesting && <span>Create Fyipe Account</span>}
									{this.props.register.requesting && <ButtonSpinner />}
								</button>
							</p>
						</div>
					</form>
				</div>
			</div>
		)
	}
}

CardForm.displayName = 'CardForm'

let validate = function (values) {
	const errors = {};

	if (!Validate.text(values.cardName)) {
		errors.cardName = 'Name is required.'
	}
	if (!Validate.text(values.cardNumber)) {
		errors.cardNumber = 'Card Number is required'
	}
	if (!Validate.text(values.cvc)) {
		errors.cvc = 'CVV is required.'
	}
	if (!Validate.text(values.expiry)) {
		errors.expiry = 'Expiry date is required.'
	}

	if (!Validate.text(values.city)) {
		errors.city = 'City is required.'
	}

	if (!Validate.text(values.zipCode)) {
		errors.zipCode = 'Zip Code or Postal Code is required.'
	}

	if (!Validate.text(values.country)) {
		errors.country = 'Country is required.';
	}

	if (!Validate.card(values.cardNumber)) {
		errors.cardNumber = 'Incorrect card number.';
	}

	if (!Validate.cardExpiration(values.expiry)) {
		errors.expiry = 'Expiration date is invalid.';
	}

	if (!Validate.cvv(values.cvc)) {
		errors.cvc = 'CVV is invalid.';
	}

	if (!Validate.postalCode(values.zipCode)) {
		errors.zipCode = 'Postal Code or Zip Code is invalid.';
	}

	return errors;
};


let cardForm = reduxForm({
	form: 'CardForm',              // <------ same form name                     // <----- validate form data
	destroyOnUnmount: false,         // <------ preserve form data
	forceUnregisterOnUnmount: true,  // <------ unregister fields on unmount
	validate
})(CardForm);

const mapDispatchToProps = (dispatch_Ignored) => {
	return {

	}
}

function mapStateToProps(state) {
	return {
		register: state.register
	};
}

CardForm.propTypes = {
	handleSubmit: PropTypes.func.isRequired,
	submitForm: PropTypes.func.isRequired,
	register: PropTypes.object.isRequired,
	planId: PropTypes.string.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(cardForm);
