import React, { Fragment, useState } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { PricingPlan } from '../../config';
import PricingPlanModal from './PricingPlanModal';
import { openModal } from '../../actions/modal';

const PricingPlanComponent = ({
    plan,
    hideChildren,
    children,
    currentProject,
    openModal,
}) => {
    const [pricingPlanModalId] = useState(uuid.v4());

    const { category } = PricingPlan.getPlanById(currentProject.stripeId);

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
        e.stopPropagation();

        openModal({
            id: pricingPlanModalId,
            onConfirm: () => {
                //Todo: handle plan upgrade
            },
            content: PricingPlanModal,
            propArr: [{ plan }],
        });
    };

    return (
        <Fragment>
            {isAllowed(plan, category) ? (
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
};

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ openModal }, dispatch);
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PricingPlanComponent);
