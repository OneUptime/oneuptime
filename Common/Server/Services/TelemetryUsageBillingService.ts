import { MeteredPlanUtil } from "../Types/Billing/MeteredPlan/AllMeteredPlans";
import TelemetryMeteredPlan from "../Types/Billing/MeteredPlan/TelemetryMeteredPlan";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_INFINITY } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import Decimal from "../../Types/Decimal";
import BadDataException from "../../Types/Exception/BadDataException";
import ProductType from "../../Types/MeteredPlan/ProductType";
import ObjectID from "../../Types/ObjectID";
import Model, {
  DEFAULT_RETENTION_IN_DAYS,
} from "../../Models/DatabaseModels/TelemetryUsageBilling";
import ServiceService from "./ServiceService";
import SpanService from "./SpanService";
import LogService from "./LogService";
import MetricService from "./MetricService";
import ExceptionInstanceService from "./ExceptionInstanceService";
import AnalyticsQueryHelper from "../Types/AnalyticsDatabase/QueryHelper";
import DiskSize from "../../Types/DiskSize";
import logger from "../Utils/Logger";
import PositiveNumber from "../../Types/PositiveNumber";
import ServiceModel from "../../Models/DatabaseModels/Service";
import {
  AverageSpanRowSizeInBytes,
  AverageLogRowSizeInBytes,
  AverageMetricRowSizeInBytes,
  AverageExceptionRowSizeInBytes,
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

    if (data.productType !== ProductType.Traces && averageRowSizeInBytes <= 0) {
      return;
    }

    if (
      data.productType === ProductType.Traces &&
      averageRowSizeInBytes <= 0 &&
      averageExceptionRowSizeInBytes <= 0
    ) {
      return;
    }

    const usageDayString: string = OneUptimeDate.getDateString(usageDate);
    const startOfDay: Date = OneUptimeDate.getStartOfDay(usageDate);
    const endOfDay: Date = OneUptimeDate.getEndOfDay(usageDate);

    const services: Array<ServiceModel> = await ServiceService.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        retainTelemetryDataForDays: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    if (!services || services.length === 0) {
      return;
    }

    for (const service of services) {
      if (!service?.id) {
        continue;
      }

      const existingEntry: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          productType: data.productType,
          serviceId: service.id,
          day: usageDayString,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (existingEntry) {
        continue;
      }

      let estimatedBytes: number = 0;

      try {
        if (data.productType === ProductType.Traces) {
          const spanCount: PositiveNumber = await SpanService.countBy({
            query: {
              projectId: data.projectId,
              serviceId: service.id,
              startTime: AnalyticsQueryHelper.inBetween(startOfDay, endOfDay),
            },
            skip: 0,
            limit: LIMIT_INFINITY,
            props: {
              isRoot: true,
            },
          });

          const exceptionCount: PositiveNumber =
            await ExceptionInstanceService.countBy({
              query: {
                projectId: data.projectId,
                serviceId: service.id,
                time: AnalyticsQueryHelper.inBetween(startOfDay, endOfDay),
              },
              skip: 0,
              limit: LIMIT_INFINITY,
              props: {
                isRoot: true,
              },
            });

          const totalSpanCount: number = spanCount.toNumber();
          const totalExceptionCount: number = exceptionCount.toNumber();

          if (totalSpanCount <= 0 && totalExceptionCount <= 0) {
            continue;
          }

          estimatedBytes =
            totalSpanCount * averageRowSizeInBytes +
            totalExceptionCount * averageExceptionRowSizeInBytes;
        } else if (data.productType === ProductType.Logs) {
          const count: PositiveNumber = await LogService.countBy({
            query: {
              projectId: data.projectId,
              serviceId: service.id,
              time: AnalyticsQueryHelper.inBetween(startOfDay, endOfDay),
            },
            skip: 0,
            limit: LIMIT_INFINITY,
            props: {
              isRoot: true,
            },
          });

          const totalRowCount: number = count.toNumber();

          if (totalRowCount <= 0) {
            continue;
          }

          estimatedBytes = totalRowCount * averageRowSizeInBytes;
        } else if (data.productType === ProductType.Metrics) {
          const count: PositiveNumber = await MetricService.countBy({
            query: {
              projectId: data.projectId,
              serviceId: service.id,
              time: AnalyticsQueryHelper.inBetween(startOfDay, endOfDay),
            },
            skip: 0,
            limit: LIMIT_INFINITY,
            props: {
              isRoot: true,
            },
          });

          const totalRowCount: number = count.toNumber();

          if (totalRowCount <= 0) {
            continue;
          }

          estimatedBytes = totalRowCount * averageRowSizeInBytes;
        }
      } catch (error) {
        logger.error(
          `Failed to compute telemetry usage for service ${service.id?.toString()}:`,
        );
        logger.error(error as Error);
        continue;
      }

      if (estimatedBytes <= 0) {
        continue;
      }

      const estimatedGigabytes: number = DiskSize.byteSizeToGB(estimatedBytes);

      if (!Number.isFinite(estimatedGigabytes) || estimatedGigabytes <= 0) {
        continue;
      }

      const dataRetentionInDays: number =
        service.retainTelemetryDataForDays || DEFAULT_RETENTION_IN_DAYS;

      await this.updateUsageBilling({
        projectId: data.projectId,
        productType: data.productType,
        serviceId: service.id,
        dataIngestedInGB: estimatedGigabytes,
        retentionInDays: dataRetentionInDays,
        usageDate: usageDate,
      });
    }
  }

  @CaptureSpan()
  public async updateUsageBilling(data: {
    projectId: ObjectID;
    productType: ProductType;
    serviceId: ObjectID;
    dataIngestedInGB: number;
    retentionInDays: number;
    usageDate?: Date;
  }): Promise<void> {
    if (
      data.productType !== ProductType.Traces &&
      data.productType !== ProductType.Metrics &&
      data.productType !== ProductType.Logs
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
        serviceId: data.serviceId,
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
      usageBilling.serviceId = data.serviceId;
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
      productType !== ProductType.Metrics
    ) {
      return fallbackSize;
    }

    const value: number =
      {
        [ProductType.Traces]: AverageSpanRowSizeInBytes,
        [ProductType.Logs]: AverageLogRowSizeInBytes,
        [ProductType.Metrics]: AverageMetricRowSizeInBytes,
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
}

export default new Service();
