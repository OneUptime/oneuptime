import ComponentProps from "../Pages/PageComponentProps";
import LogsLayout from "../Pages/Logs/Layout";
import LogsSettingsLayout from "../Pages/Logs/Settings/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { LogsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import LogsPage from "../Pages/Logs/Index";
import LogsInsightsPage from "../Pages/Logs/Insights";
import LogsDocumentationPage from "../Pages/Logs/Documentation";
import LogsSettingsPipelines from "../Pages/Logs/Settings/Pipelines";
import LogsSettingsPipelineView from "../Pages/Logs/Settings/PipelineView";
import LogsSettingsDropFilters from "../Pages/Logs/Settings/DropFilters";
import LogsSettingsDropFilterView from "../Pages/Logs/Settings/DropFilterView";
import LogsSettingsScrubRules from "../Pages/Logs/Settings/ScrubRules";

const LogsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<LogsLayout {...props} />}>
        <PageRoute
          index
          element={
            <LogsPage {...props} pageRoute={RouteMap[PageMap.LOGS] as Route} />
          }
        />
        <PageRoute
          path={LogsRoutePath[PageMap.LOGS_INSIGHTS] || ""}
          element={
            <LogsInsightsPage
              {...props}
              pageRoute={RouteMap[PageMap.LOGS_INSIGHTS] as Route}
            />
          }
        />
        <PageRoute
          path={LogsRoutePath[PageMap.LOGS_DOCUMENTATION] || ""}
          element={
            <LogsDocumentationPage
              {...props}
              pageRoute={RouteMap[PageMap.LOGS_DOCUMENTATION] as Route}
            />
          }
        />

        {/* Settings Routes */}
        <PageRoute element={<LogsSettingsLayout />}>
          <PageRoute
            path={LogsRoutePath[PageMap.LOGS_SETTINGS_PIPELINES] || ""}
            element={
              <LogsSettingsPipelines
                {...props}
                pageRoute={RouteMap[PageMap.LOGS_SETTINGS_PIPELINES] as Route}
              />
            }
          />
          <PageRoute
            path={LogsRoutePath[PageMap.LOGS_SETTINGS_PIPELINE_VIEW] || ""}
            element={
              <LogsSettingsPipelineView
                {...props}
                pageRoute={
                  RouteMap[PageMap.LOGS_SETTINGS_PIPELINE_VIEW] as Route
                }
              />
            }
          />
          <PageRoute
            path={LogsRoutePath[PageMap.LOGS_SETTINGS_DROP_FILTERS] || ""}
            element={
              <LogsSettingsDropFilters
                {...props}
                pageRoute={
                  RouteMap[PageMap.LOGS_SETTINGS_DROP_FILTERS] as Route
                }
              />
            }
          />
          <PageRoute
            path={LogsRoutePath[PageMap.LOGS_SETTINGS_DROP_FILTER_VIEW] || ""}
            element={
              <LogsSettingsDropFilterView
                {...props}
                pageRoute={
                  RouteMap[PageMap.LOGS_SETTINGS_DROP_FILTER_VIEW] as Route
                }
              />
            }
          />
          <PageRoute
            path={LogsRoutePath[PageMap.LOGS_SETTINGS_SCRUB_RULES] || ""}
            element={
              <LogsSettingsScrubRules
                {...props}
                pageRoute={RouteMap[PageMap.LOGS_SETTINGS_SCRUB_RULES] as Route}
              />
            }
          />
        </PageRoute>
      </PageRoute>
    </Routes>
  );
};

export default LogsRoutes;
