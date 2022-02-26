import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { changePlan, fetchTrial } from '../../actions/project';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader, ListLoader } from '../basic/Loader';
import { PricingPlan } from '../../config';

import { User } from '../../config';
import ChangePlanField from './ChangePlanField';
import isOwnerOrAdmin from '../../utils/isOwnerOrAdmin';
import Unauthorised from '../modals/Unauthorised';
import { openModal } from '../../actions/modal';
import moment from 'moment';

function Validate(values: $TSFixMe) {
    const errors = {};

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'text' does not exist on type '(values: a... Remove this comment to see the full error message
    if (!Validate.text(values.planId)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

export class Plans extends Component {
    getPlansFromToggle: $TSFixMe;
    initialType: $TSFixMe;
    plansArr: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.plansArr = PricingPlan.getPlans();
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        this.initialType = PricingPlan.getPlanById(
            props.currentProject.stripePlanId
        ).type;

        this.getPlansFromToggle = (planDuration: $TSFixMe, plansArr: $TSFixMe) =>
            plansArr.filter((plan: $TSFixMe) => plan.type === planDuration);

        this.state = {
            isAnnual: this.initialType === 'annual' ? true : false,
            plans: this.getPlansFromToggle(this.initialType, this.plansArr),
        };
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchTrial' does not exist on type 'Read... Remove this comment to see the full error message
        const { fetchTrial, currentProject } = this.props;
        fetchTrial(currentProject._id);
    }

    componentDidUpdate(prevProps: $TSFixMe, prevState: $TSFixMe) {
        this.shouldTogglePlans(prevState);
    }

    shouldTogglePlans = (prevState: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isAnnual' does not exist on type 'Readon... Remove this comment to see the full error message
        if (this.state.isAnnual !== prevState.isAnnual) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isAnnual' does not exist on type 'Readon... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isAnnual' does not exist on type 'Readon... Remove this comment to see the full error message
        this.setState(prevState => ({ isAnnual: !prevState.isAnnual }));
    };

    submit = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, openModal } = this.props;
        const userId = User.getUserId();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { _id: id, name } = this.props.currentProject;
        if (isOwnerOrAdmin(userId, currentProject)) {
            const {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type '{ cate... Remove this comment to see the full error message
                category: oldCategory,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{ category... Remove this comment to see the full error message
                type: oldType,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'details' does not exist on type '{ categ... Remove this comment to see the full error message
                details: oldDetails,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            } = PricingPlan.getPlanById(this.props.initialValues.planId);
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePlan' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.changePlan(id, values.planId, name, oldPlan, newPlan);
        } else {
            openModal({ id: userId, content: Unauthorised });
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
            error,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeForm' does not exist on type 'Read... Remove this comment to see the full error message
            activeForm,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequestingTrial' does not exist on typ... Remove this comment to see the full error message
            isRequestingTrial,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'trialEndDate' does not exist on type 'Re... Remove this comment to see the full error message
            trialEndDate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'trialLeft' does not exist on type 'Reado... Remove this comment to see the full error message
            trialLeft,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isAnnual' does not exist on type 'Readon... Remove this comment to see the full error message
        const { isAnnual, plans } = this.state;

        return (
            <form onSubmit={handleSubmit(this.submit)}>
                <div
                    className="db-World-contentPane Box-root"
                    style={{ paddingTop: 0 }}
                >
                    <div className="db-RadarRulesLists-page">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <div className="Box-root">
                                    <ShouldRender if={isRequestingTrial}>
                                        <div className="Padding-horizontal--20 Padding-top--20 Flex-justifyContent--flexStart">
                                            <ListLoader
                                                style={{
                                                    textAlign: 'left',
                                                    marginTop: 0,
                                                }}
                                            />
                                        </div>
                                    </ShouldRender>
                                    <ShouldRender
                                        if={!isRequesting && trialEndDate}
                                    >
                                        <div className="Padding-horizontal--20 Padding-top--20 Flex-justifyContent--flexStart">
                                            <div className="Badge Badge--color--blue Box-background--red bg-red-700 Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text bg-red-700 Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span className="Text-color--white">
                                                        Trial period (
                                                        {trialLeft} days left)
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </ShouldRender>

                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    Change OneUptime Plan
                                                </span>
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
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                        <div>
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <fieldset className="bs-Fieldset">
                                                    <div className="bs-Fieldset-rows">
                                                        <div className="price-list-3c Margin-all--16">
                                                            <ChangePlanField
                                                                plans={plans}
                                                                activeForm={
                                                                    activeForm
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                        <span className="db-SettingsForm-footerMessage">
                                            <ShouldRender
                                                if={!isRequesting && error}
                                            >
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
                                                className="bs-Button bs-Button--blue"
                                                type="submit"
                                                id="changePlanBtn"
                                            >
                                                <ShouldRender
                                                    if={!isRequesting}
                                                >
                                                    <span>Change Plan</span>
                                                </ShouldRender>
                                                <ShouldRender if={isRequesting}>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Plans.displayName = 'Plans';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Plans.propTypes = {
    changePlan: PropTypes.func.isRequired,
    fetchTrial: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    initialValues: PropTypes.object.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    trialLeft: PropTypes.number.isRequired,
    trialEndDate: PropTypes.oneOf([PropTypes.string, PropTypes.bool]),
    isRequestingTrial: PropTypes.oneOf([null, undefined, true, false]),
    activeForm: PropTypes.string,
    error: PropTypes.string,
    openModal: PropTypes.func,
};

const ChangePlan = new reduxForm({
    form: 'ChangePlan',
    Validate,
})(Plans);

const mapStateToProps = (state: $TSFixMe) => {
    const planId = state.project.currentProject
        ? state.project.currentProject.stripePlanId
        : '';

    let trialEndDate =
        state.project.trialPeriod && state.project.trialPeriod.trial_end
            ? state.project.trialPeriod.trial_end
            : false;
    let trialLeft = 0;

    if (trialEndDate) {
        trialLeft = moment(trialEndDate).diff(new Date(), 'days') + 1;
        if (trialLeft <= 0) {
            trialEndDate = false;
        }
    }
    return {
        initialValues: { planId },
        currentProject: state.project.currentProject,
        isRequesting: state.project.changePlan.requesting,
        error: state.project.changePlan.error,
        activeForm:
            state.form.ChangePlan && state.form.ChangePlan.values.planId,
        trialLeft,
        trialEndDate,
        isRequestingTrial: state.project.trialPeriod.requesting,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ changePlan, openModal, fetchTrial }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(ChangePlan);
