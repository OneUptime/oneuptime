import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import PlanFields from './PlanFields';
import { Spinner } from '../basic/Loader';
import { User, Validate, env, IS_SAAS_SERVICE } from '../../config';
import {
    checkCard,
    createProjectRequest,
    createProjectError,
} from '../../actions/project';
import {
    CardElement,
    StripeProvider,
    Elements,
    injectStripe,
    // @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
} from '@stripe/react-stripe-js';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.projectName)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Project Name is required!';
    }

    if (!Validate.text(values.planId)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

const createOptions = (fontSize: $TSFixMe, padding: $TSFixMe) => {
    return {
        style: {
            base: {
                fontSize,
                color: '#424770',
                letterSpacing: '0.025em',
                fontFamily: 'Source Code Pro, monospace',
                '::placeholder': {
                    color: '#aab7c4',
                },
                padding,
            },
            invalid: {
                color: '#9e2146',
            },
        },
    };
};

class _ProjectForm extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideForm' does not exist on type 'Readon... Remove this comment to see the full error message
                return this.props.hideForm();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('btnCreateProject').click();
            default:
                return false;
        }
    };

    createToken = (values: $TSFixMe) => {
        const cardRegistered =
            User.isCardRegistered() === 'false' ? false : true;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'stripe' does not exist on type 'Readonly... Remove this comment to see the full error message
            stripe,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createProjectRequest' does not exist on ... Remove this comment to see the full error message
            createProjectRequest,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createProjectError' does not exist on ty... Remove this comment to see the full error message
            createProjectError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'checkCard' does not exist on type 'Reado... Remove this comment to see the full error message
            checkCard,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
            email,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyName' does not exist on type 'Rea... Remove this comment to see the full error message
            companyName,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'submitForm' does not exist on type 'Read... Remove this comment to see the full error message
            submitForm,
        } = this.props;
        if (cardRegistered || !IS_SAAS_SERVICE) {
            submitForm(values);
        } else if (stripe && !cardRegistered) {
            createProjectRequest();
            stripe
                .createToken()
                .then(({
                    token
                }: $TSFixMe) => {
                    if (token) {
                        return checkCard({
                            tokenId: token.id,
                            email,
                            companyName,
                        });
                    } else {
                        throw new Error('Invalid card Details.');
                    }
                })
                .then(({
                    data
                }: $TSFixMe) =>
                    stripe.handleCardPayment(data.client_secret)
                )
                .then((result: $TSFixMe) => {
                    if (
                        result.paymentIntent &&
                        result.paymentIntent.status === 'succeeded'
                    ) {
                        submitForm({
                            ...values,
                            paymentIntent: result.paymentIntent.id,
                        });
                    } else {
                        throw new Error(result.error.message);
                    }
                })
                .catch((error: $TSFixMe) => {
                    createProjectError(error.message);
                });
        } else {
            createProjectError('Network Error, please try again later.');
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideForm' does not exist on type 'Readon... Remove this comment to see the full error message
            hideForm,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorStack' does not exist on type 'Read... Remove this comment to see the full error message
            errorStack,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activePlan' does not exist on type 'Read... Remove this comment to see the full error message
            activePlan,
        } = this.props;
        const cardRegistered = User.isCardRegistered();

        return (
            <form
                id="frmCreateProject"
                onSubmit={handleSubmit(this.createToken)}
            >
                <div className="bs-Modal bs-Modal--medium">
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideForm' does not exist on type 'Readon... Remove this comment to see the full error message
                    <ClickOutside onClickOutside={this.props.hideForm}>
                        <div className="bs-Modal-header">
                            <div className="bs-Modal-header-copy">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Create New Project</span>
                                </span>
                                <ShouldRender if={IS_SAAS_SERVICE}>
                                    <div className="Text-fontWeight--regular Text-fontSize--14 Margin-top--8">
                                        <span>
                                            To compare different pricing plans,
                                            click{' '}
                                            <a
                                                href="https://oneuptime.com/pricing#compare"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="Text-fontWeight--medium underline"
                                            >
                                                here
                                            </a>
                                        </span>
                                    </div>
                                </ShouldRender>
                            </div>
                            <div className="bs-Modal-messages">
                                <ShouldRender if={errorStack}>
                                    <p className="bs-Modal-message">
                                        {errorStack}
                                    </p>
                                </ShouldRender>
                            </div>
                        </div>
                        <div className="bs-Modal-content">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                You can always change the new project name
                                later.
                            </span>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <div className="projectNameClass">
                                    <div className="bs-Fieldset-rows">
                                        <div
                                            className="bs-Fieldset-row"
                                            style={{ padding: 0 }}
                                        >
                                            <label
                                                className="bs-Fieldset-label Text-align--left"
                                                htmlFor="name"
                                            >
                                                <span>Project Name</span>
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <div
                                                    className="bs-Fieldset-field"
                                                    style={{ width: '70%' }}
                                                >
                                                    <Field
                                                        required={true}
                                                        component="input"
                                                        name="projectName"
                                                        placeholder="Enter Project Name"
                                                        id="name"
                                                        className="bs-TextInput"
                                                        style={{
                                                            width: '100%',
                                                            padding: '3px 5px',
                                                        }}
                                                        autoFocus={true}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <ShouldRender if={IS_SAAS_SERVICE}>
                                    <div
                                        className="bs-Modal-content"
                                        style={{
                                            padding: 0,
                                            marginLeft: -20,
                                            marginRight: -20,
                                            marginBottom: -20,
                                            marginTop: 10,
                                        }}
                                    >
                                        <fieldset
                                            className="bs-Fieldset"
                                            style={{ padding: 0 }}
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <div className="price-list-2c Margin-all--16">
                                                    // @ts-expect-error ts-migrate(2786) FIXME: 'PlanFields' cannot be used as a JSX component.
                                                    <PlanFields
                                                        activePlan={activePlan}
                                                    />
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                    <ShouldRender
                                        if={
                                            !cardRegistered ||
                                            cardRegistered === 'false'
                                        }
                                    >
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="Margin-bottom--12 Text-fontWeight--medium">
                                                    Your Credit or Debit Card
                                                </div>
                                                <div className="bs-Modal-block bs-u-paddingless">
                                                    <div className="bs-Modal-content">
                                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                            <label>
                                                                <CardElement
                                                                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                                                                    {...createOptions(
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'elementFontSize' does not exist on type ... Remove this comment to see the full error message
                                                                            .elementFontSize
                                                                    )}
                                                                />
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </ShouldRender>
                                </ShouldRender>
                            </div>
                        </div>
                        <div className="bs-Modal-footer">
                            <div className="bs-Modal-footer-actions">
                                <button
                                    id="btnCancelProject"
                                    className={`bs-Button btn__modal bs-DeprecatedButton ${requesting &&
                                        'bs-is-disabled'}`}
                                    type="button"
                                    onClick={hideForm}
                                    disabled={requesting}
                                >
                                    <span>Cancel</span>
                                    <span className="cancel-btn__keycode">
                                        Esc
                                    </span>
                                </button>
                                <button
                                    id="btnCreateProject"
                                    className={`bs-Button btn__modal bs-DeprecatedButton bs-Button--blue ${requesting &&
                                        'bs-is-disabled'}`}
                                    type="submit"
                                    disabled={requesting}
                                >
                                    <ShouldRender if={requesting}>
                                        <Spinner />
                                    </ShouldRender>

                                    <span>Create Project</span>
                                    <span className="create-btn__keycode">
                                        <span className="keycode__icon keycode__icon--enter" />
                                    </span>
                                </button>
                            </div>
                        </div>
                    </ClickOutside>
                </div>
            </form>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
_ProjectForm.displayName = '_ProjectForm';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
_ProjectForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    hideForm: PropTypes.func.isRequired,
    submitForm: PropTypes.func.isRequired,
    errorStack: PropTypes.array,
    submitFailed: PropTypes.bool,
    requesting: PropTypes.bool,
    stripe: PropTypes.object,
    initialValues: PropTypes.object.isRequired,
    createProjectError: PropTypes.func.isRequired,
    createProjectRequest: PropTypes.func.isRequired,
    checkCard: PropTypes.func.isRequired,
    email: PropTypes.string,
    companyName: PropTypes.string,
    elementFontSize: PropTypes.string,
    activePlan: PropTypes.string,
};

const ProjectForm = new reduxForm({
    form: '_ProjectForm',
    validate,
})(_ProjectForm);

const mapStateToProps = (state: $TSFixMe) => {
    let planId;
    if (
        env('STRIPE_PUBLIC_KEY') &&
        env('STRIPE_PUBLIC_KEY').startsWith('pk_test')
    ) {
        planId = 'plan_H9IlBKhsFz4hV2';
    } else {
        planId = 'plan_H9IjvX2Flsvlcg';
    }

    return {
        initialValues: { planId },
        email:
            state.profileSettings.profileSetting &&
            state.profileSettings.profileSetting.data.email,
        companyName:
            state.profileSettings.profileSetting &&
            state.profileSettings.profileSetting.data.companyName,
        activePlan:
            state.form._ProjectForm &&
            state.form._ProjectForm.values &&
            state.form._ProjectForm.values.planId,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            createProjectRequest,
            createProjectError,
            checkCard,
        },
        dispatch
    );
};
const ProjectFormStripe = injectStripe(
    connect(mapStateToProps, mapDispatchToProps)(ProjectForm)
);

class ProjectFormWithCheckout extends React.Component {
    constructor() {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1-2 arguments, but got 0.
        super();
        this.state = {
            elementFontSize: window.innerWidth < 450 ? '14px' : '18px',
        };
        window.addEventListener('resize', () => {
            if (
                window.innerWidth < 450 &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'elementFontSize' does not exist on type ... Remove this comment to see the full error message
                this.state.elementFontSize !== '14px'
            ) {
                this.setState({ elementFontSize: '14px' });
            } else if (
                window.innerWidth >= 450 &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'elementFontSize' does not exist on type ... Remove this comment to see the full error message
                this.state.elementFontSize !== '18px'
            ) {
                this.setState({ elementFontSize: '18px' });
            }
        });
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'elementFontSize' does not exist on type ... Remove this comment to see the full error message
        const { elementFontSize } = this.state;
        return (
            <StripeProvider apiKey={env('STRIPE_PUBLIC_KEY')}>
                <div className="Checkout">
                    <Elements>
                        <ProjectFormStripe
                            fontSize={elementFontSize}
                            {...this.props}
                        />
                    </Elements>
                </div>
            </StripeProvider>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProjectFormWithCheckout.displayName = 'ProjectFormWithCheckout';

export default ProjectFormWithCheckout;
