import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
import { PricingPlan, Validate } from '../../config';
import { FormLoader } from './Loader';
import ShouldRender from './ShouldRender';
import { changePlan } from '../../actions/project';
import { closeModal } from '../../actions/modal';

import RadioInput from '../project/RadioInput';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.planId)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

class PricingPlanModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('confirmPlanUpgrade').click();
            default:
                break;
        }
    };

    handleFormSubmit = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentPlanId' does not exist on type 'R... Remove this comment to see the full error message
            currentPlanId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalId' does not exist on type 'Readonl... Remove this comment to see the full error message
            modalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePlan' does not exist on type 'Read... Remove this comment to see the full error message
            changePlan,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
            error,
        } = this.props;
        const { _id: id, name } = currentProject;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type '{ cate... Remove this comment to see the full error message
            category: oldCategory,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{ category... Remove this comment to see the full error message
            type: oldType,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'details' does not exist on type '{ categ... Remove this comment to see the full error message
            details: oldDetails,
        } = PricingPlan.getPlanById(currentPlanId);
        const oldPlan = `${oldCategory} ${oldType}ly (${oldDetails})`;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type '{ cate... Remove this comment to see the full error message
            category: newCategory,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{ category... Remove this comment to see the full error message
            type: newType,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'details' does not exist on type '{ categ... Remove this comment to see the full error message
            details: newDetails,
        } = PricingPlan.getPlanById(values.planId);

        const newPlan = `${newCategory} ${newType}ly (${newDetails})`;

        changePlan(id, values.planId, name, oldPlan, newPlan).then(() => {
            if (!error) {
                return closeModal({
                    id: modalId,
                });
            }
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'propArr' does not exist on type 'Readonl... Remove this comment to see the full error message
            propArr,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
            error,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activePlan' does not exist on type 'Read... Remove this comment to see the full error message
            activePlan,
        } = this.props;

        const plans = PricingPlan.getPlans();
        return (
            <div
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
                            <form
                                onSubmit={handleSubmit(this.handleFormSubmit)}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Upgrade Plan</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    {propArr[0].plan === 'Enterprise' ? (
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            This feature is available on
                                            Enterprise Plan. To upgrade to this
                                            plan, please contact
                                            sales@oneuptime.com
                                        </span>
                                    ) : (
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            This feature is available on{' '}
                                            <strong>
                                                {propArr[0].plan} plan and
                                                above.
                                            </strong>{' '}
                                            Please upgrade your plan to access
                                            this feature.
                                        </span>
                                    )}
                                </div>
                                <ShouldRender
                                    if={propArr[0].plan !== 'Enterprise'}
                                >
                                    <div
                                        className="bs-Modal-content"
                                        style={{ padding: 0 }}
                                    >
                                        <fieldset
                                            className="bs-Fieldset"
                                            style={{ padding: 0 }}
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <div className="price-list-2c Margin-all--16">
                                                    {plans.map(plan => (
                                                        <label
                                                            key={plan.planId}
                                                            htmlFor={`${plan.category}_${plan.type}`}
                                                            style={{
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                        >
                                                            <div
                                                                className={`bs-Fieldset-fields Flex-justifyContent--center price-list-item Box-background--white ${
                                                                    activePlan ===
                                                                    plan.planId
                                                                        ? 'price-list-item--active'
                                                                        : ''
                                                                }`}
                                                                style={{
                                                                    flex: 1,
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                    <span
                                                                        style={{
                                                                            marginBottom:
                                                                                '4px',
                                                                        }}
                                                                    >
                                                                        {
                                                                            plan.category
                                                                        }{' '}
                                                                        {plan.type ===
                                                                        'month'
                                                                            ? 'Monthly'
                                                                            : 'Yearly'}{' '}
                                                                        Plan
                                                                    </span>
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
                                                                        color:
                                                                            '#4c4c4c',
                                                                    }}
                                                                />
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={error}>
                                    <div className="Box-background--white">
                                        <div
                                            className="Padding-all--20"
                                            style={{ color: 'red' }}
                                        >
                                            {error}
                                        </div>
                                    </div>
                                </ShouldRender>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            id="cancelPlanUpgrade"
                                            className={`bs-Button btn__modal ${isRequesting &&
                                                'bs-is-disabled'}`}
                                            type="button"
                                            onClick={e => {
                                                e.preventDefault();
                                                closeThisDialog();
                                            }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        {propArr[0].plan === 'Enterprise' ? (
                                            <a
                                                id="enterpriseMail"
                                                className={`bs-Button bs-Button--blue`}
                                                href="mailto:sales@oneuptime.com"
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: string; id: string; className: s... Remove this comment to see the full error message
                                                autoFocus={true}
                                            >
                                                Contact Sales
                                            </a>
                                        ) : (
                                            <button
                                                id="confirmPlanUpgrade"
                                                className={`bs-Button bs-Button--blue btn__modal`}
                                                type="submit"
                                                autoFocus={true}
                                            >
                                                <ShouldRender
                                                    if={!isRequesting}
                                                >
                                                    <span>Upgrade</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </ShouldRender>
                                                <ShouldRender if={isRequesting}>
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
PricingPlanModal.displayName = 'Pricing Plan Modal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
PricingPlanModal.propTypes = {
    closeThisDialog: PropTypes.func,
    propArr: PropTypes.array,
    handleSubmit: PropTypes.func,
    isRequesting: PropTypes.bool,
    error: PropTypes.string,
    closeModal: PropTypes.func,
    currentProject: PropTypes.object,
    currentPlanId: PropTypes.string,
    modalId: PropTypes.string,
    changePlan: PropTypes.func,
    activePlan: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe) => {
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
        currentProject: state.project.currentProject,
        currentPlanId,
        modalId: state.modal.modals[0].id,
        activePlan:
            state.form.PricingForm && state.form.PricingForm.values.planId,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ closeModal, changePlan }, dispatch);

const PricingForm = new reduxForm({
    form: 'PricingForm',
    validate,
    enableReinitialize: true,
})(PricingPlanModal);

export default connect(mapStateToProps, mapDispatchToProps)(PricingForm);
