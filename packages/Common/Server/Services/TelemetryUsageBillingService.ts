import { MeteredPlanUtil } from "../Types/Billing/MeteredPlan/AllMeteredPlans";
import TelemetryMeteredPlan from "../Types/Billing/MeteredPlan/TelemetryMeteredPlan";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import Decimal from "../../Types/Decimal";
import BadDataException from "../../Types/Exception/BadDataException";
import ProductType from "../../Types/MeteredPlan/ProductType";
import ObjectID from "../../Types/ObjectID";
import Model, {
  DEFAULT_RETENTION_IN_DAYS,
} from "../../Models/DatabaseModels/TelemetryUsageBilling";
import ServiceService from "./ServiceService";
import ProjectService from "./ProjectService";
import Project from "../../Models/DatabaseModels/Project";
import SpanService from "./SpanService";
import LogService from "./LogService";
import SecurityEventService from "./SecurityEventService";
import MetricService from "./MetricService";
import ExceptionInstanceService from "./ExceptionInstanceService";
import ProfileService from "./ProfileService";
import RumSessionService from "./RumSessionService";
import ProfileSampleService from "./ProfileSampleService";
import DiskSize from "../../Types/DiskSize";
import logger from "../Utils/Logger";
import ServiceModel from "../../Models/DatabaseModels/Service";
import HostService from "./HostService";
import DockerHostService from "./DockerHostService";
import PodmanHostService from "./PodmanHostService";
import KubernetesClusterService from "./KubernetesClusterService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import OpenStackCloudService from "./OpenStackCloudService";
import VMwareVCenterService from "./VMwareVCenterService";
import CephClusterService from "./CephClusterService";
import StorageArrayService from "./StorageArrayService";
import DatabaseServerService from "./DatabaseServerService";
import IoTFleetService from "./IoTFleetService";
import Host from "../../Models/DatabaseModels/Host";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import CephCluster from "../../Models/DatabaseModels/CephCluster";
import StorageArray from "../../Models/DatabaseModels/StorageArray";
import DatabaseServer from "../../Models/DatabaseModels/DatabaseServer";
import RumApplicationService from "./RumApplicationService";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import { getApplicationSessionReplayRetentionInDays } from "../Utils/SessionReplay/SessionReplayRetention";
import ServiceType from "../../Types/Telemetry/ServiceType";
import SessionReplayBudgetMetricTypeUtil from "../../Utils/SessionReplay/SessionReplayBudgetMetricType";
import { PRODUCT_ANALYTICS_DERIVED_METRICS } from "../../Types/Rum/ProductAnalyticsEvents";
import TelemetryIngestionBudgetMetricTypeUtil from "../../Utils/Telemetry/TelemetryIngestionBudgetMetricType";
import {
  AverageSpanRowSizeInBytes,
  AverageLogRowSizeInBytes,
  AverageMetricRowSizeInBytes,
  AverageExceptionRowSizeInBytes,
  AverageProfileRowSizeInBytes,
  AverageSessionReplaySessionSizeInBytes,
  AverageProfileSampleRowSizeInBytes,
  AverageSecurityEventRowSizeInBytes,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import GlobalConfigService from "./GlobalConfigService";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import {
  TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS,
  getTelemetryUsageRetentionInDays,
} from "../../Types/Telemetry/TelemetryUsage";
import PayAsYouGoBillingService, {
  LiveUsageAuthorization,
} from "./PayAsYouGoBillingService";

/*
 * Primary entity types whose telemetry rows are never billed as ingested
 * volume. Monitor telemetry is billed via the Active Monitoring plan, and
 * Alert / Incident / SLO / Data Observability rows are OneUptime's own operational
 * data written into the project's metric tables: an SLO evaluation posts its
 * oneuptime.slo.* readings every few minutes, and Data Observability its
 * oneuptime.data.table.* readings for every table it watches. Billing those
 * as customer telemetry would charge a project for creating an SLO, or for
 * connecting a database.
 */
export const TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES: ReadonlyArray<ServiceType> =
  [
    ServiceType.Monitor,
    ServiceType.Alert,
    ServiceType.Incident,
    ServiceType.ServiceLevelObjective,
    ServiceType.DataStore,
    ServiceType.DataPipeline,
    ServiceType.DataProduct,
    ServiceType.DataReconciliation,
  ];

export type IsTelemetryBillingExcludedEntityTypeFunction = (
  primaryEntityType: string | null | undefined,
) => boolean;

/*
 * Legacy rows with no primaryEntityType are real Services (see the staging
 * loop below), so a missing type is always billable.
 */
export const isTelemetryBillingExcludedEntityType: IsTelemetryBillingExcludedEntityTypeFunction =
  (primaryEntityType: string | null | undefined): boolean => {
    if (!primaryEntityType) {
      return false;
    }

    return TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES.includes(
      primaryEntityType as ServiceType,
    );
  };

/*
 * Metric names whose rows are never billed as ingested volume. The session
 * replay budget sweep posts its oneuptime.rum.session.replay.budget.*
 * readings every five minutes: OneUptime's own operational data about the
 * customer's replay budget, like the SLO rows above, and billing them would
 * charge a project for having recorded a replay.
 *
 * Left out by NAME, not by type: the rows keep primaryEntityType =
 * RealUserMonitor, keyed to the application, so monitors scoped to that
 * application see them - and the application's real web-vitals rows share
 * that id and type, so an entity-type exclusion would stop billing those
 * too. That is only safe because nothing but the budget sweep can write a
 * name under the session replay prefix (isReservedMetricName in
 * Common/Utils/SessionReplay/SessionReplayBudgetMetricType): OTLP ingest drops them,
 * and a metric or trace recording rule cannot be saved with one as its
 * output. So no customer telemetry can be stored under one of these names to
 * be kept for free.
 *
 * The telemetry ingestion budget sweep's oneuptime.telemetry.budget.* readings
 * are left out the same way and for the same reasons: they report on a
 * project's budget, so counting them as usage would spend the budget they
 * report on, and only the sweep can write them
 * (TelemetryIngestionBudgetMetricTypeUtil.isReservedMetricName).
 *
 * The product analytics event counts (oneuptime.rum.product.*, issue #6444)
 * are left out too: they are counted from events the project already sent,
 * and only the event pipeline can write them
 * (isProductAnalyticsDerivedMetricName). The application's own metric()
 * points are ordinary metrics and are billed like any other.
 */
export const TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES: ReadonlyArray<string> = [
  ...SessionReplayBudgetMetricTypeUtil.getAll(),
  ...TelemetryIngestionBudgetMetricTypeUtil.getAll(),
  ...PRODUCT_ANALYTICS_DERIVED_METRICS,
];

/*
 * How many complete UTC days back each billing run looks for usage it never
 * staged. Staging used to target only "yesterday", so a day the run did not
 * reach - a deploy or crash mid-run, a run still going past midnight UTC, a
 * usage scan over its time cap - was never billed. Each run now stages every
 * day in this window that has telemetry and no staged usage yet.
 */
export const TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS: number = 7;

/*
 * How long a usage row billing has yet to charge - one that costs something
 * and has not been reported to the payment provider - is kept, whatever the
 * usage retention says: the 120 days every row was kept for before the
 * retention could be set (deleteUsageOlderThanRetention).
 */
export const TELEMETRY_USAGE_UNREPORTED_BILLING_RETENTION_IN_DAYS: number =
  TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS;

/*
 * What one resource sent of one product in a window, as metering counts it:
 * the estimated bytes, and what kind of resource the id names.
 */
export interface TelemetryResourceUsage {
  primaryEntityType: ServiceType;
  bytes: number;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    /*
     * No fixed retention here: the rows are kept for the instance's telemetry
     * usage retention (GlobalConfig.telemetryUsageRetentionInDays, 120 days
     * unless changed), with billing on or off, by
     * deleteUsageOlderThanRetention - the TelemetryUsage:DeleteOldTelemetryUsage
     * worker job. The 120 days used to be scheduled here, and only where
     * billing was on.
     */
  }

  @CaptureSpan()
  public async getUnreportedUsageBilling(data: {
    projectId: ObjectID;
    productType: ProductType;
  }): Promise<Model[]> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
        productType: data.productType,
        isReportedToBillingProvider: false,
        totalCostInUSD: QueryHelper.greaterThan(0),
      },
      skip: 0,
      limit: LIMIT_MAX, /// because a project can have MANY telemetry services.
      select: {
        _id: true,
        totalCostInUSD: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  public async waiveUnreportedUsageBilling(data: {
    projectId: ObjectID;
    productType: ProductType;
    before?: Date;
  }): Promise<void> {
    let updated: number;
    do {
      updated = await this.updateBy({
        query: {
          projectId: data.projectId,
          productType: data.productType,
          isReportedToBillingProvider: false,
          totalCostInUSD: QueryHelper.greaterThan(0),
          ...(data.before
            ? { createdAt: QueryHelper.lessThan(data.before) }
            : {}),
        },
        data: { totalCostInUSD: new Decimal(0) },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true, ignoreHooks: true },
      });
    } while (updated === LIMIT_MAX);
  }

  /*
   * Stage every complete UTC day of the last
   * TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS that has telemetry for this
   * product and no staged usage yet, oldest first - for billing, where
   * billing is on.
   *
   * A day counts as staged once it has any usage row; staging a day again
   * would only skip the resources already staged for it. Only days that hold
   * telemetry are scanned (getDaysWithRows reads just projectId and the
   * timestamp), so a project with nothing to bill costs one cheap query per
   * product rather than a usage scan per day.
   *
   * A day that fails stays unstaged for the next run to retry, and the other
   * days still stage. The first failure is thrown once the loop is done, so
   * the caller can bill what did stage and then report it.
   */
  @CaptureSpan()
  public async stageUnstagedTelemetryUsageForProject(data: {
    projectId: ObjectID;
    productType: ProductType;
    liveAuthorization?: LiveUsageAuthorization | undefined;
    /*
     * The project's telemetry billing cutoff, when the caller has already
     * read it. Days before it are never billed, so they are dropped here
     * instead of each asking the payment provider for the cutoff again;
     * stageTelemetryUsageForProject still enforces it either way.
     */
    billingStartsAt?: Date | undefined;
  }): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    await this.stageUnstagedDays({
      projectId: data.projectId,
      productType: data.productType,
      earliestDay: data.billingStartsAt,
      stageDay: async (usageDay: Date): Promise<void> => {
        await this.stageTelemetryUsageForProject({
          projectId: data.projectId,
          productType: data.productType,
          usageDate: usageDay,
          liveAuthorization: data.liveAuthorization,
        });
      },
    });
  }

  /*
   * Metering where billing is off: the same catch-up as
   * stageUnstagedTelemetryUsageForProject - every complete UTC day of the
   * last week that has telemetry and no usage yet, oldest first, one failing
   * day stopping none of the others - with every day staged at no cost
   * (meterTelemetryUsageForProject). Run for each project by the
   * TelemetryUsage:MeterTelemetryUsage worker job, so a server without
   * billing - Community Edition included - shows what each project and
   * service sends.
   *
   * Nothing at all where billing is on: billing stages usage itself
   * (stageUnstagedTelemetryUsageForProject), for the projects that pay for
   * it, and a free project's days are left to it - counted here, a day with
   * a row would never be billed once the project starts paying.
   */
  @CaptureSpan()
  public async meterUnstagedTelemetryUsageForProject(data: {
    projectId: ObjectID;
    productType: ProductType;
  }): Promise<void> {
    if (IsBillingEnabled) {
      return;
    }

    await this.stageUnstagedDays({
      projectId: data.projectId,
      productType: data.productType,
      earliestDay: undefined,
      stageDay: async (usageDay: Date): Promise<void> => {
        await this.meterTelemetryUsageForProject({
          projectId: data.projectId,
          productType: data.productType,
          usageDate: usageDay,
        });
      },
    });
  }

  /*
   * The catch-up both staging paths share: the days of the window from
   * `earliestDay` on that have telemetry and no usage row, each handed to
   * `stageDay`, oldest first.
   */
  private async stageUnstagedDays(data: {
    projectId: ObjectID;
    productType: ProductType;
    earliestDay: Date | undefined;
    stageDay: (usageDay: Date) => Promise<void>;
  }): Promise<void> {
    const usageDays: Array<Date> = this.getStagingWindowDays().filter(
      (usageDay: Date): boolean => {
        return (
          !data.earliestDay || usageDay.getTime() >= data.earliestDay.getTime()
        );
      },
    );

    if (usageDays.length === 0) {
      return;
    }

    const stagedRows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        productType: data.productType,
        day: QueryHelper.any(
          usageDays.map((usageDay: Date): string => {
            return this.getUsageDayString(usageDay);
          }),
        ),
      },
      select: {
        day: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const stagedDays: Set<string> = new Set(
      stagedRows
        .map((row: Model) => {
          return row.day;
        })
        .filter((day: string | undefined): day is string => {
          return Boolean(day);
        }),
    );

    const unstagedDays: Array<Date> = usageDays.filter(
      (usageDay: Date): boolean => {
        return !stagedDays.has(this.getUsageDayString(usageDay));
      },
    );

    if (unstagedDays.length === 0) {
      return;
    }

    const daysWithTelemetry: Set<string> = await this.getDaysWithTelemetry({
      projectId: data.projectId,
      productType: data.productType,
      startDate: OneUptimeDate.getStartOfDay(unstagedDays[0]!, "UTC"),
      endDate: OneUptimeDate.getEndOfDay(
        unstagedDays[unstagedDays.length - 1]!,
        "UTC",
      ),
    });

    let firstFailure: unknown = null;

    for (const usageDay of unstagedDays) {
      if (!daysWithTelemetry.has(this.getUtcDateKey(usageDay))) {
        continue;
      }

      try {
        await data.stageDay(usageDay);
      } catch (error) {
        logger.error(
          `Failed to stage ${data.productType} usage of ${this.getUsageDayString(usageDay)} for project ${data.projectId.toString()}; the next run retries it.`,
        );
        logger.error(error as Error);
        firstFailure = firstFailure || error;
      }
    }

    if (firstFailure) {
      throw firstFailure;
    }
  }

  /*
   * The complete UTC days of the catch-up window as their UTC midnights,
   * oldest first, ending yesterday. Today is still being written, so it is
   * never staged.
   */
  private getStagingWindowDays(): Array<Date> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const usageDays: Array<Date> = [];

    for (
      let daysBack: number = TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS;
      daysBack >= 1;
      daysBack--
    ) {
      usageDays.push(
        new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - daysBack,
          ),
        ),
      );
    }

    return usageDays;
  }

  // A UTC day as getDaysWithRows names it: YYYY-MM-DD.
  private getUtcDateKey(usageDay: Date): string {
    return usageDay.toISOString().slice(0, 10);
  }

  /*
   * The UTC days (YYYY-MM-DD) in a window on which a project has rows this
   * product bills, read from the same tables stageTelemetryUsageForProject
   * scans.
   */
  private async getDaysWithTelemetry(data: {
    projectId: ObjectID;
    productType: ProductType;
    startDate: Date;
    endDate: Date;
  }): Promise<Set<string>> {
    const window: { projectId: ObjectID; startDate: Date; endDate: Date } = {
      projectId: data.projectId,
      startDate: data.startDate,
      endDate: data.endDate,
    };

    let dayLists: Array<Array<string>> = [];

    if (data.productType === ProductType.Traces) {
      dayLists = [
        await SpanService.getDaysWithRows({
          ...window,
          timestampColumnName: "startTime",
        }),
        await ExceptionInstanceService.getDaysWithRows({
          ...window,
          timestampColumnName: "time",
        }),
      ];
    } else if (data.productType === ProductType.Logs) {
      dayLists = [
        await LogService.getDaysWithRows({
          ...window,
          timestampColumnName: "time",
        }),
      ];
    } else if (data.productType === ProductType.Metrics) {
      dayLists = [
        await MetricService.getDaysWithRows({
          ...window,
          timestampColumnName: "time",
          excludeNames: [...TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES],
        }),
      ];
    } else if (data.productType === ProductType.SecurityEvents) {
      dayLists = [
        await SecurityEventService.getDaysWithRows({
          ...window,
          timestampColumnName: "time",
        }),
      ];
    } else if (data.productType === ProductType.SessionReplay) {
      dayLists = [
        await RumSessionService.getDaysWithRows({
          ...window,
          timestampColumnName: "startTime",
        }),
      ];
    } else if (data.productType === ProductType.Profiles) {
      dayLists = [
        await ProfileService.getDaysWithRows({
          ...window,
          timestampColumnName: "startTime",
        }),
        await ProfileSampleService.getDaysWithRows({
          ...window,
          timestampColumnName: "time",
        }),
      ];
    }

    return new Set(dayLists.flat());
  }

  /*
   * Stage one day of a product's usage for billing, where billing is on:
   * only for a project that may pay as it goes (anything else is waived),
   * and never for a day before its billing cutoff.
   */
  @CaptureSpan()
  public async stageTelemetryUsageForProject(data: {
    projectId: ObjectID;
    productType: ProductType;
    usageDate?: Date;
    liveAuthorization?: LiveUsageAuthorization | undefined;
  }): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    /*
     * A report that has just authorized this project live passes that answer
     * down instead of having it read again. Anything else - a direct call, a
     * token made for another project, one that has aged out - checks live,
     * exactly as every staging call did before.
     */
    if (
      !PayAsYouGoBillingService.isLiveAuthorizationFor(
        data.liveAuthorization,
        data.projectId,
      ) &&
      !(await PayAsYouGoBillingService.canUsePayAsYouGo(data.projectId, {
        useCache: false,
      }))
    ) {
      await this.waiveUnreportedUsageBilling(data);
      return;
    }

    const usageDate: Date = data.usageDate
      ? OneUptimeDate.fromString(data.usageDate)
      : OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -1);

    const billingStartsAt: Date | undefined =
      await PayAsYouGoBillingService.getTelemetryBillingStartDate(
        data.projectId,
      );
    if (
      billingStartsAt &&
      OneUptimeDate.getStartOfDay(usageDate, "UTC").getTime() <
        billingStartsAt.getTime()
    ) {
      return;
    }

    await this.stageUsageOfDay({
      projectId: data.projectId,
      productType: data.productType,
      usageDate: usageDate,
      isBillable: true,
    });
  }

  /*
   * Meter one day of a product's usage where billing is off: the same scan,
   * the same rows and the same retention as billing stages, at no cost.
   *
   * Nothing here asks a payment provider - there is none - and nothing here
   * can ever be charged. Each row is staged with a total cost of 0, and every
   * path that charges for usage takes only rows that cost something
   * (getUnreportedUsageBilling, the marketplace usage reports). A day with a
   * row counts as staged, so if billing is turned on later it never stages
   * that day again: what was metered without billing is never charged
   * retroactively.
   */
  @CaptureSpan()
  public async meterTelemetryUsageForProject(data: {
    projectId: ObjectID;
    productType: ProductType;
    usageDate: Date;
  }): Promise<void> {
    if (IsBillingEnabled) {
      return;
    }

    await this.stageUsageOfDay({
      projectId: data.projectId,
      productType: data.productType,
      usageDate: OneUptimeDate.fromString(data.usageDate),
      isBillable: false,
    });
  }

  /*
   * How many bytes of a product each resource of a project sent in a window:
   * the usage both billing and metering stage, for one UTC day at a time.
   *
   * Enumerated from ClickHouse by (primaryEntityId, primaryEntityType) in a
   * single aggregation scan per analytics table. Unlike the old
   * per-Service-row loop, this surfaces EVERY resource that emitted
   * telemetry — real Services AND Hosts / Docker hosts / Kubernetes
   * clusters / unattributed (primaryEntityId = projectId) — so infrastructure
   * telemetry is no longer ingested for free. `byteSize(*)` gives the
   * estimated ingested bytes per group; the configured average row size
   * is only a fallback if the engine returns 0. Each scan keeps the
   * analytics service's time cap, and fails rather than counting part of a
   * day.
   *
   * OneUptime's own operational rows - monitor, alert, incident, SLO and
   * Data Observability telemetry, the session replay budget series - are
   * left out (TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES and _METRIC_NAMES), as
   * they are left out of billing. A resource with a legacy row of no type is
   * a real Service (OpenTelemetry).
   */
  @CaptureSpan()
  public async getTelemetryUsageByResource(data: {
    projectId: ObjectID;
    productType: ProductType;
    startDate: Date;
    endDate: Date;
  }): Promise<Map<string, TelemetryResourceUsage>> {
    const usageByResource: Map<string, TelemetryResourceUsage> = new Map();

    const averageRowSizeInBytes: number = this.getAverageRowSizeForProduct(
      data.productType,
    );
    const averageExceptionRowSizeInBytes: number =
      this.getAverageExceptionRowSize();

    const averageProfileSampleRowSizeInBytes: number =
      this.getAverageProfileSampleRowSize();

    /*
     * Session replay is exempt from the average-row-size precondition. The
     * other pillars fall back to an average when byteSize(*) returns 0, but
     * replay sums an exact payloadBytes recorded at ingest, so a zero average
     * is not a reason to skip the day.
     */
    if (
      data.productType !== ProductType.Traces &&
      data.productType !== ProductType.Profiles &&
      data.productType !== ProductType.SessionReplay &&
      averageRowSizeInBytes <= 0
    ) {
      return usageByResource;
    }

    if (
      data.productType === ProductType.Traces &&
      averageRowSizeInBytes <= 0 &&
      averageExceptionRowSizeInBytes <= 0
    ) {
      return usageByResource;
    }

    if (
      data.productType === ProductType.Profiles &&
      averageRowSizeInBytes <= 0 &&
      averageProfileSampleRowSizeInBytes <= 0
    ) {
      return usageByResource;
    }

    type ServiceUsage = {
      primaryEntityType: string | null;
      bytes: number;
    };
    const usageByServiceId: Map<string, ServiceUsage> = new Map();

    const addUsage: (
      rows: Array<{
        primaryEntityId: string;
        primaryEntityType: string | null;
        rowCount: number;
        estimatedBytes: number;
      }>,
      fallbackRowSizeInBytes: number,
    ) => void = (
      rows: Array<{
        primaryEntityId: string;
        primaryEntityType: string | null;
        rowCount: number;
        estimatedBytes: number;
      }>,
      fallbackRowSizeInBytes: number,
    ): void => {
      for (const row of rows) {
        const bytes: number =
          row.estimatedBytes > 0
            ? row.estimatedBytes
            : row.rowCount * fallbackRowSizeInBytes;
        const existing: ServiceUsage | undefined = usageByServiceId.get(
          row.primaryEntityId,
        );
        if (existing) {
          existing.bytes += bytes;
          if (!existing.primaryEntityType && row.primaryEntityType) {
            existing.primaryEntityType = row.primaryEntityType;
          }
        } else {
          usageByServiceId.set(row.primaryEntityId, {
            primaryEntityType: row.primaryEntityType,
            bytes,
          });
        }
      }
    };

    const window: { projectId: ObjectID; startDate: Date; endDate: Date } = {
      projectId: data.projectId,
      startDate: data.startDate,
      endDate: data.endDate,
    };

    try {
      if (data.productType === ProductType.Traces) {
        addUsage(
          await SpanService.groupTelemetryUsageByService({
            ...window,
            timestampColumnName: "startTime",
          }),
          averageRowSizeInBytes,
        );
        addUsage(
          await ExceptionInstanceService.groupTelemetryUsageByService({
            ...window,
            timestampColumnName: "time",
          }),
          averageExceptionRowSizeInBytes,
        );
      } else if (data.productType === ProductType.Logs) {
        addUsage(
          await LogService.groupTelemetryUsageByService({
            ...window,
            timestampColumnName: "time",
          }),
          averageRowSizeInBytes,
        );
      } else if (data.productType === ProductType.Metrics) {
        /*
         * The session replay budget rows share their RUM application's
         * (primaryEntityId, primaryEntityType) with its web vitals, so they
         * can only be told apart - and left out - inside the scan.
         */
        addUsage(
          await MetricService.groupTelemetryUsageByService({
            ...window,
            timestampColumnName: "time",
            excludeNames: [...TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES],
          }),
          averageRowSizeInBytes,
        );
      } else if (data.productType === ProductType.SecurityEvents) {
        addUsage(
          await SecurityEventService.groupTelemetryUsageByService({
            ...window,
            timestampColumnName: "time",
          }),
          averageRowSizeInBytes,
        );
      } else if (data.productType === ProductType.SessionReplay) {
        /*
         * One table only, and a bespoke aggregation - see
         * RumSessionService.groupSessionReplayUsageByEntity for why metering
         * must not touch the chunk table or use byteSize(*).
         */
        addUsage(
          await RumSessionService.groupSessionReplayUsageByEntity(window),
          averageRowSizeInBytes,
        );
      } else if (data.productType === ProductType.Profiles) {
        addUsage(
          await ProfileService.groupTelemetryUsageByService({
            ...window,
            timestampColumnName: "startTime",
          }),
          averageRowSizeInBytes,
        );
        addUsage(
          await ProfileSampleService.groupTelemetryUsageByService({
            ...window,
            timestampColumnName: "time",
          }),
          averageProfileSampleRowSizeInBytes,
        );
      }
    } catch (error) {
      logger.error(
        `Failed to aggregate telemetry usage for project ${data.projectId.toString()} (${data.productType}):`,
      );
      logger.error(error as Error);
      /*
       * Rethrow so the failure is loud: nothing has been staged for this
       * day yet (staging below is skipped entirely), so the next run's
       * catch-up (stageUnstagedDays) re-stages the full day. Swallowing here
       * would silently count the day as zero.
       */
      throw error;
    }

    for (const [primaryEntityId, usage] of usageByServiceId) {
      /*
       * Monitor telemetry is billed via the Active Monitoring plan, and
       * Alert / Incident / SLO telemetry is OneUptime's own operational
       * data — none of it is charged as ingested telemetry volume.
       */
      if (isTelemetryBillingExcludedEntityType(usage.primaryEntityType)) {
        continue;
      }

      /*
       * Legacy rows (pre-discriminator) and any null primaryEntityType are
       * treated as OpenTelemetry — historically every billed primaryEntityId
       * was a real Service.
       */
      usageByResource.set(primaryEntityId, {
        primaryEntityType:
          (usage.primaryEntityType as ServiceType | null) ??
          ServiceType.OpenTelemetry,
        bytes: usage.bytes,
      });
    }

    return usageByResource;
  }

  /*
   * One UTC day of a product's usage, one row per resource that sent any:
   * billed (isBillable) where billing stages it, at no cost where metering
   * does. Resources already staged for the day are skipped, so a re-run
   * never counts one twice (updateUsageBilling adds into the day's row).
   */
  private async stageUsageOfDay(data: {
    projectId: ObjectID;
    productType: ProductType;
    usageDate: Date;
    isBillable: boolean;
  }): Promise<void> {
    const usageDayString: string = this.getUsageDayString(data.usageDate);

    const usageByResource: Map<string, TelemetryResourceUsage> =
      await this.getTelemetryUsageByResource({
        projectId: data.projectId,
        productType: data.productType,
        startDate: OneUptimeDate.getStartOfDay(data.usageDate, "UTC"),
        endDate: OneUptimeDate.getEndOfDay(data.usageDate, "UTC"),
      });

    if (usageByResource.size === 0) {
      return;
    }

    /*
     * Resolve retention per resource (Service / Host / DockerHost /
     * KubernetesCluster overrides), defaulting to the project default for
     * everything else — including the unattributed bucket. Retention
     * scales the billed cost, so we honor per-resource overrides.
     *
     * Session replay is the exception: ingest keeps recordings for the RUM
     * application's replay retention and never for the telemetry retention
     * above, so replay is billed at that (7 days unless changed) rather than
     * at the project's telemetry default.
     */
    const isSessionReplay: boolean =
      data.productType === ProductType.SessionReplay;
    const retentionByServiceId: Map<string, number> = isSessionReplay
      ? await this.buildSessionReplayRetentionMap(data.projectId)
      : await this.buildTelemetryRetentionMap(data.projectId);
    const defaultRetentionInDays: number = isSessionReplay
      ? getApplicationSessionReplayRetentionInDays(undefined)
      : await this.getProjectDefaultRetentionInDays(data.projectId);

    /*
     * Skip serviceIds already staged for this day so re-runs of the cron
     * don't double-count (updateUsageBilling accumulates into the day's
     * row). One query instead of a findOneBy per primaryEntityId.
     */
    const alreadyStaged: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        productType: data.productType,
        day: usageDayString,
      },
      select: {
        primaryEntityId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });
    const stagedServiceIds: Set<string> = new Set(
      alreadyStaged
        .map((row: Model) => {
          return row.primaryEntityId?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
    );

    for (const [serviceIdStr, usage] of usageByResource) {
      if (stagedServiceIds.has(serviceIdStr)) {
        continue;
      }

      const estimatedGigabytes: number = DiskSize.byteSizeToGB(usage.bytes);
      if (!Number.isFinite(estimatedGigabytes) || estimatedGigabytes <= 0) {
        continue;
      }

      const retentionInDays: number =
        retentionByServiceId.get(serviceIdStr) ?? defaultRetentionInDays;

      await this.updateUsageBilling({
        projectId: data.projectId,
        productType: data.productType,
        primaryEntityId: new ObjectID(serviceIdStr),
        primaryEntityType: usage.primaryEntityType,
        dataIngestedInGB: estimatedGigabytes,
        retentionInDays: retentionInDays,
        usageDate: data.usageDate,
        isBillable: data.isBillable,
      });
    }
  }

  /*
   * How many days usage rows are kept: the instance's telemetry usage
   * retention (Admin Dashboard > Settings > Data Retention), held to its
   * bounds, 120 days when it is empty (getTelemetryUsageRetentionInDays).
   */
  @CaptureSpan()
  public async getUsageRetentionInDays(): Promise<number> {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneById({
        id: ObjectID.getZeroObjectID(),
        select: {
          telemetryUsageRetentionInDays: true,
        },
        props: {
          isRoot: true,
        },
      });

    return getTelemetryUsageRetentionInDays(
      globalConfig?.telemetryUsageRetentionInDays,
    );
  }

  /*
   * Delete the usage rows of the days past the retention, with billing on or
   * off. A row's createdAt is the UTC day its usage is for, so a day is kept
   * for the whole retention after it ended. Never a day of the staging
   * window: the retention is at least TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS,
   * well past TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS, and a day deleted
   * inside the window would be staged - and billed - again.
   */
  @CaptureSpan()
  public async deleteUsageOlderThanRetention(): Promise<{
    deleted: number;
    cutoff: Date;
    retentionInDays: number;
  }> {
    const retentionInDays: number = await this.getUsageRetentionInDays();
    // On the clock staging reads (getStagingWindowDays), whole days back.
    const daysAgo: (days: number) => Date = (days: number): Date => {
      return OneUptimeDate.addRemoveSeconds(
        OneUptimeDate.getCurrentDate(),
        -days * 24 * 60 * 60,
      );
    };
    const cutoff: Date = daysAgo(retentionInDays);

    if (
      retentionInDays >= TELEMETRY_USAGE_UNREPORTED_BILLING_RETENTION_IN_DAYS
    ) {
      return {
        deleted: await this.hardDeleteAllWhere((): Query<Model> => {
          return { createdAt: QueryHelper.lessThan(cutoff) };
        }),
        cutoff: cutoff,
        retentionInDays: retentionInDays,
      };
    }

    /*
     * A shorter retention deletes only what nothing is owed for: a row
     * reported to the payment provider, or one that costs nothing (all of
     * them where billing is off). A row billing has yet to charge is kept
     * for the 120 days every row was kept for before the setting existed,
     * so turning the retention down never deletes revenue still to be
     * reported.
     */
    let deleted: number = await this.hardDeleteAllWhere((): Query<Model> => {
      return {
        createdAt: QueryHelper.lessThan(cutoff),
        isReportedToBillingProvider: true,
      };
    });

    deleted += await this.hardDeleteAllWhere((): Query<Model> => {
      return {
        createdAt: QueryHelper.lessThan(cutoff),
        totalCostInUSD: QueryHelper.lessThanEqualTo(0),
      };
    });

    const unreportedCutoff: Date = daysAgo(
      TELEMETRY_USAGE_UNREPORTED_BILLING_RETENTION_IN_DAYS,
    );

    deleted += await this.hardDeleteAllWhere((): Query<Model> => {
      return { createdAt: QueryHelper.lessThan(unreportedCutoff) };
    });

    return {
      deleted: deleted,
      cutoff: cutoff,
      retentionInDays: retentionInDays,
    };
  }

  // Every row the query matches, deleted a batch at a time; how many.
  private async hardDeleteAllWhere(
    getQuery: () => Query<Model>,
  ): Promise<number> {
    let deleted: number = 0;
    let deletedInBatch: number = 0;

    do {
      deletedInBatch = await this.hardDeleteBy({
        query: getQuery(),
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      deleted += deletedInBatch;
    } while (deletedInBatch > 0);

    return deleted;
  }

  /*
   * Map of resourceId -> retainTelemetryDataForDays for every resource in
   * the project that can own telemetry (Service, Host, DockerHost,
   * KubernetesCluster, ProxmoxCluster, VMwareVCenter, CephCluster,
   * StorageArray, DatabaseServer). Used to scale billed
   * cost by the actual retention applied to each resource's telemetry.
   * Resources without an override (and the unattributed bucket) fall back
   * to the project default.
   */
  @CaptureSpan()
  private async buildTelemetryRetentionMap(
    projectId: ObjectID,
  ): Promise<Map<string, number>> {
    const retentionByServiceId: Map<string, number> = new Map();

    const services: Array<ServiceModel> = await ServiceService.findBy({
      query: { projectId: projectId },
      select: { _id: true, retainTelemetryDataForDays: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    for (const service of services) {
      if (service.id && service.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          service.id.toString(),
          service.retainTelemetryDataForDays,
        );
      }
    }

    const hosts: Array<Host> = await HostService.findBy({
      query: { projectId: projectId },
      select: { _id: true, retainTelemetryDataForDays: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    for (const host of hosts) {
      if (host.id && host.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          host.id.toString(),
          host.retainTelemetryDataForDays,
        );
      }
    }

    const dockerHosts: Array<DockerHost> = await DockerHostService.findBy({
      query: { projectId: projectId },
      select: { _id: true, retainTelemetryDataForDays: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    for (const dockerHost of dockerHosts) {
      if (dockerHost.id && dockerHost.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          dockerHost.id.toString(),
          dockerHost.retainTelemetryDataForDays,
        );
      }
    }

    const podmanHosts: Array<PodmanHost> = await PodmanHostService.findBy({
      query: { projectId: projectId },
      select: { _id: true, retainTelemetryDataForDays: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    for (const podmanHost of podmanHosts) {
      if (podmanHost.id && podmanHost.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          podmanHost.id.toString(),
          podmanHost.retainTelemetryDataForDays,
        );
      }
    }

    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterService.findBy({
        query: { projectId: projectId },
        select: { _id: true, retainTelemetryDataForDays: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    for (const cluster of clusters) {
      if (cluster.id && cluster.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          cluster.id.toString(),
          cluster.retainTelemetryDataForDays,
        );
      }
    }

    const proxmoxClusters: Array<ProxmoxCluster> =
      await ProxmoxClusterService.findBy({
        query: { projectId: projectId },
        select: { _id: true, retainTelemetryDataForDays: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    const openStackClouds: Array<OpenStackCloud> =
      await OpenStackCloudService.findBy({
        query: { projectId: projectId },
        select: { _id: true, retainTelemetryDataForDays: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    for (const proxmoxCluster of proxmoxClusters) {
      if (proxmoxCluster.id && proxmoxCluster.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          proxmoxCluster.id.toString(),
          proxmoxCluster.retainTelemetryDataForDays,
        );
      }
    }

    for (const openStackCloud of openStackClouds) {
      if (openStackCloud.id && openStackCloud.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          openStackCloud.id.toString(),
          openStackCloud.retainTelemetryDataForDays,
        );
      }
    }

    const vmwareVCenters: Array<VMwareVCenter> =
      await VMwareVCenterService.findBy({
        query: { projectId: projectId },
        select: { _id: true, retainTelemetryDataForDays: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    for (const vmwareVCenter of vmwareVCenters) {
      if (vmwareVCenter.id && vmwareVCenter.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          vmwareVCenter.id.toString(),
          vmwareVCenter.retainTelemetryDataForDays,
        );
      }
    }

    const cephClusters: Array<CephCluster> = await CephClusterService.findBy({
      query: { projectId: projectId },
      select: { _id: true, retainTelemetryDataForDays: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    for (const cephCluster of cephClusters) {
      if (cephCluster.id && cephCluster.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          cephCluster.id.toString(),
          cephCluster.retainTelemetryDataForDays,
        );
      }
    }

    const storageArrays: Array<StorageArray> = await StorageArrayService.findBy(
      {
        query: { projectId: projectId },
        select: { _id: true, retainTelemetryDataForDays: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      },
    );
    for (const storageArray of storageArrays) {
      if (storageArray.id && storageArray.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          storageArray.id.toString(),
          storageArray.retainTelemetryDataForDays,
        );
      }
    }

    /*
     * Databases are mostly auto-discovered (collector, client spans,
     * Kubernetes / Docker / Podman), so a project can hold hundreds of
     * them. Only rows carrying an override matter here — read just those.
     */
    const databaseServers: Array<DatabaseServer> =
      await DatabaseServerService.findBy({
        query: {
          projectId: projectId,
          retainTelemetryDataForDays: QueryHelper.notNull(),
        },
        select: { _id: true, retainTelemetryDataForDays: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    for (const databaseServer of databaseServers) {
      if (databaseServer.id && databaseServer.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          databaseServer.id.toString(),
          databaseServer.retainTelemetryDataForDays,
        );
      }
    }

    const iotFleets: Array<IoTFleet> = await IoTFleetService.findBy({
      query: { projectId: projectId },
      select: { _id: true, retainTelemetryDataForDays: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    for (const iotFleet of iotFleets) {
      if (iotFleet.id && iotFleet.retainTelemetryDataForDays) {
        retentionByServiceId.set(
          iotFleet.id.toString(),
          iotFleet.retainTelemetryDataForDays,
        );
      }
    }

    return retentionByServiceId;
  }

  /*
   * Map of RUM application id -> the days its session replays are kept, by
   * the same rule the session replay gate stamps them with
   * (getApplicationSessionReplayRetentionInDays). An application missing
   * from the map - deleted since it recorded - is billed at the replay
   * default.
   */
  @CaptureSpan()
  private async buildSessionReplayRetentionMap(
    projectId: ObjectID,
  ): Promise<Map<string, number>> {
    const retentionByApplicationId: Map<string, number> = new Map();

    const applications: Array<RumApplication> =
      await RumApplicationService.findBy({
        query: { projectId: projectId },
        select: { _id: true, sessionReplayRetentionInDays: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const application of applications) {
      if (application.id) {
        retentionByApplicationId.set(
          application.id.toString(),
          getApplicationSessionReplayRetentionInDays(
            application.sessionReplayRetentionInDays,
          ),
        );
      }
    }

    return retentionByApplicationId;
  }

  @CaptureSpan()
  private async getProjectDefaultRetentionInDays(
    projectId: ObjectID,
  ): Promise<number> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { defaultTelemetryRetentionInDays: true },
      props: { isRoot: true },
    });
    return (
      project?.defaultTelemetryRetentionInDays || DEFAULT_RETENTION_IN_DAYS
    );
  }

  @CaptureSpan()
  public async updateUsageBilling(data: {
    projectId: ObjectID;
    productType: ProductType;
    primaryEntityId: ObjectID;
    primaryEntityType?: ServiceType | undefined;
    dataIngestedInGB: number;
    retentionInDays: number;
    usageDate?: Date;
    /*
     * False for usage metered where billing is off: the row is staged at no
     * cost (meterTelemetryUsageForProject). Left out, or true, the cost is
     * the product's metered price, as billing stages it.
     */
    isBillable?: boolean | undefined;
  }): Promise<void> {
    if (
      data.productType !== ProductType.Traces &&
      data.productType !== ProductType.Metrics &&
      data.productType !== ProductType.Logs &&
      data.productType !== ProductType.Profiles &&
      data.productType !== ProductType.SessionReplay &&
      data.productType !== ProductType.SecurityEvents
    ) {
      throw new BadDataException(
        "This product type is not a telemetry product type.",
      );
    }

    const serverMeteredPlan: TelemetryMeteredPlan =
      MeteredPlanUtil.getMeteredPlanByProductType(
        data.productType,
      ) as TelemetryMeteredPlan;

    const usageDate: Date = data.usageDate
      ? OneUptimeDate.fromString(data.usageDate)
      : OneUptimeDate.getCurrentDate();

    const usageDayString: string = this.getUsageDayString(usageDate);

    const totalCostOfThisOperationInUSD: number =
      data.isBillable === false
        ? 0
        : serverMeteredPlan.getTotalCostInUSD({
            dataIngestedInGB: data.dataIngestedInGB,
            retentionInDays: data.retentionInDays,
          });

    const usageBilling: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        productType: data.productType,
        primaryEntityId: data.primaryEntityId,
        isReportedToBillingProvider: false,
        day: usageDayString,
      },
      select: {
        _id: true,
        dataIngestedInGB: true,
        totalCostInUSD: true,
      },
      props: {
        isRoot: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
    });

    if (usageBilling && usageBilling.id) {
      let totalCostInUSD: number = usageBilling.totalCostInUSD?.value || 0;

      if (
        isNaN(totalCostInUSD) ||
        totalCostInUSD === undefined ||
        totalCostInUSD === null ||
        (typeof totalCostInUSD === "string" && totalCostInUSD === "NaN")
      ) {
        totalCostInUSD = 0;
      }

      await this.updateOneById({
        id: usageBilling.id,
        data: {
          dataIngestedInGB: new Decimal(
            (usageBilling.dataIngestedInGB?.value || 0) + data.dataIngestedInGB,
          ),
          totalCostInUSD: new Decimal(
            totalCostInUSD + totalCostOfThisOperationInUSD,
          ),
          retainTelemetryDataForDays: data.retentionInDays,
        },
        props: {
          isRoot: true,
        },
      });
    } else {
      const usageBilling: Model = new Model();
      usageBilling.projectId = data.projectId;
      usageBilling.productType = data.productType;
      usageBilling.dataIngestedInGB = new Decimal(data.dataIngestedInGB);
      usageBilling.primaryEntityId = data.primaryEntityId;
      if (data.primaryEntityType) {
        usageBilling.primaryEntityType = data.primaryEntityType;
      }
      usageBilling.retainTelemetryDataForDays = data.retentionInDays;
      usageBilling.isReportedToBillingProvider = false;
      usageBilling.createdAt = usageDate;

      usageBilling.day = usageDayString;

      usageBilling.totalCostInUSD = new Decimal(totalCostOfThisOperationInUSD);

      await this.create({
        data: usageBilling,
        props: {
          isRoot: true,
        },
      });
    }
  }

  private getUsageDayString(usageDate: Date): string {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: usageDate,
      timezone: "UTC",
      format: "MMM DD, YYYY",
    });
  }

  private getAverageRowSizeForProduct(productType: ProductType): number {
    const fallbackSize: number = 1024;

    // Narrow to telemetry product types before indexing to satisfy TypeScript
    if (
      productType !== ProductType.Traces &&
      productType !== ProductType.Logs &&
      productType !== ProductType.Metrics &&
      productType !== ProductType.Profiles &&
      productType !== ProductType.SessionReplay &&
      productType !== ProductType.SecurityEvents
    ) {
      return fallbackSize;
    }

    const value: number =
      {
        [ProductType.Traces]: AverageSpanRowSizeInBytes,
        [ProductType.Logs]: AverageLogRowSizeInBytes,
        [ProductType.Metrics]: AverageMetricRowSizeInBytes,
        [ProductType.Profiles]: AverageProfileRowSizeInBytes,
        /*
         * Dead code by design: replay sums an exact payloadBytes, so this
         * fallback is only reachable if a session somehow recorded zero bytes.
         * Present so the narrowed lookup above stays exhaustive.
         */
        [ProductType.SessionReplay]: AverageSessionReplaySessionSizeInBytes,
        [ProductType.SecurityEvents]: AverageSecurityEventRowSizeInBytes,
      }[productType] ?? fallbackSize;

    if (!Number.isFinite(value) || value <= 0) {
      return fallbackSize;
    }

    return value;
  }

  private getAverageExceptionRowSize(): number {
    const fallbackSize: number = 1024;

    if (!Number.isFinite(AverageExceptionRowSizeInBytes)) {
      return fallbackSize;
    }

    if (AverageExceptionRowSizeInBytes <= 0) {
      return fallbackSize;
    }

    return AverageExceptionRowSizeInBytes;
  }

  private getAverageProfileSampleRowSize(): number {
    const fallbackSize: number = 512;

    if (!Number.isFinite(AverageProfileSampleRowSizeInBytes)) {
      return fallbackSize;
    }

    if (AverageProfileSampleRowSizeInBytes <= 0) {
      return fallbackSize;
    }

    return AverageProfileSampleRowSizeInBytes;
  }
}

export default new Service();
