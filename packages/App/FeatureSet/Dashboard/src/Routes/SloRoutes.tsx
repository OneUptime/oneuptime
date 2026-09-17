import ComponentProps from "../Pages/PageComponentProps";
import SloLayout from "../Pages/Slo/Layout";
import SloViewLayout from "../Pages/Slo/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, SloRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import Slos from "../Pages/Slo/Slos";
import SlosArchived from "../Pages/Slo/Archived";
import SloView from "../Pages/Slo/View/Index";
import SloMonitors from "../Pages/Slo/View/Monitors";
import SloMonitorRules from "../Pages/Slo/View/MonitorRules";
import SloBurnRateRules from "../Pages/Slo/View/BurnRateRules";
import SloMetrics from "../Pages/Slo/View/Metrics";
import SloCharts from "../Pages/Slo/View/Charts";
import SloAlerts from "../Pages/Slo/View/Alerts";
import SloIncidents from "../Pages/Slo/View/Incidents";
import SloFeedPage from "../Pages/Slo/View/Feed";
import SloAuditLogs from "../Pages/Slo/View/AuditLogs";
import SloOwners from "../Pages/Slo/View/Owners";
import SloSettings from "../Pages/Slo/View/Settings";
import SloDelete from "../Pages/Slo/View/Delete";

const SloRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<SloLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <Slos {...props} pageRoute={RouteMap[PageMap.SLOS] as Route} />
          }
        />

        {/*
         * Inside the list layout, not the view layout: the list side menu is
         * the one that links here, and `archived` must never be taken for an
         * SLO id by the `:id` branch below.
         */}
        <PageRoute
          path={SloRoutePath[PageMap.SLOS_ARCHIVED] || ""}
          element={
            <SlosArchived
              {...props}
              pageRoute={RouteMap[PageMap.SLOS_ARCHIVED] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={SloRoutePath[PageMap.SLO_VIEW] || ""}
        element={<SloViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <SloView
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_MONITORS)}
          element={
            <SloMonitors
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_MONITORS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_MONITOR_RULES)}
          element={
            <SloMonitorRules
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_MONITOR_RULES] as Route}
            />
          }
        />

        {/*
         * A rule's own page is the Monitor Rules page rendered for one rule.
         * Two segments below the `:id` layout (monitor-rules/:subModelId), so
         * getLastPathForKey must keep both.
         */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SLO_VIEW_MONITOR_RULE_VIEW,
            2,
          )}
          element={
            <SloMonitorRules
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_MONITOR_RULE_VIEW] as Route}
              ruleViewModelType={ServiceLevelObjectiveMonitorRule}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_BURN_RATE_RULES)}
          element={
            <SloBurnRateRules
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_BURN_RATE_RULES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_METRICS)}
          element={
            <SloMetrics
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_METRICS] as Route}
            />
          }
        />

        {/*
         * No side menu entry links here any more - the history charts moved
         * into Metrics. The route stays so bookmarked and shared Charts links
         * keep opening instead of landing on a blank layout.
         */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_CHARTS)}
          element={
            <SloCharts
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_CHARTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_ALERTS)}
          element={
            <SloAlerts
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_ALERTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_INCIDENTS)}
          element={
            <SloIncidents
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_INCIDENTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_FEED)}
          element={
            <SloFeedPage
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_FEED] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_OWNERS)}
          element={
            <SloOwners
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_SETTINGS)}
          element={
            <SloSettings
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_SETTINGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_AUDIT_LOGS)}
          element={
            <SloAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_AUDIT_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_DELETE)}
          element={
            <SloDelete
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default SloRoutes;
