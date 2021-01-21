import React from 'react';
import RadioInput from './RadioInput';
import { PricingPlan } from '../../config';

export default function PlanFields({ activePlan }) {
    let list = [];
    const plans = PricingPlan.getPlans();
    list = plans.reverse().map(plan => (
        <label
            key={plan.planId}
            htmlFor={`${plan.category}_${plan.type}`}
            style={{
                cursor: 'pointer',
            }}
        >
            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Margin-bottom--4">
                <div className="Box-root">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                        <span>{plan.title}</span>
                    </span>
                </div>
            </div>

            <div
                className={`bs-Fieldset-fields Flex-justifyContent--center price-list-item Box-background--white ${
                    activePlan === plan.planId ? 'price-list-item--active' : ''
                } ${!plan.title ? 'Margin-top--24' : null}`}
                style={{
                    flex: 1,
                    padding: 0,
                }}
            >
                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                    <span
                        style={{
                            marginBottom: '4px',
                        }}
                    >
                        {plan.type === 'month' ? 'Monthly' : 'Yearly'}
                    </span>
                </span>
                <RadioInput
                    id={`${plan.category}_${plan.type}`}
                    details={plan.details}
                    value={plan.planId}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#4c4c4c',
                    }}
                />
            </div>
        </label>
    ));
    return list;
}
