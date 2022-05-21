import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import RenderCountrySelector from '../basic/CountrySelector';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Fade } from 'react-awesome-reveal';
import { RenderField } from '../basic/RenderField';
import { PricingPlan, Validate, env } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';
import { openModal, closeModal } from 'CommonUI/actions/Modal';
import ExtraCharge from '../Modals/ExtraCharge';
import { v4 as uuidv4 } from 'uuid';
import { CardNumberElement, CardExpiryElement, CardCVCElement, injectStripe, StripeProvider, Elements, } from '@stripe/react-stripe-js';
import { addCard, addCardSuccess, addCardFailed, addCardRequest, signUpRequest, signupError, signupSuccess, signupUser, } from '../../actions/register';
const createOptions = () => {
    return {
        style: {
            base: {
                color: '#000000',
                fontFamily: 'Camphor, Segoe UI, Open Sans, sans-serif',
                fontSize: '18px',
                letterSpacing: '0.025em',
                '::placeholder': {
                    color: '#bbb',
                    fontSize: '18px',
                },
            },
            invalid: {
                color: '#c23d4b',
            },
        },
    };
};
const errorStyle = {
    color: '#c23d4b',
};
class CardForm extends Component {
    constructor() {
        super(...arguments);
        /* This state holds error
        messages for cardNumber,
        cardCVC, cardExpiry */
        this.state = {
            cardNumber: '',
            cardCvc: '',
            cardExpiry: '',
            registerModal: uuidv4(),
        };
        this.handleChange = (event) => {
            const { error, empty } = event;
            if (empty) {
                this.setState({
                    [event.elementType]: 'Required.',
                });
            }
            if (error) {
                this.setState({
                    [event.elementType]: error.message,
                });
            }
            if (!error && !empty) {
                this.setState({
                    [event.elementType]: '',
                });
            }
        };
        this.handleClick = () => {
            const { registerModal } = this.state;
            this.props.openModal({
                id: registerModal,
                onClose: () => '',
                content: ExtraCharge,
            });
        };
        this.handleSubmit = (values) => {
            const { stripe, addCard, signUpRequest, signupUser, signupSuccess, signupError, } = this.props;
            const { user, planId } = this.props.register;
            const { email, companyName } = user;
            if (stripe) {
                signUpRequest();
                stripe
                    .createToken()
                    .then(({ token }) => {
                    if (token) {
                        return addCard({
                            tokenId: token.id,
                            email,
                            companyName,
                        });
                    }
                    else {
                        throw new Error('Your card details are incorrect.');
                    }
                })
                    .then(({ data }) => stripe.handleCardPayment(data.client_secret))
                    .then((data) => {
                    if (data.paymentIntent)
                        return signupUser(Object.assign(Object.assign(Object.assign({}, user), values), { planId, paymentIntent: data.paymentIntent }));
                    else
                        throw new Error(data.error.message);
                })
                    .then(({ data }) => {
                    signupSuccess(data);
                })
                    .catch((error) => {
                    signupError(error.message);
                });
            }
            else {
                signupError('Problem connnecting to payment gateway, please try again later');
            }
        };
    }
    render() {
        this.plan = PricingPlan.getPlanById(this.props.planId);
        const { handleSubmit } = this.props;
        const registerError = this.props.register.error;
        let header;
        if (registerError) {
            header = (React.createElement("span", { id: "error", style: errorStyle }, registerError));
        }
        else {
            header = React.createElement("span", null, "Enter your card details");
        }
        return (React.createElement(Fade, null,
            React.createElement("div", { id: "main-body", className: "box css", style: { width: 500 } },
                React.createElement("div", { className: "inner" },
                    React.createElement("div", { className: "title extra" },
                        React.createElement("div", null,
                            React.createElement("h2", null, header),
                            React.createElement("p", null,
                                "Your card will be charged $1.00 to check its billability.",
                                ' ',
                                React.createElement("span", { key: () => uuidv4() }),
                                React.createElement("span", { style: {
                                        color: 'green',
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                    }, onClick: this.handleClick }, "Learn Why?"),
                                React.createElement("br", null),
                                " You will be charged $",
                                this.plan.amount,
                                "/",
                                this.plan.type === 'month' ? 'mo' : 'yr',
                                ' ',
                                "after your 14 day free trial."))),
                    React.createElement("form", { id: "card-form", onSubmit: handleSubmit(this.handleSubmit) },
                        React.createElement("div", { style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                            } },
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "cardName" }, "Card Holder Name"),
                                    React.createElement(Field, { type: "text", name: "cardName", id: "cardName", placeholder: "Card Holder Name", component: RenderField, required: "required" }))),
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    marginTop: 0,
                                    width: 222,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "cardNumber" }, "Card Number"),
                                    React.createElement("div", { style: {
                                            border: '1px solid #bbb',
                                            height: 44,
                                            padding: '10px 12px',
                                        } },
                                        React.createElement(CardNumberElement, Object.assign({}, createOptions(), { onChange: this.handleChange }))),
                                    React.createElement("span", { style: errorStyle }, this.state.cardNumber)))),
                        React.createElement("div", { style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                            } },
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                    width: 222,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "cvv" }, "CVC"),
                                    React.createElement("div", { style: {
                                            border: '1px solid #bbb',
                                            height: 44,
                                            padding: '10px 12px',
                                        } },
                                        React.createElement(CardCVCElement, Object.assign({}, createOptions(), { onChange: this.handleChange }))),
                                    React.createElement("span", { style: errorStyle }, this.state.cardCvc))),
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                    width: 222,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "expiry" }, "Expiry Date"),
                                    React.createElement("div", { style: {
                                            border: '1px solid #bbb',
                                            height: 44,
                                            padding: '10px 12px',
                                        } },
                                        React.createElement(CardExpiryElement, Object.assign({}, createOptions(), { onChange: this.handleChange }))),
                                    React.createElement("span", { style: errorStyle }, this.state.cardExpiry)))),
                        React.createElement("div", { style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                            } },
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "address1" }, "Street Address 1"),
                                    React.createElement(Field, { type: "text", component: RenderField, name: "address1", id: "address1", placeholder: "Street Address 1" }))),
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "address2" }, "Street Address 2"),
                                    React.createElement(Field, { type: "text", component: RenderField, name: "address2", id: "address2", placeholder: "Street Address 2" })))),
                        React.createElement("div", { style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                            } },
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "city" }, "City"),
                                    React.createElement(Field, { type: "text", component: RenderField, name: "city", id: "city", placeholder: "City" }))),
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "state" }, "State"),
                                    React.createElement(Field, { type: "text", component: RenderField, name: "state", id: "state", placeholder: "State (Optional)" })))),
                        React.createElement("div", { style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                            } },
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "zipCode" }, "Zip Code / Postal Code"),
                                    React.createElement(Field, { type: "text", component: RenderField, name: "zipCode", id: "zipCode", placeholder: "Zip Code or Postal Code", required: "required" }))),
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "country" }, "Country"),
                                    React.createElement(Field, { type: "text", component: RenderCountrySelector, name: "country", id: "country", placeholder: "Select Country", required: "required" })))),
                        React.createElement("div", { style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                            } },
                            React.createElement("p", { className: "text", style: {
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                    marginBottom: 30,
                                } },
                                React.createElement("span", null,
                                    React.createElement("label", { htmlFor: "promocode" }, "Promo Code"),
                                    React.createElement(Field, { type: "text", component: RenderField, name: "promocode", id: "promocode", placeholder: "Promocode (Optional)" })))),
                        React.createElement("div", null,
                            React.createElement("p", { className: "submit", style: { width: '100%', maxWidth: '100%' } },
                                React.createElement("button", { style: { width: '100%' }, type: "submit", className: "button blue medium", id: "create-account-button", disabled: this.props.register.requesting },
                                    !this.props.register.requesting && (React.createElement("span", null, "Create OneUptime Account")),
                                    this.props.register.requesting && (React.createElement(ButtonSpinner, null))))))))));
    }
}
CardForm.displayName = 'CardForm';
const validate = function (values) {
    const errors = {};
    if (!Validate.text(values.cardName)) {
        errors.cardName = 'Name is required.';
    }
    if (!Validate.text(values.city)) {
        errors.city = 'City is required.';
    }
    if (!Validate.text(values.zipCode)) {
        errors.zipCode = 'Zip Code or Postal Code is required.';
    }
    if (!Validate.text(values.country)) {
        errors.country = 'Country is required.';
    }
    if (!Validate.postalCode(values.zipCode)) {
        errors.zipCode = 'Postal Code or Zip Code is invalid.';
    }
    return errors;
};
const cardForm = reduxForm({
    form: 'CardForm',
    destroyOnUnmount: true,
    forceUnregisterOnUnmount: true,
    validate,
})(CardForm);
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        addCard,
        addCardSuccess,
        addCardFailed,
        addCardRequest,
        openModal,
        closeModal,
        signUpRequest,
        signupUser,
        signupError,
        signupSuccess,
    }, dispatch);
};
function mapStateToProps(state) {
    return {
        register: state.register,
        addCard: state.register.addCard,
        formValues: state.form && state.form.CardForm && state.form.CardForm.values,
    };
}
CardForm.propTypes = {
    openModal: PropTypes.func,
    handleSubmit: PropTypes.func.isRequired,
    submitForm: PropTypes.func.isRequired,
    register: PropTypes.object.isRequired,
    planId: PropTypes.string.isRequired,
    stripe: PropTypes.object,
    addCard: PropTypes.func.isRequired,
    signUpRequest: PropTypes.func.isRequired,
    signupError: PropTypes.func.isRequired,
    signupSuccess: PropTypes.func.isRequired,
    signupUser: PropTypes.func.isRequired,
    formValues: PropTypes.object,
};
const CardFormWithCheckOut = injectStripe(connect(mapStateToProps, mapDispatchToProps)(cardForm));
CardFormWithCheckOut.displayName = 'CardFormWithCheckOut';
export default class CardFormHOC extends Component {
    render() {
        return (React.createElement(StripeProvider, { apiKey: env('STRIPE_PUBLIC_KEY') },
            React.createElement(Elements, null,
                React.createElement(CardFormWithCheckOut, null))));
    }
}
CardFormHOC.displayName = '';
CardFormHOC.propTypes = {};
CardFormHOC.displayName = 'CardFormHOC';
