import ComponentProps from "../Pages/PageComponentProps";
import AppPlatformsLayout from "../Pages/AppPlatforms/Layout";
import AppPlatformEnvironmentViewLayout from "../Pages/AppPlatforms/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, AppPlatformsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import AppPlatformsOverview from "../Pages/AppPlatforms/Overview";
import AppPlatformEnvironments from "../Pages/AppPlatforms/Environments";
import AppPlatformsApps from "../Pages/AppPlatforms/Apps";
import AppPlatformEnvironmentApps from "../Pages/AppPlatforms/View/Apps";
import AppPlatformApp from "../Pages/AppPlatforms/View/App";
import AppPlatformsArchived from "../Pages/AppPlatforms/Archived";
import AppPlatformsLabelRules from "../Pages/AppPlatforms/Settings/LabelRules";
import AppPlatformsOwnerRules from "../Pages/AppPlatforms/Settings/OwnerRules";
import AppPlatformEnvironmentOverview from "../Pages/AppPlatforms/View/Overview";
import AppPlatformEnvironmentMetrics from "../Pages/AppPlatforms/View/Metrics";
import AppPlatformEnvironmentLogs from "../Pages/AppPlatforms/View/Logs";
import AppPlatformEnvironmentTraces from "../Pages/AppPlatforms/View/Traces";
import AppPlatformEnvironmentInstances from "../Pages/AppPlatforms/View/Instances";
import AppPlatformEnvironmentFeed from "../Pages/AppPlatforms/View/Feed";
import AppPlatformEnvironmentIncidents from "../Pages/AppPlatforms/View/Incidents";
import AppPlatformEnvironmentAlerts from "../Pages/AppPlatforms/View/Alerts";
import AppPlatformEnvironmentDocumentation from "../Pages/AppPlatforms/View/Documentation";
import AppPlatformEnvironmentSettings from "../Pages/AppPlatforms/View/Settings";
import AppPlatformEnvironmentOwners from "../Pages/AppPlatforms/View/Owners";
import AppPlatformEnvironmentDelete from "../Pages/AppPlatforms/View/Delete";
import PageNotFound from "../Pages/PageNotFound/PageNotFound";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceLabelRule from "Common/Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "Common/Models/DatabaseModels/CloudResourceOwnerRule";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

/*
 * App Platforms, mounted at …/app-platforms/*: its Overview at the mount,
 * every app at apps, the environments list at environments, each
 * environment's pages at …/app-platforms/:id - its apps at :id/apps and one
 * app's page at :id/apps/:subModelId - and its rules and archived list
 * beside them (a fixed segment outranks the :id, so apps, settings and
 * archived are never read as an environment's id). Environments were Cloud's
 * until the two products split; their old Cloud addresses forward here by
 * themselves (Pages/Cloud/View/Layout, Utils/CloudResourceViewPages).
 */
const AppPlatformsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<AppPlatformsLayout {...props} />}>
        <PageRoute
          index
          element={
            <AppPlatformsOverview
              {...props}
              pageRoute={RouteMap[PageMap.APP_PLATFORMS_OVERVIEW] as Route}
            />
          }
        />
        <PageRoute
          path={AppPlatformsRoutePath[PageMap.APP_PLATFORMS_ENVIRONMENTS] || ""}
          element={
            <AppPlatformEnvironments
              {...props}
              pageRoute={RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route}
            />
          }
        />
        <PageRoute
          path={AppPlatformsRoutePath[PageMap.APP_PLATFORMS_APPS] || ""}
          element={
            <AppPlatformsApps
              {...props}
              pageRoute={RouteMap[PageMap.APP_PLATFORMS_APPS] as Route}
            />
          }
        />
        <PageRoute
          path={
            AppPlatformsRoutePath[PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULES] ||
            ""
          }
          element={
            <AppPlatformsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            AppPlatformsRoutePath[
              PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULE_VIEW
            ] || ""
          }
          element={
            <AppPlatformsLabelRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULE_VIEW
                ] as Route
              }
              ruleViewModelType={CloudResourceLabelRule}
            />
          }
        />
        <PageRoute
          path={
            AppPlatformsRoutePath[PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULES] ||
            ""
          }
          element={
            <AppPlatformsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            AppPlatformsRoutePath[
              PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULE_VIEW
            ] || ""
          }
          element={
            <AppPlatformsOwnerRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULE_VIEW
                ] as Route
              }
              ruleViewModelType={CloudResourceOwnerRule}
            />
          }
        />
        <PageRoute
          path={AppPlatformsRoutePath[PageMap.APP_PLATFORMS_ARCHIVED] || ""}
          element={
            <AppPlatformsArchived
              {...props}
              pageRoute={RouteMap[PageMap.APP_PLATFORMS_ARCHIVED] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: CloudResource,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.APP_PLATFORMS_ROOT,
          parentPageKey: PageMap.APP_PLATFORMS_ENVIRONMENTS,
        })}
      </PageRoute>

      <PageRoute
        path={
          AppPlatformsRoutePath[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] || ""
        }
        element={<AppPlatformEnvironmentViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <AppPlatformEnvironmentOverview
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APPS,
          )}
          element={
            <AppPlatformEnvironmentApps
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APPS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL,
            2,
          )}
          element={
            <AppPlatformApp
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_METRICS,
          )}
          element={
            <AppPlatformEnvironmentMetrics
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_METRICS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_LOGS,
          )}
          element={
            <AppPlatformEnvironmentLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_LOGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_TRACES,
          )}
          element={
            <AppPlatformEnvironmentTraces
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_TRACES] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INSTANCES,
          )}
          element={
            <AppPlatformEnvironmentInstances
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INSTANCES
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_FEED,
          )}
          element={
            <AppPlatformEnvironmentFeed
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_FEED] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INCIDENTS,
          )}
          element={
            <AppPlatformEnvironmentIncidents
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INCIDENTS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_ALERTS,
          )}
          element={
            <AppPlatformEnvironmentAlerts
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_ALERTS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DOCUMENTATION,
          )}
          element={
            <AppPlatformEnvironmentDocumentation
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DOCUMENTATION
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SETTINGS,
          )}
          element={
            <AppPlatformEnvironmentSettings
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SETTINGS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_OWNERS,
          )}
          element={
            <AppPlatformEnvironmentOwners
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_OWNERS] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DELETE,
          )}
          element={
            <AppPlatformEnvironmentDelete
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DELETE] as Route
              }
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: CloudResource,
          scope: DeveloperDocsScope.View,
          props,
          parentPageKey: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
        })}

        {/*
         * A tab an environment does not have - a cloud resource's Changes,
         * a mistyped link - says so under the environment's own menu,
         * instead of leaving the page blank.
         */}
        <PageRoute
          path="*"
          element={
            <PageNotFound
              {...props}
              pageRoute={
                RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route
              }
            />
          }
        />
      </PageRoute>

      {/*
       * An address no App Platforms page has says so, as any other unknown
       * address does.
       */}
      <PageRoute
        path="*"
        element={
          <PageNotFound
            {...props}
            pageRoute={RouteMap[PageMap.APP_PLATFORMS_OVERVIEW] as Route}
          />
        }
      />
    </Routes>
  );
};

export default AppPlatformsRoutes;
