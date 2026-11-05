import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import logger from "Common/Server/Utils/Logger";
import OpenStackBudgetEvaluator from "Common/Server/Utils/OpenStack/OpenStackBudgetEvaluator";
import OpenStackUsageRefresh, {
  OpenStackUsageRefreshResult,
} from "Common/Server/Utils/OpenStack/OpenStackUsageRefresh";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { readOpenStackPriceList } from "Common/Types/OpenStack/OpenStackPriceList";
import { readOpenStackSpendSnapshot } from "Common/Types/OpenStack/OpenStackSpendSnapshot";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";

/*
 * ------------------------------------------------------------------
 * OpenStack:RefreshUsage
 *
 * Every quarter of an hour, for each cloud that is reporting:
 *
 *   1. what each of its projects holds now, multiplied by the time since the last reading, is added
 *      to that project's month (OpenStackUsageRefresh),
 *   2. what the Spend page says is worked out and kept on the cloud, and
 *   3. its budgets are compared with what that comes to (OpenStackBudgetEvaluator).
 *
 * A cloud that stopped reporting isn't read, and time it was silent isn't counted: its page says how
 * much of the month was. One cloud at a time, so one large cloud is a load on Postgres the size of
 * itself, and one that fails costs the others nothing.
 * ------------------------------------------------------------------
 */

RunCron(
  "OpenStack:RefreshUsage",
  { schedule: EVERY_FIFTEEN_MINUTE, runOnStartup: false },
  async () => {
    const clouds: Array<OpenStackCloud> = await OpenStackCloudService.findBy({
      query: {
        otelCollectorStatus: "connected",
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        usageReadAt: true,
        spendSnapshot: true,
        priceList: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    for (const cloud of clouds) {
      if (!cloud._id || !cloud.projectId) {
        continue;
      }

      const openStackCloudId: ObjectID = new ObjectID(cloud._id.toString());

      try {
        const now: Date = OneUptimeDate.getCurrentDate();
        const result: OpenStackUsageRefreshResult =
          await OpenStackUsageRefresh.refresh({
            projectId: cloud.projectId,
            openStackCloudId,
            lastReadAt: cloud.usageReadAt ? new Date(cloud.usageReadAt) : null,
            previous: readOpenStackSpendSnapshot(cloud.spendSnapshot),
            priceList: readOpenStackPriceList(cloud.priceList),
            now,
          });

        if (result.wasSaved) {
          await OpenStackBudgetEvaluator.evaluateCloud({
            projectId: cloud.projectId,
            openStackCloudId,
            cloudName: cloud.name || "",
            snapshot: result.snapshot,
            projects: result.projects,
            now,
          });
        }
      } catch (err) {
        logger.error(
          `OpenStack:RefreshUsage: cloud ${openStackCloudId.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  },
);
