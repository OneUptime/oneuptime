import ComponentProps from "../Pages/PageComponentProps";
import TracesLayout from "../Pages/Traces/Layout";
import TracesSettingsLayout from "../Pages/Traces/Settings/Layout";
import TracesViewLayout from "../Pages/Traces/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, TracesRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import TracesPage from "../Pages/Traces/Index";
import TracesListPage from "../Pages/Traces/List";
import TracesDocumentationPage from "../Pages/Traces/Documentation";
import TracesSettingsPipelines from "../Pages/Traces/Settings/Pipelines";
import TracesSettingsPipelineView from "../Pages/Traces/Settings/PipelineView";
import TracesSettingsDropFilters from "../Pages/Traces/Settings/DropFilters";
import TracesSettingsDropFilterView from "../Pages/Traces/Settings/DropFilterView";
import TracesSettingsScrubRules from "../Pages/Traces/Settings/ScrubRules";
import TracesSettingsRecordingRules from "../Pages/Traces/Settings/RecordingRules";

import TraceViewPage from "../Pages/Traces/View/Index";

const TracesRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<TracesLayout {...props} />}>
        <PageRoute
          index
          element={
            <TracesPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACES] as Route}
            />
          }
        />
        <PageRoute
          path={TracesRoutePath[PageMap.TRACES_INSIGHTS] || ""}
          element={
            <TracesListPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACES_INSIGHTS] as Route}
            />
          }
        />
        <PageRoute
          path={TracesRoutePath[PageMap.TRACES_DOCUMENTATION] || ""}
          element={
            <TracesDocumentationPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACES_DOCUMENTATION] as Route}
            />
          }
        />

        {/* Settings Routes */}
        <PageRoute element={<TracesSettingsLayout />}>
          <PageRoute
            path={TracesRoutePath[PageMap.TRACES_SETTINGS_PIPELINES] || ""}
            element={
              <TracesSettingsPipelines
                {...props}
                pageRoute={RouteMap[PageMap.TRACES_SETTINGS_PIPELINES] as Route}
              />
            }
          />
          <PageRoute
            path={TracesRoutePath[PageMap.TRACES_SETTINGS_PIPELINE_VIEW] || ""}
            element={
              <TracesSettingsPipelineView
                {...props}
                pageRoute={
                  RouteMap[PageMap.TRACES_SETTINGS_PIPELINE_VIEW] as Route
                }
              />
            }
          />
          <PageRoute
            path={TracesRoutePath[PageMap.TRACES_SETTINGS_DROP_FILTERS] || ""}
            element={
              <TracesSettingsDropFilters
                {...props}
                pageRoute={
                  RouteMap[PageMap.TRACES_SETTINGS_DROP_FILTERS] as Route
                }
              />
            }
          />
          <PageRoute
            path={
              TracesRoutePath[PageMap.TRACES_SETTINGS_DROP_FILTER_VIEW] || ""
            }
            element={
              <TracesSettingsDropFilterView
                {...props}
                pageRoute={
                  RouteMap[PageMap.TRACES_SETTINGS_DROP_FILTER_VIEW] as Route
                }
              />
            }
          />
          <PageRoute
            path={TracesRoutePath[PageMap.TRACES_SETTINGS_SCRUB_RULES] || ""}
            element={
              <TracesSettingsScrubRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.TRACES_SETTINGS_SCRUB_RULES] as Route
                }
              />
            }
          />
          <PageRoute
            path={
              TracesRoutePath[PageMap.TRACES_SETTINGS_RECORDING_RULES] || ""
            }
            element={
              <TracesSettingsRecordingRules
                {...props}
                pageRoute={
                  RouteMap[PageMap.TRACES_SETTINGS_RECORDING_RULES] as Route
                }
              />
            }
          />
        </PageRoute>
      </PageRoute>

      {/* Trace View */}
      <PageRoute
        path={TracesRoutePath[PageMap.TRACE_VIEW] || ""}
        element={<TracesViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <TraceViewPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TRACE_VIEW)}
          element={
            <TraceViewPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACE_VIEW] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default TracesRoutes;
