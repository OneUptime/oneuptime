import React from 'react';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
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
} from 'react-stripe-elements';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.projectName)) {
        errors.name = 'Project Name is required!';
    }

    if (!Validate.text(values.planId)) {
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

const createOptions = (fontSize, padding) => {
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
    createToken = values => {
        const cardRegistered =
            User.isCardRegistered() === 'false' ? false : true;
        const {
            stripe,
            createProjectRequest,
            createProjectError,
            checkCard,
            email,
            companyName,
            submitForm,
        } = this.props;
        if (cardRegistered || !IS_SAAS_SERVICE) {
            submitForm(values);
        } else if (stripe && !cardRegistered) {
            createProjectRequest();
            stripe
                .createToken()
                .then(({ token }) => {
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
                .then(({ data }) =>
                    stripe.handleCardPayment(data.client_secret)
                )
                .then(result => {
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
                .catch(error => {
                    createProjectError(error.message);
                });
        } else {
            createProjectError('Network Error, please try again later.');
        }
    };

    render() {
        const { handleSubmit, hideForm, errorStack, requesting } = this.props;
        const cardRegistered = User.isCardRegistered();

        return (
            <form
                id="frmCreateProject"
                onSubmit={handleSubmit(this.createToken)}
            >
                <div className="bs-Modal bs-Modal--medium">
                    <div className="bs-Modal-header">
                        <div className="bs-Modal-header-copy">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Create New Project</span>
                            </span>
                        </div>
                        <div className="bs-Modal-messages">
                            <ShouldRender if={errorStack}>
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
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </fieldset>
                            <ShouldRender if={IS_SAAS_SERVICE}>
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <div className="Margin-bottom--12 Text-fontWeight--medium">
                                            Choose a Plan
                                        </div>
                                        <div
                                            className="bs-Fieldset-row .Flex-justifyContent--center"
                                            style={{
                                                padding: 0,
                                                flexDirection: 'column',
                                            }}
                                        >
                                            <PlanFields />
                                        </div>
                                    </div>
                                </fieldset>
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
                                                                {...createOptions(
                                                                    this.props
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
                                className={`bs-Button bs-DeprecatedButton ${requesting &&
                                    'bs-is-disabled'}`}
                                type="button"
                                onClick={hideForm}
                                disabled={requesting}
                            >
                                <span>Cancel</span>
                            </button>
                            <button
                                className={`bs-Button bs-DeprecatedButton bs-Button--blue ${requesting &&
                                    'bs-is-disabled'}`}
                                type="submit"
                                disabled={requesting}
                            >
                                <ShouldRender if={requesting}>
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
}

_ProjectForm.displayName = '_ProjectForm';

_ProjectForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    hideForm: PropTypes.func.isRequired,
    submitForm: PropTypes.func.isRequired,
    errorStack: PropTypes.array,
    submitFailed: PropTypes.bool,
    requesting: PropTypes.bool,
    stripe: PropTypes.object,
    createProjectError: PropTypes.func.isRequired,
    createProjectRequest: PropTypes.func.isRequired,
    checkCard: PropTypes.func.isRequired,
    email: PropTypes.string,
    companyName: PropTypes.string,
    elementFontSize: PropTypes.string,
};

const ProjectForm = new reduxForm({
    form: '_ProjectForm',
    validate,
})(_ProjectForm);

const mapStateToProps = state => {
    return {
        email:
            state.profileSettings.profileSetting &&
            state.profileSettings.profileSetting.data.email,
        companyName:
            state.profileSettings.profileSetting &&
            state.profileSettings.profileSetting.data.companyName,
    };
};

const mapDispatchToProps = dispatch => {
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
        super();
        this.state = {
            elementFontSize: window.innerWidth < 450 ? '14px' : '18px',
        };
        window.addEventListener('resize', () => {
            if (
                window.innerWidth < 450 &&
                this.state.elementFontSize !== '14px'
            ) {
                this.setState({ elementFontSize: '14px' });
            } else if (
                window.innerWidth >= 450 &&
                this.state.elementFontSize !== '18px'
            ) {
                this.setState({ elementFontSize: '18px' });
            }
        });
    }

    render() {
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

ProjectFormWithCheckout.displayName = 'ProjectFormWithCheckout';

export default ProjectFormWithCheckout;
