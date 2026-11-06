import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DEFAULT_SLA_TARGET_PERCENTAGE } from "../../../Types/DataObservability/DataProductFreshness";
import BadDataException from "../../../Types/Exception/BadDataException";
import { buildDataProductMonitorStep } from "../../../Types/Monitor/DataProductMonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import AlertSeverityService from "../../Services/AlertSeverityService";
import DataProductService from "../../Services/DataProductService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import ServiceLevelObjectiveService from "../../Services/ServiceLevelObjectiveService";

/*
 * A DATA PRODUCT'S MONITOR AND SLO, KEPT IN STEP WITH IT.
 *
 *  - The monitor: a Metrics monitor over oneuptime.data.product.late_tables
 *    (DataProductMonitorStep), Degraded while a table is late, with an
 *    incident - what a status page's subscribers are told of - at the
 *    project's least severe level. It is the data product on a status page,
 *    private or public.
 *  - The SLO: the monitor's uptime against the product's SLA target over 30
 *    days, any status but Operational counting as down, with the fast and
 *    slow burn-rate alerts every SLO starts with.
 *
 * Both are made and changed as the person who saved the product, with their
 * own permissions - so who may not create monitors or SLOs gets the reason,
 * and both are billed like any other - and are ordinary from then on:
 * owners, on-call, maintenance, status pages. Deleting the product deletes
 * them (DataProductService).
 */

const MAX_MONITOR_NAME_LENGTH: number = 100;
const SLO_WINDOW_IN_DAYS: number = 30;

interface ProjectSeed {
  onlineMonitorStatusId: ObjectID;
  degradedMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}

export interface DataProductSyncResult {
  monitorId: string;
  serviceLevelObjectiveId: string;
}

export function getDataProductMonitorName(productName: string): string {
  return `${productName} - Data Product`.slice(0, MAX_MONITOR_NAME_LENGTH);
}

export default class DataProductSync {
  public static async sync(data: {
    projectId: ObjectID;
    dataProductId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataProductSyncResult> {
    const product: DataProduct | null = await DataProductService.findOneBy({
      query: { _id: data.dataProductId, projectId: data.projectId },
      select: {
        _id: true,
        name: true,
        slaTargetPercentage: true,
        monitorId: true,
        serviceLevelObjectiveId: true,
      },
      props: { isRoot: true },
    });

    if (!product?.id) {
      throw new BadDataException("Data product not found.");
    }

    const monitorId: ObjectID = await this.syncMonitor({
      projectId: data.projectId,
      product,
      props: data.props,
    });
    const sloId: ObjectID = await this.syncSlo({
      projectId: data.projectId,
      product,
      monitorId,
      props: data.props,
    });

    return {
      monitorId: monitorId.toString(),
      serviceLevelObjectiveId: sloId.toString(),
    };
  }

  private static async syncMonitor(data: {
    projectId: ObjectID;
    product: DataProduct;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID> {
    const { product } = data;
    const seed: ProjectSeed = await this.readSeed(data.projectId);
    const name: string = getDataProductMonitorName(product.name || "");
    const steps: MonitorSteps = new MonitorSteps();

    steps.data = {
      monitorStepsInstanceArray: [
        buildDataProductMonitorStep({
          dataProductId: product.id!.toString(),
          productName: product.name || "Data product",
          monitorName: name,
          onlineMonitorStatusId: seed.onlineMonitorStatusId,
          degradedMonitorStatusId: seed.degradedMonitorStatusId,
          defaultIncidentSeverityId: seed.incidentSeverityId,
          defaultAlertSeverityId: seed.alertSeverityId,
        }),
      ],
      defaultMonitorStatusId: seed.onlineMonitorStatusId,
    };

    const liveMonitor: Monitor | null = product.monitorId
      ? await MonitorService.findOneBy({
          query: { _id: product.monitorId, projectId: data.projectId },
          select: { _id: true },
          props: { isRoot: true },
        })
      : null;
    // Unless someone deleted it on the Monitors page.
    const liveMonitorId: ObjectID | null = liveMonitor?.id || null;

    if (liveMonitorId) {
      await MonitorService.updateOneById({
        id: liveMonitorId,
        data: { name, monitorSteps: steps } as never,
        props: data.props,
      });

      return liveMonitorId;
    }

    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = name;
    monitor.description = `Degraded while a table of the data product "${product.name || ""}" is late by its SLA, from Data Observability. Put it on a status page for the product's consumers to subscribe to.`;
    monitor.monitorType = MonitorType.Metrics;
    monitor.monitorSteps = steps;

    const created: Monitor = await MonitorService.create({
      data: monitor,
      props: data.props,
    });

    await DataProductService.updateColumnsByIdWithoutHooks({
      id: product.id!,
      data: { monitorId: created.id! } as never,
    });

    return created.id!;
  }

  private static async syncSlo(data: {
    projectId: ObjectID;
    product: DataProduct;
    monitorId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID> {
    const { product } = data;
    const name: string = `${product.name || "Data product"} freshness`.slice(
      0,
      MAX_MONITOR_NAME_LENGTH,
    );
    const target: number =
      product.slaTargetPercentage === undefined ||
      product.slaTargetPercentage === null
        ? DEFAULT_SLA_TARGET_PERCENTAGE
        : Number(product.slaTargetPercentage);
    const liveSlo: ServiceLevelObjective | null =
      product.serviceLevelObjectiveId
        ? await ServiceLevelObjectiveService.findOneBy({
            query: {
              _id: product.serviceLevelObjectiveId,
              projectId: data.projectId,
            },
            select: { _id: true },
            props: { isRoot: true },
          })
        : null;
    // Unless someone deleted it on the SLOs page.
    const liveSloId: ObjectID | null = liveSlo?.id || null;

    if (liveSloId) {
      await ServiceLevelObjectiveService.updateOneById({
        id: liveSloId,
        data: { name, targetPercentage: target } as never,
        props: data.props,
      });

      return liveSloId;
    }

    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.projectId = data.projectId;
    slo.name = name;
    slo.description = `How much of the time the data product "${product.name || ""}" is fresh by its SLA: its monitor's uptime, any status but Operational counting as late. From Data Observability.`;
    slo.sliType = SliType.MonitorUptime;
    slo.monitors = [new Monitor(data.monitorId)];
    slo.targetPercentage = target;
    slo.windowType = SloWindowType.Rolling;
    slo.windowDays = SLO_WINDOW_IN_DAYS;

    const created: ServiceLevelObjective =
      await ServiceLevelObjectiveService.create({
        data: slo,
        props: data.props,
      });

    await DataProductService.updateColumnsByIdWithoutHooks({
      id: product.id!,
      data: { serviceLevelObjectiveId: created.id! } as never,
    });

    return created.id!;
  }

  private static async readSeed(projectId: ObjectID): Promise<ProjectSeed> {
    const byPriority: { priority: SortOrder; createdAt: SortOrder } = {
      priority: SortOrder.Ascending,
      createdAt: SortOrder.Ascending,
    };
    const online: MonitorStatus | null = await MonitorStatusService.findOneBy({
      query: { projectId, isOperationalState: true },
      select: { _id: true },
      sort: byPriority,
      props: { isRoot: true },
    });
    // Degraded: the least serious status that is neither operational nor offline.
    const degraded: MonitorStatus | null =
      (await MonitorStatusService.findOneBy({
        query: { projectId, isOperationalState: false, isOfflineState: false },
        select: { _id: true },
        sort: byPriority,
        props: { isRoot: true },
      })) ||
      (await MonitorStatusService.findOneBy({
        query: { projectId, isOfflineState: true },
        select: { _id: true },
        sort: byPriority,
        props: { isRoot: true },
      }));
    // The least severe: late data is not an outage.
    const incidentSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Descending },
        props: { isRoot: true },
      });
    const alertSeverity: AlertSeverity | null =
      await AlertSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Descending },
        props: { isRoot: true },
      });

    if (
      !online?.id ||
      !degraded?.id ||
      !incidentSeverity?.id ||
      !alertSeverity?.id
    ) {
      throw new BadDataException(
        "This project is missing an operational or degraded monitor status, or an incident or alert severity. Add them in Settings, then save the data product again.",
      );
    }

    return {
      onlineMonitorStatusId: online.id,
      degradedMonitorStatusId: degraded.id,
      incidentSeverityId: incidentSeverity.id,
      alertSeverityId: alertSeverity.id,
    };
  }
}
