import React, { Fragment, useState } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import {
    PricingPlan,
    SHOULD_LOG_ANALYTICS,
    IS_SAAS_SERVICE,
} from '../../config';
import { logEvent } from '../../analytics';
import PricingPlanModal from './PricingPlanModal';
import { openModal } from '../../actions/modal';
import { changePlan } from '../../actions/project';

const PricingPlanComponent = ({
    plan,
    hideChildren,
    children,
    currentProject,
    openModal,
    changePlan,
    currentPlanId,
    error,
}) => {
    const [pricingPlanModalId] = useState(uuid.v4()); // initialise modal ID
    const { category } = PricingPlan.getPlanById(currentProject.stripePlanId);

    const createAllowedPlans = plan => {
        const plans = ['Startup', 'Growth', 'Scale', 'Enterprise'];
        const planIndex = plans.indexOf(plan);
        const allowedPlans = [];
        for (let i = planIndex; i < plans.length; i++) {
            allowedPlans.push(plans[i]);
        }

        return allowedPlans;
    };

    const isAllowed = (plan, category) => {
        const allowedPlans = createAllowedPlans(plan);
        return allowedPlans.includes(category);
    };

    const handleModal = e => {
        e.preventDefault();

        const { _id: id, name } = currentProject;
        const {
            category: oldCategory,
            type: oldType,
            details: oldDetails,
        } = PricingPlan.getPlanById(currentPlanId);
        const oldPlan = `${oldCategory} ${oldType}ly (${oldDetails})`;

        openModal({
            id: pricingPlanModalId,
            onConfirm: values => {
                const {
                    category: newCategory,
                    type: newType,
                    details: newDetails,
                } = PricingPlan.getPlanById(values.planId);

                const newPlan = `${newCategory} ${newType}ly (${newDetails})`;
                return changePlan(
                    id,
                    values.planId,
                    name,
                    oldPlan,
                    newPlan
                ).then(() => {
                    if (error) {
                        // prevent dismissal of modal when errored
                        return handleModal();
                    }

                    if (SHOULD_LOG_ANALYTICS) {
                        logEvent('Plan Changed', { oldPlan, newPlan });
                    }

                    if (window.location.href.indexOf('localhost') <= -1) {
                        PricingPlanComponent.context.mixpanel.track(
                            'Project plan changed'
                        );
                    }
                });
            },
            content: PricingPlanModal,
            propArr: [{ plan }],
        });
    };

    return (
        <Fragment>
            {!IS_SAAS_SERVICE ? (
                children
            ) : isAllowed(plan, category) ? (
                children
            ) : !hideChildren ? (
                <div id="pricingPlan" onClick={handleModal}>
                    {children}
                </div>
            ) : null}
        </Fragment>
    );
};

PricingPlanComponent.displayName = 'PricingPlan Component';

PricingPlanComponent.propTypes = {
    plan: PropTypes.string.isRequired,
    hideChildren: PropTypes.bool.isRequired,
    children: PropTypes.element.isRequired,
    currentProject: PropTypes.object,
    openModal: PropTypes.func,
    currentPlanId: PropTypes.string,
    changePlan: PropTypes.func,
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
        currentProject: state.project.currentProject,
        currentPlanId,
        error: state.project.changePlan.error,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ openModal, changePlan }, dispatch);
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PricingPlanComponent);
