import React from 'react';
import RadioInput from './RadioInput';
import { PricingPlan } from '../../config';
import ShouldRender from '../basic/ShouldRender';

export default function UpgradePlanFields(props: $TSFixMe) {
    const { currentProject, projects } = props;

    const list = [];
    const plans = PricingPlan.getPlans();

    const reducedPlans = plans.reduce((filtered, plan, index) => {
        if (currentProject.stripePlanId === plan.planId) {
            for (let i = 0; i < plans.length; i++) {
                if (i > index && plans[index].category !== plans[i].category) {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ category: string; planId: stri... Remove this comment to see the full error message
                    filtered.push(plans[i]);
                }
            }
        }
        return filtered;
    }, []);

    if (!projects.canUpgrade) {
        list.push(
            <div
                className="bs-Fieldset-fields .Flex-justifyContent--center"
                style={{ flex: 1, padding: 0 }}
                key="empty"
            >
                {
                    <span className="Margin-bottom--12">
                        Our support team has been notified about your request to
                        upgrade plan. We will reach out to you shortly.
                    </span>
                }
            </div>
        );
    } else {
        for (let i = 0; i < 3; i++) {
            list.push(
                <div
                    className="bs-Fieldset-fields .Flex-justifyContent--center"
                    style={{ flex: 1, padding: 0 }}
                    key={i}
                >
                    {reducedPlans.map((plan, index) => (
                        <ShouldRender
                            if={index === i * 2 || index - i * 2 === 1}
                            key={index}
                        >
                            <ShouldRender if={index === i * 2}>
                                <span className="Margin-bottom--12 Text-fontWeight--medium">
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type 'never'... Remove this comment to see the full error message
                                    {plan.category} Plan
                                </span>
                            </ShouldRender>

                            <RadioInput
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'category' does not exist on type 'never'... Remove this comment to see the full error message
                                id={`${plan.category}_${plan.type}`}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'details' does not exist on type 'never'.
                                details={plan.details}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'planId' does not exist on type 'never'.
                                value={plan.planId}
                            />
                        </ShouldRender>
                    ))}
                </div>
            );
        }
    }
    return list;
}
