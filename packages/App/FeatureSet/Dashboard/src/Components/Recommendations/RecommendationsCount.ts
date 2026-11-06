import { useState } from "react";
import useAsyncEffect from "use-async-effect";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationCreateUtil from "./MonitorRecommendationCreateUtil";
import RecommendationDismissalUtil from "./RecommendationDismissalUtil";
import RecommendationFilterUtil from "./RecommendationFilterUtil";
import RecommendationResourceRegistry, {
  RecommendationResourceDefinition,
} from "./RecommendationResourceRegistry";
import { RecommendationViewModel } from "./RecommendationViewModel";
import { useRecommendationsChangedCount } from "./RecommendationsChanged";

/*
 * HOW MANY OF ONE RESOURCE'S RECOMMENDED MONITORS ARE STILL TO SET UP.
 *
 * What a resource's Recommendations entry in a side menu badges
 * (RecommendationsSideMenuItem), and what an App Platforms app's
 * Recommendations tab counts beside its name: the catalog for the resource
 * (a constant), minus the monitors that already cover a recommendation (a
 * fingerprint diff), minus what the team dismissed (a table). It is not
 * stored anywhere, so it cannot be a row count; and the whole point of the
 * number is that it can reach zero - one showing the catalog's size would
 * read the same forever and be ignored within a week.
 *
 * Worked out exactly as the page behind it works it out - the row read the
 * same way, the context completed the same way (a database's heartbeat, an
 * app's environment), the same coverage join - so the two never disagree.
 */

/*
 * The count, or undefined when there is nothing honest to count: a type the
 * registry does not know, a resource offered nothing, or one whose
 * telemetry has not arrived (no identifier: its page says "No telemetry
 * yet", and a number beside that would send people to a page with nothing
 * on it). Throws when a read fails: callers show no number.
 */
export async function loadRecommendationsToSetUpCount(data: {
  resourceType: MonitorRecommendationResourceType;
  resourceId: ObjectID;
}): Promise<number | undefined> {
  const definition: MonitorRecommendationResourceTypeDefinition | undefined =
    MonitorRecommendationCatalog.getResourceTypeDefinition(data.resourceType);

  const resourceDefinition: RecommendationResourceDefinition | undefined =
    RecommendationResourceRegistry.getDefinition(data.resourceType);

  if (!definition || !resourceDefinition) {
    return undefined;
  }

  /*
   * The fetch comes FIRST, before the catalog is consulted, because for a
   * service the catalog's answer depends on the row: a Java service is
   * offered six more recommendations than the language-agnostic set, and
   * computing the set before the fetch would badge every service with the
   * agnostic count while the page next door listed the full one.
   */
  let resource: BaseModel | null = null;

  // A resource type whose row the person cannot read says how to read it.
  if (resourceDefinition.loadResource) {
    resource = await resourceDefinition.loadResource(data.resourceId);
  } else {
    resource = await ModelAPI.getItem({
      modelType: resourceDefinition.modelType,
      id: data.resourceId,
      select: RecommendationResourceRegistry.getSelect(data.resourceType),
    });
  }

  /*
   * Loaded exactly as the page loads it - including the telemetry question
   * some resources need answered (have a database's engine metrics
   * arrived?) - so the number never counts recommendations the page behind
   * it no longer offers.
   */
  const resourceContext: MonitorRecommendationContext =
    await RecommendationResourceRegistry.loadContext({
      resourceType: data.resourceType,
      model: resource,
    });

  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      data.resourceType,
      resourceContext,
    );

  if (recommendations.length === 0) {
    return undefined;
  }

  const { resourceIdentifier, resourceDisplayName } =
    RecommendationResourceRegistry.readResourceFields({
      resourceType: data.resourceType,
      model: resource,
    });

  if (!resourceIdentifier) {
    return undefined;
  }

  const [monitorLists, dismissals]: [
    Array<ListResult<Monitor>>,
    Array<RecommendationDismissal>,
  ] = await Promise.all([
    Promise.all(
      definition.monitorTypes.map(async (monitorType: MonitorType) => {
        return await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: { monitorType: monitorType },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true, monitorSteps: true },
          sort: { name: SortOrder.Ascending },
        });
      }),
    ),
    RecommendationDismissalUtil.getDismissals({
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      recommendationType: RecommendationType.Monitor,
    }),
  ]);

  /*
   * `MonitorRecommendationArgs` requires monitor-status and severity ids
   * because the templates write them into the criteria they build. The
   * FINGERPRINT those criteria reduce to is only (resourceIdentifier, metric
   * names, formulas) - see MonitorRecommendationUtil
   * .getFingerprintFromMonitorStep - so the diff this count needs does not
   * depend on any of them, and fetching four more project-wide lists on
   * every page of every resource to satisfy the type would be four requests
   * spent on values that are then discarded. Placeholders instead; the
   * coupling is pinned by "the fingerprint ignores the monitor-status and
   * severity args" in Common/Tests/.../MonitorRecommendationCoverage.test.ts.
   */
  const fingerprintOnlyPlaceholderId: ObjectID = ObjectID.getZeroObjectID();

  const monitors: Array<Monitor> = monitorLists.flatMap(
    (monitorList: ListResult<Monitor>) => {
      return monitorList.data;
    },
  );

  const viewModels: Array<RecommendationViewModel> =
    RecommendationFilterUtil.buildViewModels({
      recommendations: recommendations,
      coveredMonitorIds:
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations: recommendations,
          existingMonitors: monitors
            .filter((monitor: Monitor) => {
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
          args: {
            resourceIdentifier: resourceIdentifier,
            onlineMonitorStatusId: fingerprintOnlyPlaceholderId,
            offlineMonitorStatusId: fingerprintOnlyPlaceholderId,
            defaultIncidentSeverityId: fingerprintOnlyPlaceholderId,
            defaultAlertSeverityId: fingerprintOnlyPlaceholderId,
            monitorName: resourceDisplayName,
          },
        }),
      dismissals: dismissals,
    });

  return RecommendationFilterUtil.getActionableCount(viewModels);
}

/*
 * The count for a menu entry or a tab: undefined until it is read, when a
 * read fails, and while `isEnabled` is false (a resource whose page offers
 * nothing to set up). Read again when the page beside it sets up, dismisses
 * or restores some (RecommendationsChanged), so it never says "5 to set up"
 * over a page that just made them.
 */
export function useRecommendationsToSetUpCount(data: {
  resourceType: MonitorRecommendationResourceType;
  resourceId: ObjectID;
  isEnabled?: boolean | undefined;
}): number | undefined {
  const [count, setCount] = useState<number | undefined>(undefined);
  const changes: number = useRecommendationsChangedCount();
  const isEnabled: boolean = data.isEnabled !== false;

  useAsyncEffect(
    async (isMounted: () => boolean) => {
      if (!isEnabled) {
        setCount(undefined);
        return;
      }

      try {
        const read: number | undefined = await loadRecommendationsToSetUpCount(
          {
            resourceType: data.resourceType,
            resourceId: data.resourceId,
          },
        );

        if (isMounted()) {
          setCount(read);
        }
      } catch {
        // No number: the page behind it still works.
        if (isMounted()) {
          setCount(undefined);
        }
      }
    },
    [data.resourceType, data.resourceId.toString(), changes, isEnabled],
  );

  return count;
}
