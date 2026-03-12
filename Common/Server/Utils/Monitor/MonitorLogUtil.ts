import MonitorLogService from "../../Services/MonitorLogService";
import GlobalConfigService from "../../Services/GlobalConfigService";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import DataToProcess from "./DataToProcess";

export default class MonitorLogUtil {
  // Default retention in days if GlobalConfig is not set
  private static readonly DEFAULT_RETENTION_DAYS: number = 1;

  // Cached retention value to avoid querying GlobalConfig on every monitor check
  private static cachedRetentionDays: number | null = null;
  private static lastCacheRefresh: Date | null = null;
  private static readonly CACHE_TTL_MS: number = 5 * 60 * 1000; // 5 minutes

  private static async getRetentionDays(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();

    // Return cached value if still fresh
    if (
      this.cachedRetentionDays !== null &&
      this.lastCacheRefresh !== null &&
      now.getTime() - this.lastCacheRefresh.getTime() < this.CACHE_TTL_MS
    ) {
      return this.cachedRetentionDays;
    }

    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          props: {
            isRoot: true,
          },
          select: {
            monitorLogRetentionInDays: true,
          },
        });

      if (
        globalConfig &&
        globalConfig.monitorLogRetentionInDays !== undefined &&
        globalConfig.monitorLogRetentionInDays !== null &&
        globalConfig.monitorLogRetentionInDays > 0
      ) {
        this.cachedRetentionDays = globalConfig.monitorLogRetentionInDays;
      } else {
        this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      }

      this.lastCacheRefresh = now;
    } catch (error) {
      logger.error(
        "Error fetching monitor log retention config, using default:",
      );
      logger.error(error);
      this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      this.lastCacheRefresh = now;
    }

    return this.cachedRetentionDays;
  }

  public static saveMonitorLog(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    dataToProcess: DataToProcess;
  }): void {
    if (!data.monitorId) {
      return;
    }

    if (!data.projectId) {
      return;
    }

    if (!data.dataToProcess) {
      return;
    }

    // Fire-and-forget: fetch retention config then insert
    this.getRetentionDays()
      .then((retentionDays: number) => {
        const logIngestionDate: Date = OneUptimeDate.getCurrentDate();
        const logTimestamp: string =
          OneUptimeDate.toClickhouseDateTime(logIngestionDate);

        const retentionDate: Date = OneUptimeDate.addRemoveDays(
          logIngestionDate,
          retentionDays,
        );

        const monitorLogRow: JSONObject = {
          _id: ObjectID.generate().toString(),
          createdAt: logTimestamp,
          updatedAt: logTimestamp,
          projectId: data.projectId.toString(),
          monitorId: data.monitorId.toString(),
          time: logTimestamp,
          logBody: JSON.parse(JSON.stringify(data.dataToProcess)),
          retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
        };

        MonitorLogService.insertJsonRows([monitorLogRow]).catch(
          (err: Error) => {
            logger.error(err);
          },
        );
      })
      .catch((err: Error) => {
        logger.error(err);
      });
  }
}
