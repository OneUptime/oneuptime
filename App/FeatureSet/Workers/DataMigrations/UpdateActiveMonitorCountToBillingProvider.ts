import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Sleep from "Common/Types/Sleep";
import { IsBillingEnabled } from "CommonServer/EnvironmentConfig";
import ProjectService from "CommonServer/Services/ProjectService";
import AllMeteredPlans from "CommonServer/Types/Billing/MeteredPlan/AllMeteredPlans";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import Project from "Common/Models/DatabaseModels/Project";

export default class UpdateActiveMonitorCountToBillingProvider extends DataMigrationBase {
  public constructor() {
    super("UpdateActiveMonitorCountToBillingProvider");
  }

  public override async migrate(): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        paymentProviderMeteredSubscriptionId: QueryHelper.notNull(),
      },
      select: {
        _id: true,
        paymentProviderMeteredSubscriptionId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      for (const meteredPlan of AllMeteredPlans) {
        await meteredPlan.reportQuantityToBillingProvider(project.id!, {});
      }

      await Sleep.sleep(100);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
