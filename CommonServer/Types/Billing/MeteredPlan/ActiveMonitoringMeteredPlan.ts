import MeteredPlan from "Common/Types/Billing/MeteredPlan";
import MeteredPlanUtil from "./MeteredPlanUtil";
import ServerMeteredPlan from "./ServerMeteredPlan";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "../../../Services/MonitorService";
import QueryHelper from "../../Database/QueryHelper";
import MonitorType from "Common/Types/Monitor/MonitorType";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProjectService from "../../../Services/ProjectService";
import BillingService from "../../../Services/BillingService";
import Project from "Model/Models/Project";

export class ActiveMonitoringMeteredPlan extends ServerMeteredPlan {

    public static getMeteredPlan(): MeteredPlan {
        const meteredPlan: MeteredPlan = MeteredPlanUtil.getMeteredPlan("ACTIVE_MONITORING");
        return meteredPlan;
    }

    public static override async updateCurrentQuantity(projectId: ObjectID): Promise<PositiveNumber> {


        const count: PositiveNumber = await MonitorService.countBy({
            query: {
                projectId: projectId,
                monitorType: QueryHelper.notEquals(MonitorType.Manual)
            },
            props: {
                isRoot: true
            }

        });

        // udpate this count in project as well. 
        await ProjectService.updateOneById({
            id: projectId,
            data: {
                currentActiveMonitorsCount: count.toNumber()
            },
            props: {
                isRoot: true
            }
        });


         // udpate this count in project as well. 
         const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
                paymentProviderSubscriptionId: true
            },
            props: {
                isRoot: true
            }
        });

        if(project && project.paymentProviderSubscriptionId) {
            await BillingService.addOrUpdateMeteredPricingOnSubscription(project?.paymentProviderSubscriptionId, ActiveMonitoringMeteredPlan.getMeteredPlan(), count.toNumber());
        }
        
        return count;
    }

}