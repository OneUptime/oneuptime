import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field, reset } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import { Validate } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import { addBalance, getProjects } from '../../actions/project';
import { RenderField } from '../basic/RenderField';
import PropTypes from 'prop-types';
import {
    StripeProvider,
    injectStripe,
    Elements
} from 'react-stripe-elements';
import { openModal } from '../../actions/modal';
import MessageBox from '../modals/MessageBox';
import uuid from 'uuid';

function validate(value) {

    const errors = {};

    if (!Validate.text(value.rechargeBalanceAmount)) {
        errors.rechargeBalanceAmount = 'Amount is required'
    } else if (!Validate.number(value.rechargeBalanceAmount)) {
        errors.rechargeBalanceAmount = 'Enter a valid number'
    }

    return errors;
}

export class CustomerBalance extends Component {

    state = { 
        MessageBoxId: uuid.v4()
    }

    submitForm = (values) => {
        const { rechargeBalanceAmount } = values;
        const { addBalance, projectId, openModal } = this.props;
        const { MessageBoxId } = this.state;

        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Add amount to balance', values);
        }
        if (rechargeBalanceAmount) {
            addBalance(projectId, values)
            .then(() => {
                const { paymentIntent } = this.props;
                this.handlePaymentIntent(paymentIntent.client_secret);

            })
            .catch((err) => {
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: "Message",
                    message: err.message
                })
            })
        }
    }
    handlePaymentIntent = (paymentIntentClientSecret) => {
        const { stripe, openModal, getProjects, balance } = this.props;
        const { MessageBoxId } = this.state;
        stripe.handleCardPayment(paymentIntentClientSecret)
            .then(result => {
                if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
                    var creditedBalance = result.paymentIntent.amount / 100; 
                    openModal({
                        id: MessageBoxId,
                        content: MessageBox,
                        title: "Message",
                        message: `Transaction successful, your balance is now ${balance+creditedBalance}$`
                    })
                    getProjects()
                }
                else {
                    openModal({
                        id: MessageBoxId,
                        content: MessageBox,
                        title: "Message",
                        message: "Transaction failed, try again later or use a different card."
                    })
                }
            })
    }
    render() {
        const { balance } = this.props;
        return (
            <div className="db-World-contentPane Box-root">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Current Balance</span>
                                        </span>
                                        <p>
                                            <span>
                                                Manage your fyipe account balance.
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                <form onSubmit={this.props.handleSubmit(this.submitForm)}>
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '30% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <div className="Box-root" style={{ 'paddingLeft': '5px' }}>
                                                                <label>
                                                                    This balance will be used to send alerts. If the balance is below a certain criteria, alerts will not be sent.
                                                                </label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '30% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <div className="Box-root" style={{ 'paddingLeft': '5px' }}>
                                                                <label>
                                                                    <p>Balance: <span style={{ fontWeight: 'bold' }}>{`${balance}$`}</span></p>
                                                                </label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Add balance </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        component={RenderField}
                                                        type="text"
                                                        name="rechargeBalanceAmount"
                                                        id="rechargeBalanceAmount"
                                                        placeholder="Enter amount"
                                                        required="required"
                                                        disabled={this.props.isRequesting}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                        <span className="db-SettingsForm-footerMessage"></span>
                                        <div>
                                            <button
                                                id="btnCreateProject"
                                                className="bs-Button bs-Button--blue"
                                                disabled={this.props.isRequesting}
                                                type="submit"
                                            >
                                                <ShouldRender if={!this.props.isRequesting}>
                                                    <span>Add</span>
                                                </ShouldRender>
                                                <ShouldRender if={this.props.isRequesting}>
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

CustomerBalance.displayName = 'CustomerBalance'

CustomerBalance.propTypes = {
    addBalance: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    projectId: PropTypes.string,
    balance: PropTypes.number
}

let formName = 'CustomerBalance' + Math.floor((Math.random() * 10) + 1);

let onSubmitSuccess = (result, dispatch) => dispatch(reset(formName))

let CustomerBalanceForm = new reduxForm({
    form: formName,
    enableReinitialize: true,
    validate,
    onSubmitSuccess,
})(CustomerBalance);

const mapDispatchToProps = dispatch => (
    bindActionCreators({ addBalance, getProjects, openModal }, dispatch)
)

const mapStateToProps = state => (
    {
        project: state.project.currentProject !== null && state.project.currentProject,
        balance: state.project.currentProject && state.project.currentProject.balance,
        projectId: state.project.currentProject !== null && state.project.currentProject._id,
        isRequesting: state.project.addBalance.requesting,
        paymentIntent: state.project.addBalance.pi
    }
)

CustomerBalance.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

const _CustomerBalanceForm = injectStripe(connect(mapStateToProps, mapDispatchToProps)(CustomerBalanceForm));

export default class CustomerBalanceWithCheckout extends Component {
    render() {
        return (
            <StripeProvider apiKey="pk_test_UynUDrFmbBmFVgJXd9EZCvBj00QAVpdwPv">
                    <Elements>
                        <_CustomerBalanceForm />
                    </Elements>
            </StripeProvider>
        )
    }
}
CustomerBalanceWithCheckout.displayName = 'CustomerBalanceWithCheckout';
