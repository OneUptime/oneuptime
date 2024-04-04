import ServerMeteredPlan from './ServerMeteredPlan';
import ObjectID from 'Common/Types/ObjectID';
import ProjectService from '../../../Services/ProjectService';
import BillingService from '../../../Services/BillingService';
import Project from 'Model/Models/Project';
import TelemetryUsageBilling from 'Model/Models/TelemetryUsageBilling';
import TelemetryUsageBillingService from '../../../Services/TelemetryUsageBillingService';
import OneUptimeDate from 'Common/Types/Date';
import ProductType from 'Common/Types/MeteredPlan/ProductType';

export default class TelemetryMeteredPlan extends ServerMeteredPlan {
    private _productType!: ProductType;
    public get productType(): ProductType {
        return this._productType;
    }
    public set productType(v: ProductType) {
        this._productType = v;
    }

    private _unitCostInUSD: number = 0;
    public get unitCostInUSD(): number {
        return this._unitCostInUSD;
    }
    public set unitCostInUSD(v: number) {
        this._unitCostInUSD = v;
    }

    public constructor(data: {
        productType: ProductType;
        unitCostInUSD: number;
    }) {
        super();
        this.productType = data.productType;
        this.unitCostInUSD = data.unitCostInUSD;
    }

    public getTotalCostInUSD(data: {
        dataIngestedInGB: number;
        retentionInDays: number;
    }): number {
        return (
            data.dataIngestedInGB * data.retentionInDays * this.unitCostInUSD
        );
    }

    public override getProductType(): ProductType {
        return this.productType;
    }

    public override async reportQuantityToBillingProvider(
        projectId: ObjectID,
        options?: {
            meteredPlanSubscriptionId?: string | undefined;
        }
    ): Promise<void> {
        // get all unreported logs

        const usageBillings: Array<TelemetryUsageBilling> =
            await TelemetryUsageBillingService.getUnreportedUsageBilling({
                projectId: projectId,
                productType: this.productType,
            });

        if (usageBillings.length === 0) {
            return;
        }

        // calculate all the total usage count and report it to billing provider.

        let totalCostInUSD: number = 0;

        for (const usageBilling of usageBillings) {
            if (
                usageBilling?.totalCostInUSD?.value &&
                usageBilling?.totalCostInUSD.value > 0
            ) {
                totalCostInUSD += usageBilling.totalCostInUSD.value;
            }
        }

        if (totalCostInUSD < 1) {
            return; // too low to report.
        }

        // convert USD to cents.

        let totalCostInCents: number = totalCostInUSD * 100;

        // convert this to integer.

        totalCostInCents = Math.ceil(totalCostInCents);

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
            await BillingService.addOrUpdateMeteredPricingOnSubscription(
                (options?.meteredPlanSubscriptionId as string) ||
                    (project.paymentProviderMeteredSubscriptionId as string),
                this,
                totalCostInCents
            );

            for (const usageBilling of usageBillings) {
                if (usageBilling.id) {
                    // now mark it as reported.

                    await TelemetryUsageBillingService.updateOneById({
                        id: usageBilling.id,
                        data: {
                            isReportedToBillingProvider: true,
                            reportedToBillingProviderAt:
                                OneUptimeDate.getCurrentDate(),
                        },
                        props: {
                            isRoot: true,
                        },
                    });
                }
            }
        }
    }
}
