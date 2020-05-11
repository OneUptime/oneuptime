import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { PricingPlan, Validate } from '../../config';
import RadioInput from './RadioInput';
import { changePlan } from '../../actions/project';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.planId)) {
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

const ProjectUpgrade = ({
    handleSubmit,
    changePlan,
    isRequesting,
    error,
    project,
}) => {
    const plans = PricingPlan.getPlans();
    const enterprisePlan = {
        category: 'Enterprise',
        planId: 'enterprise',
    };

    const submit = values => {
        let oldPlan, newPlan;
        const { _id, name, stripePlanId } = project;

        if (values.planId === 'enterprise') {
            // handle upgrade to enterprise plan
            return changePlan(_id, values.planId, name);
        }

        if (stripePlanId === 'enterprise') {
            oldPlan = enterprisePlan.category;

            const {
                category: newCategory,
                type: newType,
                details: newDetails,
            } = PricingPlan.getPlanById(values.planId);
            newPlan = `${newCategory} ${newType}ly (${newDetails})`;
        } else {
            const {
                category: oldCategory,
                type: oldType,
                details: oldDetails,
            } = PricingPlan.getPlanById(stripePlanId);
            oldPlan = `${oldCategory} ${oldType}ly (${oldDetails})`;

            const {
                category: newCategory,
                type: newType,
                details: newDetails,
            } = PricingPlan.getPlanById(values.planId);
            newPlan = `${newCategory} ${newType}ly (${newDetails})`;
        }

        //change plan
        changePlan(_id, values.planId, name, oldPlan, newPlan);
    };

    return (
        <div id="planBox" className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Change Project Plan</span>
                            </span>
                            <p>
                                <span>
                                    Upgrade or change the plan of this project.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(submit)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="price-list-4c Margin-all--16">
                                                {plans.map(plan => (
                                                    <label
                                                        key={plan.planId}
                                                        htmlFor={`${plan.category}_${plan.type}`}
                                                        style={{
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        <div
                                                            className={`bs-Fieldset-fields Flex-justifyContent--center price-list-item Box-background--white ${
                                                                activeForm ===
                                                                plan.planId
                                                                    ? 'price-list-item--active'
                                                                    : ''
                                                            }`}
                                                            style={{
                                                                flex: 1,
                                                                padding: 0,
                                                            }}
                                                        key={index}
                                                        >
                                                            <span
                                                                style={{
                                                                    marginBottom:
                                                                        '4px',
                                                                }}
                                                            >
                                                                {plan.category}{' '}
                                                                {plan.type ===
                                                                'month'
                                                                    ? 'Monthly'
                                                                    : 'Yearly'}{' '}
                                                                Plan
                                                            </span>
                                                            <RadioInput
                                                                id={`${plan.category}_${plan.type}`}
                                                                details={
                                                                    plan.details
                                                                }
                                                                value={
                                                                    plan.planId
                                                                }
                                                                style={{
                                                                    display:
                                                                        'flex',
                                                                    alignItems:
                                                                        'center',
                                                                    justifyContent:
                                                                        'center',
                                                                }}
                                                            />
                                                        </div>
                                                    </label>
                                                ))}
                                                <label
                                                    htmlFor={
                                                        enterprisePlan.category
                                                    }
                                                    style={{
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <div
                                                        className={`bs-Fieldset-fields Flex-justifyContent--center price-list-item Box-background--white ${
                                                            activeForm ===
                                                            'enterprise'
                                                                ? 'price-list-item--active'
                                                                : ''
                                                        }`}
                                                        style={{
                                                            flex: 1,
                                                            padding: 0,
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                marginBottom:
                                                                    '4px',
                                                            }}
                                                        >
                                                            {
                                                                enterprisePlan.category
                                                            }{' '}
                                                            Plan
                                                        </span>
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                                alignItems:
                                                                    'center',
                                                                display: 'flex',
                                                                alignItems:
                                                                    'center',
                                                                justifyContent:
                                                                    'center',
                                                            }}
                                                        >
                                                            <Field
                                                                required={true}
                                                                component="input"
                                                                type="radio"
                                                                name="planId"
                                                                id={
                                                                    enterprisePlan.category
                                                                }
                                                                value={
                                                                    enterprisePlan.planId
                                                                }
                                                                className="Margin-right--12"
                                                            />
                                                            <label
                                                                htmlFor={
                                                                    enterprisePlan.category
                                                                }
                                                            >
                                                                {
                                                                    enterprisePlan.category
                                                                }
                                                            </label>
                                                        </div>
                                                    </div>
                                                </label>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label"></label>
                                                <div className="bs-Fieldset-fields">
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    ></span>
                                        </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage">
                                <ShouldRender if={!isRequesting && error}>
                                    <div className="Box-background--white">
                                        <div
                                            className="Padding-all--20"
                                            style={{ color: 'red' }}
                                        >
                                            {error}
                                        </div>
                                    </div>
                                </ShouldRender>
                            </span>
                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={isRequesting}
                                    type="submit"
                                    id="submitChangePlan"
                                >
                                    <ShouldRender if={isRequesting}>
                                        <FormLoader />
                                    </ShouldRender>
                                    <ShouldRender if={!isRequesting}>
                                        <span>Change Plan</span>
                                    </ShouldRender>
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

ProjectUpgrade.displayName = 'Project Upgrade';

ProjectUpgrade.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    isRequesting: PropTypes.bool,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    changePlan: PropTypes.func,
    project: PropTypes.object,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ changePlan }, dispatch);
};

const mapStateToProps = state => {
    const { requesting, error, project } =
        state.project && state.project.project;
    return {
        isRequesting: requesting,
        error,
        project: project && project,
        initialValues: {
            planId: project && project.stripePlanId,
        },
    };
};

const UpgradeProjectForm = new reduxForm({
    form: 'UpgradeProjectForm',
    validate,
    enableReinitialize: true,
})(ProjectUpgrade);

export default connect(mapStateToProps, mapDispatchToProps)(UpgradeProjectForm);
