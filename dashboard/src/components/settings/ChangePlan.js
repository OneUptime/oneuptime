import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { reduxForm } from 'redux-form';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { changePlan } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import PlanFields from '../project/PlanFields';
import { PricingPlan } from '../../config';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

function Validate(values) {
    const errors = {};

    if (!Validate.text(values.planId)) {
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

export class Plans extends Component {
    submit = values => {
        const { _id: id, name } = this.props.currentProject;
        const {
            category: oldCategory,
            type: oldType,
            details: oldDetails,
        } = PricingPlan.getPlanById(this.props.initialValues.planId);
        const oldPlan = `${oldCategory} ${oldType}ly (${oldDetails})`;
        const {
            category: newCategory,
            type: newType,
            details: newDetails,
        } = PricingPlan.getPlanById(values.planId);
        const newPlan = `${newCategory} ${newType}ly (${newDetails})`;
        this.props.changePlan(id, values.planId, name, oldPlan, newPlan);
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('EVENT: DASHBOARD > PROJECT > PLAN CHANGED', {
                oldPlan,
                newPlan,
            });
        }
    };

    render() {
        return (
            <form onSubmit={this.props.handleSubmit(this.submit)}>
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
                                                <span>Change Fyipe Plan</span>
                                            </span>
                                            <p>
                                                <span>
                                                    Upgrade or change your
                                                    subscription. To cancel your
                                                    subscription, please delete
                                                    this project.
                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                        <div>
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <fieldset className="bs-Fieldset">
                                                    <div className="bs-Fieldset-rows">
                                                        <div className="bs-Fieldset-row">
                                                            <PlanFields />
                                                        </div>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label"></label>
                                                            <div className="bs-Fieldset-fields">
                                                                <span
                                                                    className="value"
                                                                    style={{
                                                                        marginTop:
                                                                            '6px',
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
                                        <span className="db-SettingsForm-footerMessage"></span>
                                        <div>
                                            <button
                                                className="bs-Button bs-Button--blue"
                                                type="submit"
                                            >
                                                <ShouldRender
                                                    if={
                                                        !this.props.isRequesting
                                                    }
                                                >
                                                    <span>Change Plan</span>
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={this.props.isRequesting}
                                                >
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

Plans.displayName = 'Plans';

Plans.propTypes = {
    changePlan: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    initialValues: PropTypes.object.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
};

const ChangePlan = new reduxForm({
    form: 'ChangePlan',
    Validate,
})(Plans);

const mapStateToProps = state => {
    const planId = state.project.currentProject
        ? state.project.currentProject.stripePlanId
        : '';
    return {
        initialValues: { planId },
        currentProject: state.project.currentProject,
        isRequesting: state.project.changePlan.requesting,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ changePlan }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(ChangePlan);
