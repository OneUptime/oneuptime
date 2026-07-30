import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationCreateUtil from "./MonitorRecommendationCreateUtil";
import RecommendationDismissalUtil from "./RecommendationDismissalUtil";
import RecommendationFilterUtil from "./RecommendationFilterUtil";
import RecommendationResourceRegistry, {
  RecommendationResourceDefinition,
} from "./RecommendationResourceRegistry";
import { RecommendationViewModel } from "./RecommendationViewModel";

export interface ComponentProps {
  link: Link;
  resourceType: MonitorRecommendationResourceType;
  resourceId: ObjectID;
  icon?: IconProp | undefined;
}

/*
 * The Recommendations side-menu entry, with a count of what still needs doing.
 *
 * It cannot use `CountModelSideMenuItem` — that counts rows in one table, and
 * this number is not stored anywhere. It is the catalog (a constant) minus the
 * monitors that already cover a recommendation (a fingerprint diff) minus what
 * the team dismissed (a table). The whole point of the badge is that it can
 * reach zero: a badge showing the catalog size would read the same forever and
 * would be ignored within a week.
 *
 * Every failure path here is swallowed and renders the item with no badge.
 * A side-menu entry that disappears, or a red error where a number should be,
 * is a much worse outcome than a missing count — the page behind it works
 * either way.
 */
const RecommendationsSideMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [count, setCount] = useState<number | undefined>(undefined);

  useAsyncEffect(async () => {
    const definition: MonitorRecommendationResourceTypeDefinition | undefined =
      MonitorRecommendationCatalog.getResourceTypeDefinition(
        props.resourceType,
      );

    const resourceDefinition: RecommendationResourceDefinition | undefined =
      RecommendationResourceRegistry.getDefinition(props.resourceType);

    if (!definition || !resourceDefinition) {
      return;
    }

    try {
      const recommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getRecommendations(props.resourceType);

      if (recommendations.length === 0) {
        return;
      }

      const resource: BaseModel | null = await ModelAPI.getItem({
        modelType: resourceDefinition.modelType,
        id: props.resourceId,
        select: RecommendationResourceRegistry.getSelect(props.resourceType),
      });

      const { resourceIdentifier, resourceDisplayName } =
        RecommendationResourceRegistry.readResourceFields({
          resourceType: props.resourceType,
          model: resource,
        });

      /*
       * No identifier means no telemetry has arrived yet, and the page itself
       * renders a "No telemetry yet" empty state rather than a list. Badging a
       * number next to it would send people to a page with nothing on it.
       */
      if (!resourceIdentifier) {
        return;
      }

      const [monitorList, dismissals]: [
        ListResult<Monitor>,
        Array<RecommendationDismissal>,
      ] = await Promise.all([
        ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: { monitorType: definition.monitorType },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true, monitorSteps: true },
          sort: { name: SortOrder.Ascending },
        }),
        RecommendationDismissalUtil.getDismissals({
          resourceType: props.resourceType,
          resourceId: props.resourceId,
          recommendationType: RecommendationType.Monitor,
        }),
      ]);

      /*
       * `MonitorRecommendationArgs` requires monitor-status and severity ids
       * because the templates write them into the criteria they build. The
       * FINGERPRINT those criteria reduce to is only (resourceIdentifier,
       * metric names, formulas) — see
       * MonitorRecommendationUtil.getFingerprintFromMonitorStep — so the diff
       * this badge needs does not depend on any of them, and fetching four more
       * project-wide lists on every page of every resource to satisfy the type
       * would be four requests spent on values that are then discarded.
       *
       * Placeholders instead. The coupling is real and would be easy to break
       * from the template side, so it is pinned by
       * "the fingerprint ignores the monitor-status and severity args" in
       * Common/Tests/.../MonitorRecommendationCoverage.test.ts rather than left
       * as a comment.
       */
      const fingerprintOnlyPlaceholderId: ObjectID = ObjectID.getZeroObjectID();

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: recommendations,
          coveredMonitorIds:
            MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
              recommendations: recommendations,
              existingMonitors: monitorList.data
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

      setCount(RecommendationFilterUtil.getActionableCount(viewModels));
    } catch {
      // Badge simply won't show a count. The page behind it still works.
    }
  }, [props.resourceType, props.resourceId.toString()]);

  return (
    <SideMenuItem
      link={props.link}
      icon={props.icon || IconProp.Sparkles}
      /*
       * Zero is rendered as no badge rather than as "0". A cleared count
       * should look cleared.
       */
      badge={count ? count : undefined}
      badgeType={BadgeType.WARNING}
    />
  );
};

export default RecommendationsSideMenuItem;
