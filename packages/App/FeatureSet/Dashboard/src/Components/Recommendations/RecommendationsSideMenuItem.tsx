import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationCoverageApi from "./MonitorRecommendationCoverageApi";
import RecommendationDismissalUtil from "./RecommendationDismissalUtil";
import RecommendationFilterUtil from "./RecommendationFilterUtil";
import RecommendationResourceRegistry, {
  RecommendationResourceDefinition,
} from "./RecommendationResourceRegistry";
import { RecommendationViewModel } from "./RecommendationViewModel";
import { useRecommendationsChangedCount } from "./RecommendationsChanged";

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
  // Counted again when the page beside it sets up or dismisses some.
  const changes: number = useRecommendationsChangedCount();

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
      /*
       * The fetch comes FIRST, before the catalog is consulted, because for a
       * service the catalog's answer depends on the row: a Java service is
       * offered six more recommendations than the language-agnostic set, and
       * computing the set before the fetch would badge every service with the
       * agnostic count while the page next door listed the full one. Two views
       * of the same number disagreeing is a far harder bug to spot than a
       * missing badge.
       */
      let resource: BaseModel | null = null;

      // A resource type whose row the person cannot read says how to read it.
      if (resourceDefinition.loadResource) {
        resource = await resourceDefinition.loadResource(props.resourceId);
      } else {
        resource = await ModelAPI.getItem({
          modelType: resourceDefinition.modelType,
          id: props.resourceId,
          select: RecommendationResourceRegistry.getSelect(props.resourceType),
        });
      }

      /*
       * Loaded exactly as the page loads it — including the telemetry
       * question some resources need answered (have a database's engine
       * metrics arrived?) — so the badge never counts recommendations the
       * page behind it no longer offers.
       */
      const resourceContext: MonitorRecommendationContext =
        await RecommendationResourceRegistry.loadContext({
          resourceType: props.resourceType,
          model: resource,
        });

      const recommendations: Array<MonitorRecommendation> =
        MonitorRecommendationCatalog.getRecommendations(
          props.resourceType,
          resourceContext,
        );

      if (recommendations.length === 0) {
        return;
      }

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

      /*
       * Coverage is decided by the server, with a query over every monitor
       * the reader may read (#11074): the badge read the first 10,000
       * monitors of each type, so one past them never covered anything.
       */
      const [coveredMonitorIds, dismissals]: [
        Map<string, ObjectID>,
        Array<RecommendationDismissal>,
      ] = await Promise.all([
        MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds({
          recommendations: recommendations,
          args: {
            resourceIdentifier: resourceIdentifier,
            onlineMonitorStatusId: fingerprintOnlyPlaceholderId,
            offlineMonitorStatusId: fingerprintOnlyPlaceholderId,
            defaultIncidentSeverityId: fingerprintOnlyPlaceholderId,
            defaultAlertSeverityId: fingerprintOnlyPlaceholderId,
            monitorName: resourceDisplayName,
          },
        }),
        RecommendationDismissalUtil.getDismissals({
          resourceType: props.resourceType,
          resourceId: props.resourceId,
          recommendationType: RecommendationType.Monitor,
        }),
      ]);

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: recommendations,
          coveredMonitorIds: coveredMonitorIds,
          dismissals: dismissals,
        });

      setCount(RecommendationFilterUtil.getActionableCount(viewModels));
    } catch {
      // Badge simply won't show a count. The page behind it still works.
    }
  }, [props.resourceType, props.resourceId.toString(), changes]);

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
