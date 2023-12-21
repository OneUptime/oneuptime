import MeteredPlan from 'Common/Types/Billing/MeteredPlan';
import MeteredPlanUtil from './MeteredPlanUtil';
import ServerMeteredPlan from './ServerMeteredPlan';
import ObjectID from 'Common/Types/ObjectID';
import ProjectService from '../../../Services/ProjectService';
import BillingService from '../../../Services/BillingService';
import Project from 'Model/Models/Project';
import UsageBilling, { ProductType } from 'Model/Models/UsageBilling';
import UsageBillingService from '../../../Services/UsageBillingService';
import OneUptimeDate from 'Common/Types/Date';

export default class LogsDataIngestMeteredPlan extends ServerMeteredPlan {
    public static override getMeteredPlan(): MeteredPlan {
        const meteredPlan: MeteredPlan =
            MeteredPlanUtil.getMeteredPlan('LOGS_DATA_INGEST');
        this.meteredPlan = meteredPlan;
        return meteredPlan;
    }

    public static override async reportQuantityToBillingProvider(
        projectId: ObjectID,
        options?: {
            meteredPlanSubscriptionId?: string | undefined;
        }
    ): Promise<void> {

        // get all unreported logs

        const usageBillings: Array<UsageBilling> = await UsageBillingService.getUnreportedUsageBilling({
            projectId: projectId,
            productType: ProductType.Logs
        });


        if (usageBillings.length === 0) {
            return;
        }

        // update this count in project as well.
        const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
                paymentProviderMeteredSubscriptionId: true,
                paymentProviderPlanId: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (
            project &&
            (options?.meteredPlanSubscriptionId ||
                project.paymentProviderMeteredSubscriptionId) &&
            project.paymentProviderPlanId
        ) {

            for (const usageBilling of usageBillings) {

                if (usageBilling?.usageCount && usageBilling?.usageCount > 0 && usageBilling.id) {
                    await BillingService.addOrUpdateMeteredPricingOnSubscription(
                        (options?.meteredPlanSubscriptionId as string) ||
                        (project.paymentProviderMeteredSubscriptionId as string),
                        LogsDataIngestMeteredPlan.getMeteredPlan(),
                        usageBilling.usageCount
                    );

                    // now mark it as reported. 

                    await UsageBillingService.updateOneById({
                        id: usageBilling.id,
                        data: {
                            isReportedToBillingProvider: true,
                            reportedToBillingProviderAt: OneUptimeDate.getCurrentDate(),
                        },
                        props: {
                            isRoot: true,
                        }
                    });
                }
            }
        }
    }
}
