import React, { Component } from 'react';
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

class ProjectUpgrade extends Component {
    constructor(props) {
        super(props);
        this.enterprisePlan = {
            category: 'Enterprise',
            planId: 'enterprise',
        };
        this.plansArr = PricingPlan.getPlans();

        this.getPlansFromToggle = (planDuration, plansArr) =>
            plansArr.filter(plan => plan.type === planDuration);

        this.state = {
            isAnnual: true,
            plans: this.getPlansFromToggle('annual', this.plansArr),
        };
    }

    componentDidUpdate(prevProps, prevState) {
        this.shouldTogglePlans(prevState);
    }

    shouldTogglePlans = prevState => {
        if (this.state.isAnnual !== prevState.isAnnual) {
            if (this.state.isAnnual) {
                this.setState({
                    plans: this.getPlansFromToggle('annual', this.plansArr),
                });
            } else {
                this.setState({
                    plans: this.getPlansFromToggle('month', this.plansArr),
                });
            }
        }
    };

    handlePlanToggle = () => {
        this.setState(prevState => ({ isAnnual: !prevState.isAnnual }));
    };

    submit = values => {
        const { project, changePlan } = this.props;
        let oldPlan, newPlan;
        const { _id, name, stripePlanId } = project;

        if (values.planId === 'enterprise') {
            // handle upgrade to enterprise plan
            return changePlan(_id, values.planId, name);
        }

        if (stripePlanId === 'enterprise') {
            oldPlan = this.enterprisePlan.category;

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

    render() {
        const { handleSubmit, isRequesting, error, activeForm } = this.props;
        const { isAnnual, plans } = this.state;

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
                                        Upgrade or change the plan of this
                                        project.
                                    </span>
                                </p>
                            </div>
                            <div
                                className="bs-Fieldset-row"
                                style={{
                                    padding: 0,
                                    display: 'flex',
                                    marginTop: 15,
                                }}
                            >
                                <label style={{ marginRight: 10 }}>
                                    {isAnnual
                                        ? 'Annual Plans'
                                        : 'Monthly Plans'}
                                </label>
                                <div>
                                    <label className="Toggler-wrap">
                                        <input
                                            className="btn-toggler"
                                            type="checkbox"
                                            onChange={() =>
                                                this.handlePlanToggle()
                                            }
                                            name="planDuration"
                                            id="planDuration"
                                            checked={isAnnual}
                                        />
                                        <span className="TogglerBtn-slider round"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit(this.submit)}>
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
                                                                cursor:
                                                                    'pointer',
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
                                                    <label
                                                        htmlFor={
                                                            this.enterprisePlan
                                                                .category
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
                                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                                <span
                                                                    style={{
                                                                        marginBottom:
                                                                            '4px',
                                                                    }}
                                                                >
                                                                    {
                                                                        this
                                                                            .enterprisePlan
                                                                            .category
                                                                    }{' '}
                                                                    Plan
                                                                </span>
                                                            </span>
                                                            <div
                                                                className="bs-Fieldset-field"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    display:
                                                                        'flex',
                                                                    alignItems:
                                                                        'center',
                                                                    justifyContent:
                                                                        'center',
                                                                    color:
                                                                        '#4c4c4c',
                                                                }}
                                                            >
                                                                <Field
                                                                    required={
                                                                        true
                                                                    }
                                                                    component="input"
                                                                    type="radio"
                                                                    name="planId"
                                                                    id={
                                                                        this
                                                                            .enterprisePlan
                                                                            .category
                                                                    }
                                                                    value={
                                                                        this
                                                                            .enterprisePlan
                                                                            .planId
                                                                    }
                                                                    className="Margin-right--12"
                                                                />
                                                                <label
                                                                    htmlFor={
                                                                        this
                                                                            .enterprisePlan
                                                                            .category
                                                                    }
                                                                >
                                                                    {
                                                                        this
                                                                            .enterprisePlan
                                                                            .category
                                                                    }
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </label>
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
    }
}

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
    activeForm: PropTypes.string,
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
        activeForm:
            state.form.UpgradeProjectForm &&
            state.form.UpgradeProjectForm.values.planId,
    };
};

const UpgradeProjectForm = new reduxForm({
    form: 'UpgradeProjectForm',
    validate,
    enableReinitialize: true,
})(ProjectUpgrade);

export default connect(mapStateToProps, mapDispatchToProps)(UpgradeProjectForm);
