import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { CloudAppTabName } from "../../Pages/AppPlatforms/View/AppTabs";
import { CloudAccountRecommendationResource } from "./CloudAccountRecommendationPlan";
import { CloudAccountRecommendationResources } from "./CloudAccountRecommendationData";
import CloudEnvironmentAppRecommendationPlan, {
  CloudEnvironmentAppRecommendationGapReason,
} from "./CloudEnvironmentAppRecommendationPlan";
import {
  loadCloudEnvironmentAppRecommendationCoverage,
  loadCloudEnvironmentAppRecommendationResources,
} from "./CloudEnvironmentAppRecommendationData";
import GroupedMonitorRecommendations, {
  GroupedRecommendationsNotListedReason,
  GroupedRecommendationsSource,
  GroupedRecommendationsWords,
} from "./GroupedMonitorRecommendations";

export interface ComponentProps {
  // The environment whose apps are offered monitors.
  environmentId: ObjectID;
}

// What the group of an environment's apps is called, above its rows.
export const CLOUD_ENVIRONMENT_APPS_GROUP_LABEL: string =
  translationKey("Apps");

/*
 * What each reason says, above the apps it names: a name too long to filter
 * by is said of the one app it names, or of them all.
 */
export const CLOUD_ENVIRONMENT_NOT_LISTED_REASON_TEXT: Readonly<
  Record<CloudEnvironmentAppRecommendationGapReason, string | PluralTemplate>
> = {
  [CloudEnvironmentAppRecommendationGapReason.NotScoped]: {
    one: "This app's name is too long to filter its telemetry by, so no monitor can watch it alone. Its telemetry is in this environment's tabs.",
    other:
      "Their names are too long to filter their telemetry by, so no monitor can watch one of them alone. Their telemetry is in this environment's tabs.",
  },
  [CloudEnvironmentAppRecommendationGapReason.PlatformUnknown]: translationKey(
    "Offered once this environment's telemetry names its platform",
  ),
};

// The reasons, in the order the section says them.
const NOT_LISTED_REASONS: ReadonlyArray<CloudEnvironmentAppRecommendationGapReason> =
  [
    CloudEnvironmentAppRecommendationGapReason.NotScoped,
    CloudEnvironmentAppRecommendationGapReason.PlatformUnknown,
  ];

/*
 * An app's own page, on its Recommendations tab: the one a row's name and
 * a left-out app's name open, where it says the rest.
 */
export function getCloudAppRecommendationsRoute(data: {
  environmentId: ObjectID | string;
  appId: ObjectID | string;
}): Route {
  return new Route(
    `${RouteUtil.populateRouteParams(
      RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL] as Route,
      {
        modelId: new ObjectID(data.environmentId.toString()),
        subModelId: new ObjectID(data.appId.toString()),
      },
    ).toString()}?tab=${CloudAppTabName.Recommendations}`,
  );
}

// What an environment's page calls its apps, in every sentence it says.
export const CLOUD_ENVIRONMENT_RECOMMENDATION_WORDS: GroupedRecommendationsWords =
  {
    targetCoverage: {
      one: "Set up on {{created}} of {{count}} app",
      other: "Set up on {{created}} of {{count}} apps",
    },
    showTargets: translationKey("Show apps"),
    hideTargets: translationKey("Hide apps"),
    addToTargets: {
      one: "Add to {{count}} App",
      other: "Add to {{count}} Apps",
    },
    addToTargetsLabel: {
      one: "Add {{name}} to the {{count}} app still without it",
      other: "Add {{name}} to the {{count}} apps still without it",
    },
    groupTargets: {
      one: "Recommended for {{count}} app",
      other: "Recommended for {{count}} apps",
    },
    addAllLabel: {
      one: "Add the {{count}} monitor still to set up on this environment's apps",
      other:
        "Add the {{count}} monitors still to set up on this environment's apps",
    },
    createResourceLabel: translationKey("App"),
    createDescription: {
      one: "These monitors will be created on {{count}} app of this environment. Everything below applies to all of them.",
      other:
        "These monitors will be created on {{count}} apps of this environment. Everything below applies to all of them.",
    },
    noTargets: {
      title: "No apps in this environment yet",
      description:
        "Recommendations appear once an app in this environment sends its first telemetry.",
      icon: IconProp.Squares,
    },
    noRecommendations: {
      title: "No recommendations for this environment's apps yet",
      description:
        "The list below says why for each app. You can still create monitors by hand.",
    },
    allHandledDescription: {
      one: "The {{count}} recommended monitor for this environment's apps has been created or dismissed. Use the tiles above to review it.",
      other:
        "All {{count}} recommended monitors for this environment's apps have been created or dismissed. Use the tiles above to review them.",
    },
    cutNote: translationKey(
      "Only the first {{shown}} of the environment's {{total}} apps are read here.",
    ),
  };

/*
 * AN APP PLATFORMS ENVIRONMENT'S RECOMMENDED MONITORS: the monitors
 * OneUptime recommends for every app it runs (CloudAppAlertTemplates) - its
 * requests failing, slowing or stopping - a row per recommendation, drawn
 * as a cloud account's are (GroupedMonitorRecommendations). One Add sets a
 * recommendation up on every app still without it, Add all every
 * recommendation, and an app's own Add just that one - its Recommendations
 * tab offers the same monitors one app at a time. Every monitor is linked to
 * the environment, so its maintenance holds them and its Incidents and
 * Alerts list what they open. The apps left out are named at the end, by
 * why: a name too long to filter by, a platform not known yet.
 */
const CloudEnvironmentAppRecommendations: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const environmentId: string = props.environmentId.toString();
  const groupLabel: string =
    translator.translateText(CLOUD_ENVIRONMENT_APPS_GROUP_LABEL) ||
    CLOUD_ENVIRONMENT_APPS_GROUP_LABEL;

  const source: GroupedRecommendationsSource =
    useMemo((): GroupedRecommendationsSource => {
      const getAppRoute: (
        resource: CloudAccountRecommendationResource,
      ) => Route = (resource: CloudAccountRecommendationResource): Route => {
        return getCloudAppRecommendationsRoute({
          environmentId: environmentId,
          appId: resource.resourceId,
        });
      };

      return {
        testIdPrefix: "cloud-environment-recommendation",
        loadResources: (): Promise<CloudAccountRecommendationResources> => {
          return loadCloudEnvironmentAppRecommendationResources({
            environmentId: new ObjectID(environmentId),
            translator: translator,
          });
        },
        loadCoverage: loadCloudEnvironmentAppRecommendationCoverage,
        buildGroups: (
          data: Parameters<GroupedRecommendationsSource["buildGroups"]>[0],
        ) => {
          return CloudEnvironmentAppRecommendationPlan.buildGroups({
            ...data,
            environmentId: environmentId,
            groupLabel: groupLabel,
          });
        },
        getGaps: (
          data: Parameters<GroupedRecommendationsSource["getGaps"]>[0],
        ) => {
          return CloudEnvironmentAppRecommendationPlan.getGaps(data);
        },
        buildCreatePlan: (
          data: Parameters<GroupedRecommendationsSource["buildCreatePlan"]>[0],
        ) => {
          return CloudEnvironmentAppRecommendationPlan.buildCreatePlan({
            ...data,
            environmentId: environmentId,
          });
        },
        notListedReasons: NOT_LISTED_REASONS.map(
          (
            reason: CloudEnvironmentAppRecommendationGapReason,
          ): GroupedRecommendationsNotListedReason => {
            return {
              reason: reason,
              text: CLOUD_ENVIRONMENT_NOT_LISTED_REASON_TEXT[reason],
              getRoute: getAppRoute,
            };
          },
        ),
        getTargetRoute: getAppRoute,
        words: CLOUD_ENVIRONMENT_RECOMMENDATION_WORDS,
      };
    }, [environmentId, groupLabel]);

  return (
    <GroupedMonitorRecommendations
      source={source}
      sourceKey={environmentId}
      cardDescription={translator.translateTemplate(
        "Monitors OneUptime recommends for this environment's apps, from the requests their OpenTelemetry reports. Add one to an app, or to every app at once.",
      )}
    />
  );
};

export default CloudEnvironmentAppRecommendations;
