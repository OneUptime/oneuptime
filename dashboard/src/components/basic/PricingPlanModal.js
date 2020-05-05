import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { PricingPlan, Validate } from '../../config';
import { FormLoader } from './Loader';
import ShouldRender from './ShouldRender';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.planId)) {
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

const PricingPlanModal = ({
    closeThisDialog,
    propArr,
    confirmThisDialog,
    handleSubmit,
    isRequesting,
    error,
}) => {
    const handleFormSubmit = values => {
        confirmThisDialog(values);
    };

    const plans = PricingPlan.getPlans();
    return (
        <div
            onKeyDown={e => e.key === 'Escape' && closeThisDialog()}
            className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            id="pricingPlanModal"
        >
            <div
                className="ModalLayer-contents"
                tabIndex={-1}
                style={{ marginTop: 40 }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <form onSubmit={handleSubmit(handleFormSubmit)}>
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Upgrade Plan</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    This feature is available on{' '}
                                    {propArr[0].plan} plan. Please upgrade your
                                    plan to access this feature.
                                </span>
                            </div>
                            <div className="bs-Modal-content">
                                <div className="Margin-bottom--12 Text-fontWeight--medium">
                                    Choose a Plan
                                </div>
                                {plans.map((plan, index) => (
                                    <>
                                        <div
                                            className="bs-Fieldset-fields .Flex-justifyContent--center Margin-bottom--12"
                                            style={{ flex: 1, padding: 0 }}
                                            key={index}
                                        >
                                            <span
                                                style={{ marginBottom: '4px' }}
                                            >
                                                {plan.category}{' '}
                                                {plan.type === 'month'
                                                    ? 'Monthly'
                                                    : 'Yearly'}{' '}
                                                Plan
                                            </span>
                                            <div
                                                className="bs-Fieldset-field"
                                                style={{
                                                    width: '100%',
                                                    alignItems: 'center',
                                                }}
                                            >
                                                <Field
                                                    required={true}
                                                    component="input"
                                                    type="radio"
                                                    name="planId"
                                                    id={`${plan.category}_${plan.type}`}
                                                    value={plan.planId}
                                                    className="Margin-right--12"
                                                />
                                                <label
                                                    htmlFor={`${plan.category}_${plan.type}`}
                                                >
                                                    {plan.details}
                                                </label>
                                            </div>
                                        </div>
                                    </>
                                ))}
                            </div>
                            <ShouldRender if={error}>
                                <div className="Box-background--white">
                                    <div className="Padding-all--20, color: 'red',">
                                        {error}
                                    </div>
                                </div>
                            </ShouldRender>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        id="cancelPlanUpgrade"
                                        className={`bs-Button ${isRequesting &&
                                            'bs-is-disabled'}`}
                                        type="button"
                                        onClick={e => {
                                            e.preventDefault();
                                            closeThisDialog();
                                        }}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id="confirmPlanUpgrade"
                                        className={`bs-Button bs-Button--blue`}
                                        type="submit"
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Upgrade</span>
                                        </ShouldRender>
                                        <ShouldRender if={isRequesting}>
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
    );
};

PricingPlanModal.displayName = 'Pricing Plan Modal';

PricingPlanModal.propTypes = {
    closeThisDialog: PropTypes.func,
    confirmThisDialog: PropTypes.func,
    propArr: PropTypes.array,
    initialValues: PropTypes.object,
    handleSubmit: PropTypes.func,
    isRequesting: PropTypes.bool,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = state => {
    const currentPlanId =
        state.project &&
        state.project.currentProject &&
        state.project.currentProject.stripePlanId
            ? state.project.currentProject.stripePlanId
            : '';

    return {
        initialValues: {
            // initial values for the redux form
            planId: currentPlanId,
        },
        isRequesting: state.project.changePlan.requesting,
        error: state.project.changePlan.error,
    };
};

const PricingForm = new reduxForm({
    form: 'PricingForm',
    validate,
    enableReinitialize: true,
})(PricingPlanModal);

export default connect(mapStateToProps)(PricingForm);
