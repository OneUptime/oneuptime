import React from 'react';
import RadioInput from './RadioInput';
import { PricingPlan } from '../../config';
import ShouldRender from '../basic/ShouldRender';

export default function UpgradePlanFields(props) {
    const { 
        currentProject,
        projects
    } = props

    const list = [];
    const plans = PricingPlan.getPlans();

    const reducedPlans = plans.reduce((filtered, plan, index) => {
        if (currentProject.stripePlanId === plan.planId) {
            for (let i = 0; i < plans.length; i++) {
                if (i > index && plans[index].category !== plans[i].category) {
                    filtered.push(plans[i])
                }
            }
        }
        return filtered
    }, [])

    if (!projects.canUpgrade) {
        list.push(
            <div className="bs-Fieldset-fields .Flex-justifyContent--center" style={{flex: 1, padding: 0}} key="empty">
                {
                    <span className="Margin-bottom--12">
                    Our support team has been notified about your request to upgrade plan.
                    We will reach out to you shortly.
                    </span>
                }
            </div>
        )
        
    } else {
        for (let i = 0; i < 3; i++) {
            list.push(
                <div className="bs-Fieldset-fields .Flex-justifyContent--center" style={{flex: 1, padding: 0}} key={i}>
                    {
                        reducedPlans.map((plan, index) => (
                            <ShouldRender if={index === i * 2 || index - ( i * 2 ) === 1} key={index}>
                                <ShouldRender if={index === i * 2}>
                                    <span className="Margin-bottom--12 Text-fontWeight--medium">
                                        {plan.category} Plan
                                    </span>
                                </ShouldRender>

                                <RadioInput 
                                    id={`${plan.category}_${plan.type}`} 
                                    details={plan.details} 
                                    value={plan.planId} 
                                />
    
                            </ShouldRender>
                            
                        ))
                    }
                </div>
            )
        }
    }
    return list;
}
