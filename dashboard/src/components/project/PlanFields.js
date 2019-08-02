import React from 'react';
import RadioInput from './RadioInput';
import { PricingPlan } from '../../config';

export default function PlanFields() {
    let list = [];
    const plans = PricingPlan.getPlans();
    list = plans.map((plan, index) => (
        <div className="bs-Fieldset-fields .Flex-justifyContent--center" style={{ flex: 1, padding: 0 }} key={index}>
            <span className="Margin-bottom--12">
                {plan.type} Plan
            </span>
            <RadioInput
                id={`${plan.category}_${plan.type}`}
                details={plan.details}
                value={plan.planId}
            />
        </div>
    ))
    return list;
}