import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field, change } from 'redux-form';
import { ValidateField, User } from '../../config';
import ShouldRender from '../basic/ShouldRender';
import { alertOptionsUpdate } from '../../actions/project';
import PropTypes from 'prop-types';
import { RenderSelect } from '../basic/RenderSelect';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { StripeProvider, injectStripe, Elements } from '@stripe/react-stripe-js';
import { openModal } from '../../actions/modal';
import MessageBox from '../modals/MessageBox';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { env } from '../../config';
import PricingPlan from '../basic/PricingPlan';
import isOwnerOrAdmin from '../../utils/isOwnerOrAdmin';
import Unauthorised from '../modals/Unauthorised';
import AlertBilling from '../modals/AlertBilling';
import Tooltip from '../basic/Tooltip';
import { FormLoader } from '../basic/Loader';

export class AlertAdvanceOption extends Component {
    state = {
        MessageBoxId: uuidv4(),
    };

    submitForm = (value: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
            formValues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertOptionsUpdate' does not exist on ty... Remove this comment to see the full error message
            alertOptionsUpdate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'balance' does not exist on type 'Readonl... Remove this comment to see the full error message
            balance,
        } = this.props;
        value._id = projectId;
        const userId = User.getUserId();
        if (isOwnerOrAdmin(userId, currentProject)) {
            if (balance < parseInt(formValues.minimumBalance)) {
                openModal({
                    id: this.state.MessageBoxId,
                    content: AlertBilling,
                    title: 'Message',
                    onConfirm: () => {
                        return alertOptionsUpdate(projectId, value).then(() => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntent' does not exist on type 'R... Remove this comment to see the full error message
                            const { paymentIntent } = this.props;
                            if (paymentIntent) {
                                //init payment
                                this.handlePaymentIntent(paymentIntent);
                            }
                        });
                    },
                    message: `Your card will be charged by $${Number(
                        formValues.rechargeToBalance
                    )}`,
                });
            } else {
                alertOptionsUpdate(projectId, value).then(() => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntent' does not exist on type 'R... Remove this comment to see the full error message
                    const { paymentIntent } = this.props;
                    if (paymentIntent) {
                        //init payment
                        this.handlePaymentIntent(paymentIntent);
                    }
                });
            }
        } else {
            openModal({
                id: projectId,
                content: Unauthorised,
            });
        }
    };

    handlePaymentIntent = (paymentIntentClientSecret: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'stripe' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { stripe, openModal, balance } = this.props;
        const { MessageBoxId } = this.state;
        stripe.handleCardPayment(paymentIntentClientSecret).then((result: $TSFixMe) => {
            if (
                result.paymentIntent &&
                result.paymentIntent.status === 'succeeded'
            ) {
                const creditedBalance = result.paymentIntent.amount / 100;
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message: `Transaction successful, your balance is now ${(
                        balance + creditedBalance
                    ).toFixed(2)}$`,
                });
            } else {
                openModal({
                    id: MessageBoxId,
                    content: MessageBox,
                    title: 'Message',
                    message:
                        'Transaction failed, try again later or use a different card.',
                });
            }
        });
    };

    componentDidUpdate() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
        const { formValues } = this.props;
        const rechargeToBalance = Number(formValues.rechargeToBalance);
        const minimumBalance = Number(formValues.minimumBalance);

        if (formValues.billingUS && minimumBalance < 20) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.change('minimumBalance', '20');
        }
        if (formValues.billingUS && rechargeToBalance < 40) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.change('rechargeToBalance', '40');
        }
        if (formValues.billingNonUSCountries && minimumBalance < 50) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.change('minimumBalance', '50');
        }
        if (formValues.billingNonUSCountries && rechargeToBalance < 100) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.change('rechargeToBalance', '100');
        }
        if (formValues.billingRiskCountries && minimumBalance < 100) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.change('minimumBalance', '100');
        }
        if (formValues.billingRiskCountries && rechargeToBalance < 200) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.change('rechargeToBalance', '200');
        }
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertEnable' does not exist on type 'Rea... Remove this comment to see the full error message
        const { alertEnable, formValues } = this.props;

        return (
            <div
                className="db-World-contentPane Box-root"
                style={{ paddingTop: 0 }}
            >
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Alert Option</span>
                                        </span>
                                        <p>
                                            <span>
                                                Configure options for Alerts
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                <form
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                                    onSubmit={this.props.handleSubmit(
                                        this.submitForm
                                    )}
                                >
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                        <div>
                                            <div
                                                id="alertOptionRow"
                                                className="bs-Fieldset-wrapper Box-root Margin-bottom--2"
                                            >
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '30% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <div
                                                            className="Box-root"
                                                            style={{
                                                                height: '5px',
                                                            }}
                                                        ></div>
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            <label
                                                                className="Checkbox"
                                                                id="alert"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name="alertEnable"
                                                                    className="Checkbox-source"
                                                                    id="alertEnable"
                                                                />
                                                                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                    <div className="Checkbox-target Box-root">
                                                                        <div className="Checkbox-color Box-root"></div>
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Enable
                                                                        call and
                                                                        SMS
                                                                        alerts
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <ShouldRender if={alertEnable}>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '30% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <label>
                                                                            Your
                                                                            Account
                                                                            is
                                                                            configured
                                                                            to
                                                                            be
                                                                            auto
                                                                            recharged.
                                                                            If
                                                                            your
                                                                            card
                                                                            needs
                                                                            additional
                                                                            step
                                                                            to
                                                                            authorize
                                                                            payment,
                                                                            wait
                                                                            for
                                                                            the
                                                                            popup
                                                                            to
                                                                            confirm
                                                                            the
                                                                            payment.
                                                                        </label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            If the initial
                                                            balance falls below
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="minimumBalance"
                                                                id="minimumBalance"
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            'Select amount',
                                                                    },
                                                                    {
                                                                        value:
                                                                            '20',
                                                                        label:
                                                                            '$20',
                                                                        show:
                                                                            formValues &&
                                                                            !formValues.billingNonUSCountries &&
                                                                            (formValues.billingNonUSCountries ||
                                                                                !formValues.billingRiskCountries),
                                                                    },
                                                                    {
                                                                        value:
                                                                            '50',
                                                                        label:
                                                                            '$50',
                                                                        show:
                                                                            formValues &&
                                                                            (formValues.billingUS ||
                                                                                !formValues.billingUS ||
                                                                                formValues.billingNonUSCountries) &&
                                                                            !formValues.billingRiskCountries,
                                                                    },
                                                                    {
                                                                        value:
                                                                            '100',
                                                                        label:
                                                                            '$100',
                                                                    },
                                                                    {
                                                                        value:
                                                                            '200',
                                                                        label:
                                                                            '$200',
                                                                    },
                                                                    {
                                                                        value:
                                                                            '400',
                                                                        label:
                                                                            '$400',
                                                                    },
                                                                    {
                                                                        value:
                                                                            '500',
                                                                        label:
                                                                            '$500',
                                                                    },
                                                                    {
                                                                        value:
                                                                            '750',
                                                                        label:
                                                                            '$750',
                                                                    },
                                                                    {
                                                                        value:
                                                                            '1000',
                                                                        label:
                                                                            '$1000',
                                                                    },
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Recharge the balance
                                                            to{' '}
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <span className="flex">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="rechargeToBalance"
                                                                    id="rechargeToBalance"
                                                                    validate={
                                                                        ValidateField.select
                                                                    }
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select amount',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '40',
                                                                            label:
                                                                                '$40',
                                                                            show:
                                                                                formValues &&
                                                                                !formValues.billingNonUSCountries &&
                                                                                (formValues.billingNonUSCountries ||
                                                                                    !formValues.billingRiskCountries),
                                                                        },
                                                                        {
                                                                            value:
                                                                                '100',
                                                                            label:
                                                                                '$100',
                                                                            show:
                                                                                formValues &&
                                                                                (formValues.billingUS ||
                                                                                    !formValues.billingUS ||
                                                                                    formValues.billingNonUSCountries) &&
                                                                                !formValues.billingRiskCountries,
                                                                        },
                                                                        {
                                                                            value:
                                                                                '200',
                                                                            label:
                                                                                '$200',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '400',
                                                                            label:
                                                                                '$400',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '500',
                                                                            label:
                                                                                '$500',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '750',
                                                                            label:
                                                                                '$750',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '1000',
                                                                            label:
                                                                                '$1000',
                                                                        },
                                                                    ]}
                                                                />
                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{children: Element[]; title: string; }' is ... Remove this comment to see the full error message
                                                                <Tooltip title="SMS and Call Alert Charges">
                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                            fontSize:
                                                                                '18px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                SMS
                                                                                Alert
                                                                                Charges
                                                                            </b>
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                US
                                                                                or
                                                                                Canadian
                                                                                Numbers
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Charge:
                                                                            $0.02
                                                                            /
                                                                            SMS
                                                                            /
                                                                            160
                                                                            Chars{' '}
                                                                            <br></br>
                                                                            Minimum
                                                                            Account
                                                                            Balance:
                                                                            $5{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Non-US
                                                                                Numbers
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Charge:
                                                                            $1 /
                                                                            SMS
                                                                            /
                                                                            160
                                                                            Chars{' '}
                                                                            <br></br>
                                                                            Minimum
                                                                            Account
                                                                            Balance:
                                                                            $10{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                High
                                                                                Risk
                                                                                Numbers
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Charge:
                                                                            $1 /
                                                                            SMS
                                                                            /
                                                                            160
                                                                            Chars{' '}
                                                                            <br></br>
                                                                            Minimum
                                                                            Account
                                                                            Balance:
                                                                            $20{' '}
                                                                        </p>
                                                                    </div>
                                                                    <br></br>
                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                            fontSize:
                                                                                '18px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Call
                                                                                Alert
                                                                                Charges
                                                                            </b>
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                US
                                                                                or
                                                                                Canadian
                                                                                Numbers
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Charge:
                                                                            $1{' '}
                                                                            <br></br>
                                                                            Minimum
                                                                            Account
                                                                            Balance:
                                                                            $10{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                Non-US
                                                                                Numbers
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Charge:
                                                                            $2{' '}
                                                                            <br></br>
                                                                            Minimum
                                                                            Account
                                                                            Balance:
                                                                            $20{' '}
                                                                        </p>
                                                                    </div>

                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            {' '}
                                                                            <b>
                                                                                High
                                                                                Risk
                                                                                Numbers
                                                                            </b>
                                                                        </p>
                                                                        <p>
                                                                            {' '}
                                                                            Charge:
                                                                            $5{' '}
                                                                            <br></br>
                                                                            Minimum
                                                                            Account
                                                                            Balance:
                                                                            $50{' '}
                                                                        </p>
                                                                    </div>
                                                                </Tooltip>
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '30% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <Field
                                                                        component="input"
                                                                        type="checkbox"
                                                                        name="billingUS"
                                                                        className="Checkbox-source"
                                                                        id="billingUS"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Enable
                                                                            call
                                                                            and
                                                                            SMS
                                                                            alerts
                                                                            to
                                                                            US,
                                                                            Canadian
                                                                            and
                                                                            UK
                                                                            Numbers
                                                                        </span>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '30% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <Field
                                                                        component="input"
                                                                        type="checkbox"
                                                                        name="billingNonUSCountries"
                                                                        className="Checkbox-source"
                                                                        id="billingNonUSCountries"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Enable
                                                                            call
                                                                            and
                                                                            SMS
                                                                            alerts
                                                                            to
                                                                            Non-US/UK/Canadian
                                                                            Numbers{' '}
                                                                            <a
                                                                                target="_blank"
                                                                                className="underline"
                                                                                rel="noopener noreferrer"
                                                                                href="https://www.twilio.com/docs/sip-trunking/voice-dialing-geographic-permissions#the-highest-risk-countries-for-toll-fraud-in-world"
                                                                            >
                                                                                <span>
                                                                                    (except
                                                                                    these
                                                                                    high
                                                                                    risk
                                                                                    countries)
                                                                                </span>
                                                                            </a>
                                                                        </span>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '30% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <PricingPlan
                                                                    plan="Startup"
                                                                    hideChildren={
                                                                        false
                                                                    }
                                                                >
                                                                    <label className="Checkbox">
                                                                        <Field
                                                                            component="input"
                                                                            type="checkbox"
                                                                            name="billingRiskCountries"
                                                                            className="Checkbox-source"
                                                                            id="billingRiskCountries"
                                                                        />
                                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                            <div className="Checkbox-target Box-root">
                                                                                <div className="Checkbox-color Box-root"></div>
                                                                            </div>
                                                                        </div>
                                                                        <div
                                                                            className="Box-root"
                                                                            style={{
                                                                                paddingLeft:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <span>
                                                                                Enable
                                                                                call
                                                                                and
                                                                                SMS
                                                                                alerts
                                                                                to{' '}
                                                                                <a
                                                                                    target="_blank"
                                                                                    className="underline"
                                                                                    rel="noopener noreferrer"
                                                                                    href="https://www.twilio.com/docs/sip-trunking/voice-dialing-geographic-permissions#the-highest-risk-countries-for-toll-fraud-in-world"
                                                                                >
                                                                                    <span>
                                                                                        these
                                                                                        high
                                                                                        risk
                                                                                        countries
                                                                                    </span>
                                                                                </a>
                                                                            </span>
                                                                        </div>
                                                                    </label>
                                                                </PricingPlan>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            className="bs-Fieldset-label"
                                                            style={{
                                                                flex: '30% 0 0',
                                                            }}
                                                        >
                                                            <span></span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <label className="Checkbox">
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <label></label>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                        <span className="db-SettingsForm-footerMessage"></span>
                                        <div>
                                            <button
                                                id="alertOptionSave"
                                                className="bs-Button bs-Button--blue"
                                                disabled={
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                                    this.props.isRequesting
                                                }
                                                type="submit"
                                            >
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                                        !this.props.isRequesting
                                                    }
                                                >
                                                    <span>Save</span>
                                                </ShouldRender>
                                                <ShouldRender
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                                    if={this.props.isRequesting}
                                                >
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
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AlertAdvanceOption.displayName = 'AlertAdvanceOption';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AlertAdvanceOption.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    projectId: PropTypes.string,
    alertOptionsUpdate: PropTypes.func,
    formValues: PropTypes.object,
    change: PropTypes.func,
    alertEnable: PropTypes.bool,
    stripe: PropTypes.object,
    paymentIntent: PropTypes.string,
    openModal: PropTypes.func.isRequired,
    balance: PropTypes.number,
    currentProject: PropTypes.object,
};

const formName = 'AlertAdvanceOption';

const AlertAdvanceOptionForm = new reduxForm({
    form: formName,
})(AlertAdvanceOption);

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ change, alertOptionsUpdate, openModal }, dispatch);

const mapStateToProps = (state: $TSFixMe) => ({
    projectId: state.project.currentProject && state.project.currentProject._id,
    project: state.project.currentProject,

    initialValues: {
        alertEnable: state.project.currentProject.alertEnable,
        billingNonUSCountries:
            state.project.currentProject.alertOptions.billingNonUSCountries,
        billingRiskCountries:
            state.project.currentProject.alertOptions.billingRiskCountries,
        billingUS: state.project.currentProject.alertOptions.billingUS,
        minimumBalance: state.project.currentProject.alertOptions.minimumBalance
            ? state.project.currentProject.alertOptions.minimumBalance.toString()
            : null,
        rechargeToBalance: state.project.currentProject.alertOptions
            .rechargeToBalance
            ? state.project.currentProject.alertOptions.rechargeToBalance.toString()
            : null,
    },

    alertEnable:
        state.form.AlertAdvanceOption &&
        state.form.AlertAdvanceOption.values.alertEnable,

    formValues:
        state.form.AlertAdvanceOption && state.form.AlertAdvanceOption.values,

    isRequesting: state.project.alertOptionsUpdate.requesting,
    error: state.project.alertOptionsUpdate.error,

    paymentIntent:
        state.project.alertOptionsUpdate.project &&
        state.project.alertOptionsUpdate.project.paymentIntent,

    balance:
        state.project.currentProject && state.project.currentProject.balance,

    currentProject: state.project.currentProject
});

const AlertAdvanceOptionFormStripe = injectStripe(
    connect(mapStateToProps, mapDispatchToProps)(AlertAdvanceOptionForm)
);

export default class AlertAdvanceOptionWithCheckout extends Component {
    render() {
        return (
            <StripeProvider apiKey={env('STRIPE_PUBLIC_KEY')}>
                <Elements>
                    <AlertAdvanceOptionFormStripe />
                </Elements>
            </StripeProvider>
        );
    }
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AlertAdvanceOptionWithCheckout.displayName = 'AlertAdvanceOptionWithCheckout';
