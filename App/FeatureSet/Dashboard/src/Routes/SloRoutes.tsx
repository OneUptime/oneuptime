import ComponentProps from "../Pages/PageComponentProps";
import SloLayout from "../Pages/Slo/Layout";
import SloViewLayout from "../Pages/Slo/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, SloRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import Slos from "../Pages/Slo/Slos";
import SloView from "../Pages/Slo/View/Index";
import SloCharts from "../Pages/Slo/View/Charts";
import SloBurnRateRules from "../Pages/Slo/View/BurnRateRules";
import SloAlerts from "../Pages/Slo/View/Alerts";
import SloAuditLogs from "../Pages/Slo/View/AuditLogs";
import SloOwners from "../Pages/Slo/View/Owners";
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
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_CHARTS)}
          element={
            <SloCharts
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_CHARTS] as Route}
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
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_ALERTS)}
          element={
            <SloAlerts
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_ALERTS] as Route}
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
          path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_OWNERS)}
          element={
            <SloOwners
              {...props}
              pageRoute={RouteMap[PageMap.SLO_VIEW_OWNERS] as Route}
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
