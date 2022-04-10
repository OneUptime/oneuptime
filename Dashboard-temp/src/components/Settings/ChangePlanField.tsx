import React from 'react';
import RadioInput from '../project/RadioInput';

export default function ChangePlanField({
    plans,
    activeForm
}: $TSFixMe) {
    let list = [];
    list = plans.map((plan: $TSFixMe) => <label
        key={plan.planId}
        htmlFor={`${plan.category}_${plan.type}`}
        style={{
            cursor: 'pointer',
        }}
    >
        <div
            className={`bs-Fieldset-fields Flex-justifyContent--center price-list-item Box-background--white ${
                activeForm === plan.planId ? 'price-list-item--active' : ''
            }`}
            style={{
                flex: 1,
                padding: 0,
            }}
        >
            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                <span
                    style={{
                        marginBottom: '4px',
                    }}
                >
                    {plan.category}{' '}
                    {plan.type === 'month' ? 'Monthly' : 'Yearly'} Plan
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
    </label>);
    return list;
}
