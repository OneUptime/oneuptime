import { TELEMETRY_RECOMMENDATION_MILESTONES } from "./TelemetrySetup";
import { isMonitorBatchConsentRequired } from "../../Billing/PayAsYouGo";
import {
  MonitorRecommendationProjectDefaults,
  loadMonitorRecommendationProjectSetup,
} from "../../Recommendations/MonitorRecommendationProjectSetup";
import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "../../Recommendations/MonitorRecommendationCreateUtil";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectMilestone from "Common/Models/DatabaseModels/ProjectMilestone";
import Service from "Common/Models/DatabaseModels/Service";
import ActivationMilestone, {
  isActivationMilestone,
} from "Common/Types/Analytics/ActivationMilestone";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  buildServiceMonitorArgs,
  buildServiceMonitorPlan,
  getTelemetryRecommendations,
} from "Common/Utils/GuidedSetup/ServiceMonitorRecords";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE RECORDS THE TELEMETRY GUIDED SETUP READS AND WRITES (issue #6806),
 * through the same model API and the same recommended-monitor plan a
 * service's Recommendations tab uses (MonitorRecommendations), so the
 * monitors it makes are the ones that tab would make, and the tab counts
 * them as covered. Billing: a recommended monitor is billed on the Free
 * plan like any other (PayAsYouGo), so the step asks for the same
 * acknowledgement the tab does (isMonitorBatchConsentRequired) and this
 * file refuses to create without it.
 */

export interface TelemetrySetupService {
  id: string;
  name: string;
  hasReported: boolean;
}

export interface TelemetrySetupMonitor {
  id: string;
  name: string;
}

export interface TelemetryMonitorCreateResult {
  createdIds: Array<string>;
  // The monitors refused, by name, with the server's reason.
  failures: Array<{ name: string; message: string }>;
}

export const mayCreateMonitors: () => boolean = (): boolean => {
  return PermissionGate.check(new Monitor(), ModelAction.Create).isAllowed;
};

/*
 * The recommended monitors, from the Service catalog, in the setup's order:
 * the ones for the data the project's first data says arrived (#7146), or
 * the setup's three when that is not known. Common's
 * (Utils/GuidedSetup/ServiceMonitorRecords), where Ask AI picks them too
 * (#7243).
 */
export { getTelemetryRecommendations };

const toService: (service: Service) => TelemetrySetupService = (
  service: Service,
): TelemetrySetupService => {
  return {
    id: service._id!.toString(),
    name: service.name || "",
    hasReported: Boolean(service.lastSeenAt),
  };
};

// What every recommended monitor of the service is built with: Common's.
const buildArgs: (data: {
  service: TelemetrySetupService;
  defaults: MonitorRecommendationProjectDefaults;
}) => MonitorRecommendationArgs = (data: {
  service: TelemetrySetupService;
  defaults: MonitorRecommendationProjectDefaults;
}): MonitorRecommendationArgs => {
  return buildServiceMonitorArgs({
    service: { id: data.service.id, name: data.service.name },
    defaults: data.defaults,
  });
};

export default class TelemetrySetupApi {
  // The run's service, or null once it is gone.
  public static async loadService(
    id: string,
  ): Promise<TelemetrySetupService | null> {
    const service: Service | null = await ModelAPI.getItem<Service>({
      modelType: Service,
      id: new ObjectID(id),
      select: { _id: true, name: true, lastSeenAt: true },
    });

    return service?._id ? toService(service) : null;
  }

  /*
   * The project's first data the offer reads (TELEMETRY_RECOMMENDATION_
   * MILESTONES): which of its first logs, traces, metrics and exceptions
   * have arrived.
   */
  public static async loadFirstDataReached(): Promise<
    Array<ActivationMilestone>
  > {
    const result: ListResult<ProjectMilestone> =
      await ModelAPI.getList<ProjectMilestone>({
        modelType: ProjectMilestone,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          milestone: new Includes([...TELEMETRY_RECOMMENDATION_MILESTONES]),
        },
        limit: TELEMETRY_RECOMMENDATION_MILESTONES.length,
        skip: 0,
        select: { _id: true, milestone: true },
        sort: {},
      });

    return result.data
      .map((mark: ProjectMilestone): unknown => {
        return mark.milestone;
      })
      .filter(isActivationMilestone);
  }

  // The project's services that have reported, the latest first.
  public static async loadReportingServices(): Promise<
    Array<TelemetrySetupService>
  > {
    const result: ListResult<Service> = await ModelAPI.getList<Service>({
      modelType: Service,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        lastSeenAt: new NotNull(),
      },
      limit: 5,
      skip: 0,
      select: { _id: true, name: true, lastSeenAt: true },
      sort: { lastSeenAt: SortOrder.Descending },
    });

    return result.data
      .filter((service: Service): boolean => {
        return Boolean(service._id);
      })
      .map(toService);
  }

  /*
   * Which recommended monitors the service has already (made by this setup
   * or its Recommendations tab), by recommendation id: the tab's own
   * coverage test (MonitorRecommendationUtil), so nothing is made twice.
   */
  public static async loadCoveredRecommendationIds(data: {
    service: TelemetrySetupService;
    recommendations: Array<MonitorRecommendation>;
    translator: Translator;
  }): Promise<Array<string>> {
    const setup: { defaults: MonitorRecommendationProjectDefaults } =
      await loadMonitorRecommendationProjectSetup(data.translator);

    const monitorTypes: Array<MonitorType> = Array.from(
      new Set<MonitorType>(
        data.recommendations.map(
          (recommendation: MonitorRecommendation): MonitorType => {
            return recommendation.monitorType;
          },
        ),
      ),
    );

    const lists: Array<ListResult<Monitor>> = await Promise.all(
      monitorTypes.map(
        async (monitorType: MonitorType): Promise<ListResult<Monitor>> => {
          return await ModelAPI.getList<Monitor>({
            modelType: Monitor,
            query: { monitorType: monitorType },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { _id: true, name: true, monitorSteps: true },
            sort: { name: SortOrder.Ascending },
          });
        },
      ),
    );

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: data.recommendations,
        existingMonitors: lists
          .flatMap((list: ListResult<Monitor>): Array<Monitor> => {
            return list.data;
          })
          .filter((monitor: Monitor): boolean => {
            return Boolean(monitor.id);
          })
          .map((monitor: Monitor) => {
            return {
              monitorId: monitor.id!,
              monitorSteps:
                MonitorRecommendationCreateUtil.getExistingMonitorSteps([
                  monitor,
                ]) as Array<MonitorStep>,
            };
          }),
        args: buildArgs({ service: data.service, defaults: setup.defaults }),
      });

    return Array.from(covered.keys());
  }

  /*
   * The monitors picked, as the Recommendations tab makes them, each one
   * opening an alert (not an incident): for the team, never on a status
   * page. One after another, and a refusal is a value: the rest are still
   * made, and the step says which one was refused and why.
   */
  public static async createMonitors(data: {
    service: TelemetrySetupService;
    recommendations: Array<MonitorRecommendation>;
    recommendationIds: Array<string>;
    hasAcknowledgedBilling: boolean;
    translator: Translator;
  }): Promise<TelemetryMonitorCreateResult> {
    const setup: { defaults: MonitorRecommendationProjectDefaults } =
      await loadMonitorRecommendationProjectSetup(data.translator);

    // Common's plan (ServiceMonitorRecords), which Ask AI builds too (#7243).
    const plan: Array<MonitorRecommendationCreatePlanItem> =
      buildServiceMonitorPlan({
        service: { id: data.service.id, name: data.service.name },
        recommendations: data.recommendations,
        recommendationIds: data.recommendationIds,
        defaults: setup.defaults,
      });

    if (
      !data.hasAcknowledgedBilling &&
      isMonitorBatchConsentRequired(
        plan.map((item: MonitorRecommendationCreatePlanItem): MonitorType => {
          return item.monitor.monitorType as MonitorType;
        }),
      )
    ) {
      throw new Error(
        data.translator.translateText(
          "Confirm that you understand these monitors are billed before creating them.",
        ) || "",
      );
    }

    const result: TelemetryMonitorCreateResult = {
      createdIds: [],
      failures: [],
    };

    for (const item of plan) {
      try {
        const response: HTTPResponse<Monitor> =
          (await ModelAPI.createOrUpdate<Monitor>({
            model: item.monitor,
            modelType: Monitor,
            formType: FormType.Create,
            miscDataProps: item.miscDataProps,
          })) as HTTPResponse<Monitor>;

        const id: string | undefined = response.data?.id?.toString();

        if (id) {
          result.createdIds.push(id);
        }
      } catch (err) {
        result.failures.push({
          name: item.monitor.name || "",
          message: API.getFriendlyMessage(err),
        });
      }
    }

    return result;
  }

  // The run's monitors that still exist, by name.
  public static async loadMonitors(
    ids: Array<string>,
  ): Promise<Array<TelemetrySetupMonitor>> {
    if (ids.length === 0) {
      return [];
    }

    const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        _id: new Includes(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      limit: ids.length,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
    });

    return result.data
      .filter((monitor: Monitor): boolean => {
        return Boolean(monitor._id);
      })
      .map((monitor: Monitor): TelemetrySetupMonitor => {
        return { id: monitor._id!.toString(), name: monitor.name || "" };
      });
  }
}
