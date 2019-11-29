/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {

    getPlans() {
        //if in testing.
        if (!process.env['STRIPE_PRIVATE_KEY'] || (process.env['STRIPE_PRIVATE_KEY'] && process.env['STRIPE_PRIVATE_KEY'].startsWith('sk_test'))) {
            return [
                {
                    category: 'Basic',
                    planId: 'plan_EgTJMZULfh6THW',
                    type: 'month',
                    amount: 8,
                    details: '$8 / Month',
                    monitorLimit: 5,
                    userLimit: 1,
                    extraUserFee: 8,
                    extraUserPlanId: 'plan_EgTNrPTvHRIW0R'
                },
                {
                    category: 'Basic',
                    planId: 'plan_EgTQAx3Z909Dne',
                    type: 'annual',
                    amount: 80.4,
                    details: '$80.4 / Year',
                    monitorLimit: 5,
                    userLimit: 1,
                    extraUserFee: 80.4,
                    extraUserPlanId: 'plan_EgTO1pti0ML00R'
                }
            ];
        } else {
            return [
                {
                    category: 'Basic',
                    planId: 'plan_EgT8cUrwsxaqCs',
                    type: 'month',
                    amount: 8,
                    details: '$8 / Month',
                    monitorLimit: 5,
                    userLimit: 1,
                    extraUserFee: 8,
                    extraUserPlanId: 'plan_EgTCjBkFgAlQhP'
                },
                {
                    category: 'Basic',
                    planId: 'plan_EgT9hrq9GdIGQ6',
                    type: 'annual',
                    amount: 80.4,
                    details: '$80.4 / Year',
                    monitorLimit: 5,
                    userLimit: 1,
                    extraUserFee: 80.4,
                    extraUserPlanId: 'plan_EgTCTRWdPHLaj0'
                }
            ];
        }
    },

    getPlanById(id) {
        let plans = this.getPlans();
        if(id) return plans.find(plan => plan.planId === id) || null;
        else return null;
    },

    getPlanByExtraUserId(id) {
        let plans = this.getPlans();
        if(id) return plans.find(plan => plan.extraUserPlanId === id) || null;
        else return null;
    }
};
