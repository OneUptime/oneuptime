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
import MetricService from "./MetricService";
import ExceptionInstanceService from "./ExceptionInstanceService";
import ProfileService from "./ProfileService";
import ProfileSampleService from "./ProfileSampleService";
import DiskSize from "../../Types/DiskSize";
import logger from "../Utils/Logger";
import ServiceModel from "../../Models/DatabaseModels/Service";
import HostService from "./HostService";
import DockerHostService from "./DockerHostService";
import KubernetesClusterService from "./KubernetesClusterService";
import Host from "../../Models/DatabaseModels/Host";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import ServiceType from "../../Types/Telemetry/ServiceType";
import {
  AverageSpanRowSizeInBytes,
  AverageLogRowSizeInBytes,
  AverageMetricRowSizeInBytes,
  AverageExceptionRowSizeInBytes,
  AverageProfileRowSizeInBytes,
  AverageProfileSampleRowSizeInBytes,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
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

  @CaptureSpan()
  public async stageTelemetryUsageForProject(data: {
    projectId: ObjectID;
    productType: ProductType;
    usageDate?: Date;
  }): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    const usageDate: Date = data.usageDate
      ? OneUptimeDate.fromString(data.usageDate)
      : OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -1);

    const averageRowSizeInBytes: number = this.getAverageRowSizeForProduct(
      data.productType,
    );
    const averageExceptionRowSizeInBytes: number =
      this.getAverageExceptionRowSize();

    const averageProfileSampleRowSizeInBytes: number =
      this.getAverageProfileSampleRowSize();

    if (
      data.productType !== ProductType.Traces &&
      data.productType !== ProductType.Profiles &&
      averageRowSizeInBytes <= 0
    ) {
      return;
    }

    if (
      data.productType === ProductType.Traces &&
      averageRowSizeInBytes <= 0 &&
      averageExceptionRowSizeInBytes <= 0
    ) {
      return;
    }

    if (
      data.productType === ProductType.Profiles &&
      averageRowSizeInBytes <= 0 &&
      averageProfileSampleRowSizeInBytes <= 0
    ) {
      return;
    }

    const usageDayString: string = OneUptimeDate.getDateString(usageDate);
    const startOfDay: Date = OneUptimeDate.getStartOfDay(usageDate);
    const endOfDay: Date = OneUptimeDate.getEndOfDay(usageDate);

    /*
     * Enumerate usage from ClickHouse by (primaryEntityId, primaryEntityType) in a
     * single aggregation scan per analytics table. Unlike the old
     * per-Service-row loop, this surfaces EVERY resource that emitted
     * telemetry — real Services AND Hosts / Docker hosts / Kubernetes
     * clusters / unattributed (primaryEntityId = projectId) — so infrastructure
     * telemetry is no longer ingested for free. `byteSize(*)` gives the
     * estimated ingested bytes per group; the configured average row size
     * is only a fallback if the engine returns 0.
     */
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

    try {
      if (data.productType === ProductType.Traces) {
        addUsage(
          await SpanService.groupTelemetryUsageByService({
            projectId: data.projectId,
            timestampColumnName: "startTime",
            startDate: startOfDay,
            endDate: endOfDay,
          }),
          averageRowSizeInBytes,
        );
        addUsage(
          await ExceptionInstanceService.groupTelemetryUsageByService({
            projectId: data.projectId,
            timestampColumnName: "time",
            startDate: startOfDay,
            endDate: endOfDay,
          }),
          averageExceptionRowSizeInBytes,
        );
      } else if (data.productType === ProductType.Logs) {
        addUsage(
          await LogService.groupTelemetryUsageByService({
            projectId: data.projectId,
            timestampColumnName: "time",
            startDate: startOfDay,
            endDate: endOfDay,
          }),
          averageRowSizeInBytes,
        );
      } else if (data.productType === ProductType.Metrics) {
        addUsage(
          await MetricService.groupTelemetryUsageByService({
            projectId: data.projectId,
            timestampColumnName: "time",
            startDate: startOfDay,
            endDate: endOfDay,
          }),
          averageRowSizeInBytes,
        );
      } else if (data.productType === ProductType.Profiles) {
        addUsage(
          await ProfileService.groupTelemetryUsageByService({
            projectId: data.projectId,
            timestampColumnName: "startTime",
            startDate: startOfDay,
            endDate: endOfDay,
          }),
          averageRowSizeInBytes,
        );
        addUsage(
          await ProfileSampleService.groupTelemetryUsageByService({
            projectId: data.projectId,
            timestampColumnName: "time",
            startDate: startOfDay,
            endDate: endOfDay,
          }),
          averageProfileSampleRowSizeInBytes,
        );
      }
    } catch (error) {
      logger.error(
        `Failed to aggregate telemetry usage for project ${data.projectId.toString()} (${data.productType}):`,
      );
      logger.error(error as Error);
      return;
    }

    if (usageByServiceId.size === 0) {
      return;
    }

    /*
     * Resolve retention per resource (Service / Host / DockerHost /
     * KubernetesCluster overrides), defaulting to the project default for
     * everything else — including the unattributed bucket. Retention
     * scales the billed cost, so we honor per-resource overrides.
     */
    const retentionByServiceId: Map<string, number> =
      await this.buildTelemetryRetentionMap(data.projectId);
    const projectDefaultRetentionInDays: number =
      await this.getProjectDefaultRetentionInDays(data.projectId);

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

    for (const [serviceIdStr, usage] of usageByServiceId) {
      /*
       * Monitor telemetry is billed via the Active Monitoring plan, and
       * Alert/Incident telemetry is OneUptime's own operational data —
       * neither is charged as ingested telemetry volume.
       */
      if (
        usage.primaryEntityType === ServiceType.Monitor ||
        usage.primaryEntityType === ServiceType.Alert ||
        usage.primaryEntityType === ServiceType.Incident
      ) {
        continue;
      }

      if (stagedServiceIds.has(serviceIdStr)) {
        continue;
      }

      const estimatedGigabytes: number = DiskSize.byteSizeToGB(usage.bytes);
      if (!Number.isFinite(estimatedGigabytes) || estimatedGigabytes <= 0) {
        continue;
      }

      const retentionInDays: number =
        retentionByServiceId.get(serviceIdStr) ?? projectDefaultRetentionInDays;

      /*
       * Legacy rows (pre-discriminator) and any null primaryEntityType are
       * treated as OpenTelemetry — historically every billed primaryEntityId was
       * a real Service.
       */
      const primaryEntityType: ServiceType =
        (usage.primaryEntityType as ServiceType | null) ?? ServiceType.OpenTelemetry;

      await this.updateUsageBilling({
        projectId: data.projectId,
        productType: data.productType,
        primaryEntityId: new ObjectID(serviceIdStr),
        primaryEntityType: primaryEntityType,
        dataIngestedInGB: estimatedGigabytes,
        retentionInDays: retentionInDays,
        usageDate: usageDate,
      });
    }
  }

  /*
   * Map of resourceId -> retainTelemetryDataForDays for every resource in
   * the project that can own telemetry (Service, Host, DockerHost,
   * KubernetesCluster). Used to scale billed cost by the actual retention
   * applied to each resource's telemetry. Resources without an override
   * (and the unattributed bucket) fall back to the project default.
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

    return retentionByServiceId;
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
  }): Promise<void> {
    if (
      data.productType !== ProductType.Traces &&
      data.productType !== ProductType.Metrics &&
      data.productType !== ProductType.Logs &&
      data.productType !== ProductType.Profiles
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

    const usageDayString: string = OneUptimeDate.getDateString(usageDate);

    const totalCostOfThisOperationInUSD: number =
      serverMeteredPlan.getTotalCostInUSD({
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

  private getAverageRowSizeForProduct(productType: ProductType): number {
    const fallbackSize: number = 1024;

    // Narrow to telemetry product types before indexing to satisfy TypeScript
    if (
      productType !== ProductType.Traces &&
      productType !== ProductType.Logs &&
      productType !== ProductType.Metrics &&
      productType !== ProductType.Profiles
    ) {
      return fallbackSize;
    }

    const value: number =
      {
        [ProductType.Traces]: AverageSpanRowSizeInBytes,
        [ProductType.Logs]: AverageLogRowSizeInBytes,
        [ProductType.Metrics]: AverageMetricRowSizeInBytes,
        [ProductType.Profiles]: AverageProfileRowSizeInBytes,
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
