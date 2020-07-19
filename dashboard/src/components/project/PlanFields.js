import React from 'react';
import RadioInput from './RadioInput';
import { PricingPlan } from '../../config';

export default function PlanFields() {
    let list = [];
    const plans = PricingPlan.getPlans();
    list = plans.map((plan, index) => (
        <>
            <div
                className="bs-Fieldset-fields .Flex-justifyContent--center Margin-bottom--12"
                style={{ flex: 1, padding: 0 }}
                key={index}
            >
                <span style={{ marginBottom: '4px' }}>
                    {plan.category}{' '}
                    {plan.type === 'month' ? 'Monthly' : 'Yearly'} Plan
                </span>
                <RadioInput
                    id={`${plan.category}_${plan.type}`}
                    details={plan.details}
                    value={plan.planId}
                />
            </div>
        </>
    ));
    return list;
}
