import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import logger from "Common/Server/Utils/Logger";
import OpenStackCapacityRefresh, {
  OpenStackCapacityRefreshResult,
} from "Common/Server/Utils/OpenStack/OpenStackCapacityRefresh";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackCapacitySnapshot } from "Common/Types/OpenStack/OpenStackCapacitySnapshot";
import { EVERY_TWO_MINUTES } from "Common/Utils/CronTime";
import TelemetryQueueService from "../../../Telemetry/Services/Queue/TelemetryQueueService";
import RunCron from "../../Utils/Cron";

/*
 * ------------------------------------------------------------------
 * OpenStack:RefreshCapacity
 *
 * Every 2 minutes, the Placement scrape's own pace, so the alert templates on capacity read as
 * many points in a window as any other. For each cloud that is reporting:
 *
 *   1. works out what its inventory adds up to (OpenStackCapacityRefresh),
 *   2. keeps the answer on the cloud, which is all the Capacity page reads, and
 *   3. writes the series the templates read, through the same ingest as everything else.
 *
 * A cloud that stopped reporting is left as it was: its page says how old this is, and its
 * series stop too, so what's silent reads as silent and an open incident stays open.
 *
 * One cloud at a time, so one large cloud is a load on Postgres the size of itself, and one that
 * fails costs the others nothing.
 * ------------------------------------------------------------------
 */

RunCron(
  "OpenStack:RefreshCapacity",
  { schedule: EVERY_TWO_MINUTES, runOnStartup: false },
  async () => {
    const clouds: Array<OpenStackCloud> = await OpenStackCloudService.findBy({
      query: {
        otelCollectorStatus: "connected",
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        capacitySnapshot: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    for (const cloud of clouds) {
      if (!cloud._id || !cloud.projectId || !cloud.name) {
        continue;
      }

      const openStackCloudId: ObjectID = new ObjectID(cloud._id.toString());

      try {
        const result: OpenStackCapacityRefreshResult =
          await OpenStackCapacityRefresh.refresh({
            projectId: cloud.projectId,
            openStackCloudId,
            cloudName: cloud.name,
            previous:
              (cloud.capacitySnapshot as unknown as
                | OpenStackCapacitySnapshot
                | undefined) || null,
            now: OneUptimeDate.getCurrentDate(),
          });

        await OpenStackCapacityRefresh.save({
          openStackCloudId,
          snapshot: result.snapshot,
        });

        if (result.resourceMetrics.length > 0) {
          await TelemetryQueueService.addMetricIngestJob({
            projectId: cloud.projectId,
            body: { resourceMetrics: result.resourceMetrics },
            headers: {},
            productType: ProductType.Metrics,
          } as unknown as TelemetryRequest);
        }
      } catch (err) {
        logger.error(
          `OpenStack:RefreshCapacity: cloud ${openStackCloudId.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  },
);
