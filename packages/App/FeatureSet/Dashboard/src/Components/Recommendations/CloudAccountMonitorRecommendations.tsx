import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { getCloudMonitoringServiceName } from "Common/Types/Monitor/CloudAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CloudAccountRecommendationPlan, {
  CloudAccountRecommendationGapReason,
  CloudAccountRecommendationResource,
} from "./CloudAccountRecommendationPlan";
import {
  CloudAccountRecommendationResources,
  loadCloudAccountRecommendationCoverage,
  loadCloudAccountRecommendationResources,
} from "./CloudAccountRecommendationData";
import GroupedMonitorRecommendations, {
  GroupedRecommendationsNotListedReason,
  GroupedRecommendationsSource,
  GroupedRecommendationsWords,
} from "./GroupedMonitorRecommendations";

export { NOT_LISTED_NAMES_SHOWN } from "./GroupedMonitorRecommendations";

export interface ComponentProps {
  // The account's cloud and its id there: what its resources are read by.
  provider: string;
  cloudAccountId: string;
}

// What each reason says, above the resources it names.
const NOT_LISTED_REASON_TEXT: Readonly<
  Record<CloudAccountRecommendationGapReason, string>
> = {
  [CloudAccountRecommendationGapReason.NoMetrics]: translationKey(
    "Waiting for their first metrics",
  ),
  [CloudAccountRecommendationGapReason.NextRead]: translationKey(
    "Offered after their next read, within a few minutes",
  ),
  [CloudAccountRecommendationGapReason.Unsupported]: translationKey(
    "No recommended monitors for them yet. You can still create one from a resource's Metrics tab.",
  ),
};

// The reasons, in the order the section says them.
const NOT_LISTED_REASONS: ReadonlyArray<CloudAccountRecommendationGapReason> = [
  CloudAccountRecommendationGapReason.NoMetrics,
  CloudAccountRecommendationGapReason.NextRead,
  CloudAccountRecommendationGapReason.Unsupported,
];

/*
 * Where a left-out resource's name leads: its Recommendations tab, which
 * says when it will be offered some, while it waits for metrics or a read;
 * its Metrics tab when no recommended monitor is for it - the tab the
 * reason's sentence sends people to, to make one of their own.
 */
export const NOT_LISTED_RESOURCE_PAGES: Readonly<
  Record<CloudAccountRecommendationGapReason, PageMap>
> = {
  [CloudAccountRecommendationGapReason.NoMetrics]:
    PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS,
  [CloudAccountRecommendationGapReason.NextRead]:
    PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS,
  [CloudAccountRecommendationGapReason.Unsupported]:
    PageMap.CLOUD_RESOURCE_VIEW_METRICS,
};

// A cloud resource's tab in Cloud.
function getResourceRoute(resourceId: string, page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(resourceId),
  });
}

// What an account's page calls its resources, in every sentence it says.
export const CLOUD_ACCOUNT_RECOMMENDATION_WORDS: GroupedRecommendationsWords = {
  targetCoverage: {
    one: "Set up on {{created}} of {{count}} resource",
    other: "Set up on {{created}} of {{count}} resources",
  },
  showTargets: translationKey("Show resources"),
  hideTargets: translationKey("Hide resources"),
  addToTargets: {
    one: "Add to {{count}} Resource",
    other: "Add to {{count}} Resources",
  },
  addToTargetsLabel: {
    one: "Add {{name}} to the {{count}} resource still without it",
    other: "Add {{name}} to the {{count}} resources still without it",
  },
  groupTargets: {
    one: "Recommended for {{count}} resource",
    other: "Recommended for {{count}} resources",
  },
  addAllLabel: {
    one: "Add the {{count}} monitor still to set up on {{type}}",
    other: "Add the {{count}} monitors still to set up on {{type}}",
  },
  createResourceLabel: translationKey("Cloud Resource"),
  createDescription: {
    one: "These monitors will be created on {{count}} resource of this account. Everything below applies to all of them.",
    other:
      "These monitors will be created on {{count}} resources of this account. Everything below applies to all of them.",
  },
  noTargets: {
    title: "No resources in this account yet",
    description:
      "Recommendations appear once a cloud connection lists the account's resources and reads their metrics.",
    icon: IconProp.Cloud,
  },
  noRecommendations: {
    title: "No recommendations for this account's resources yet",
    description:
      "The list below says why for each resource. You can still create monitors by hand.",
  },
  allHandledDescription: {
    one: "The {{count}} recommended monitor for this account's resources has been created or dismissed. Use the tiles above to review it.",
    other:
      "All {{count}} recommended monitors for this account's resources have been created or dismissed. Use the tiles above to review them.",
  },
  cutNote: translationKey(
    "Only the first {{shown}} of the account's {{total}} resources are read here.",
  ),
};

/*
 * A CLOUD ACCOUNT'S RECOMMENDED MONITORS: the monitors OneUptime recommends
 * for every resource the account holds (CloudAlertTemplates), a row per
 * recommendation of each resource type, drawn by
 * GroupedMonitorRecommendations. One Add sets a recommendation up on every
 * resource of the type still without it, Add all every recommendation of
 * the type, and a resource's own Add just that one - the resource's
 * Recommendations tab offers the same monitors one resource at a time. The
 * resources left out are named at the end, by why: no metrics yet, the next
 * read, no recommended monitor for their type.
 */
const CloudAccountMonitorRecommendations: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const source: GroupedRecommendationsSource =
    useMemo((): GroupedRecommendationsSource => {
      return {
        testIdPrefix: "cloud-account-recommendation",
        loadResources: (
          projectId: ObjectID,
        ): Promise<CloudAccountRecommendationResources> => {
          return loadCloudAccountRecommendationResources({
            projectId: projectId,
            provider: props.provider,
            cloudAccountId: props.cloudAccountId,
          });
        },
        loadCoverage: loadCloudAccountRecommendationCoverage,
        // Its resources by their cloud's type, each monitor linked to its own.
        buildGroups: (
          data: Parameters<GroupedRecommendationsSource["buildGroups"]>[0],
        ) => {
          return CloudAccountRecommendationPlan.buildGroups(data);
        },
        getGaps: (
          data: Parameters<GroupedRecommendationsSource["getGaps"]>[0],
        ) => {
          return CloudAccountRecommendationPlan.getGaps(data);
        },
        buildCreatePlan: (
          data: Parameters<GroupedRecommendationsSource["buildCreatePlan"]>[0],
        ) => {
          return CloudAccountRecommendationPlan.buildCreatePlan(data);
        },
        notListedReasons: NOT_LISTED_REASONS.map(
          (
            reason: CloudAccountRecommendationGapReason,
          ): GroupedRecommendationsNotListedReason => {
            return {
              reason: reason,
              text: NOT_LISTED_REASON_TEXT[reason],
              getRoute: (resource: CloudAccountRecommendationResource) => {
                return getResourceRoute(
                  resource.resourceId,
                  NOT_LISTED_RESOURCE_PAGES[reason],
                );
              },
            };
          },
        ),
        getTargetRoute: (resource: CloudAccountRecommendationResource) => {
          return getResourceRoute(
            resource.resourceId,
            PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS,
          );
        },
        words: CLOUD_ACCOUNT_RECOMMENDATION_WORDS,
      };
    }, [props.provider, props.cloudAccountId]);

  // The service the numbers come from, by its own name, in every language.
  const monitoringSource: string =
    getCloudMonitoringServiceName(props.provider) ||
    translator.translateText("its cloud") ||
    "its cloud";

  return (
    <GroupedMonitorRecommendations
      source={source}
      sourceKey={`${props.provider}|${props.cloudAccountId}`}
      cardDescription={translator.translateTemplate(
        "Monitors OneUptime recommends for this account's resources, from the metrics {{source}} reports. Add one to a resource, or to every resource of its type at once.",
        { source: monitoringSource },
      )}
    />
  );
};

export default CloudAccountMonitorRecommendations;
