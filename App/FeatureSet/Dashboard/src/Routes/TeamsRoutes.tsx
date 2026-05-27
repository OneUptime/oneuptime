import ComponentProps from "../Pages/PageComponentProps";
import TeamsLayout from "../Pages/Teams/Layout";
import TeamsIndex from "../Pages/Teams/Index";
import TeamCustomFields from "../Pages/Teams/CustomFields";

import TeamsViewLayout from "../Pages/Teams/View/Layout";
import TeamsViewIndex from "../Pages/Teams/View/Index";
import TeamsViewMembers from "../Pages/Teams/View/Members";
import TeamsViewPermissions from "../Pages/Teams/View/Permissions";
import TeamsViewBlockPermissions from "../Pages/Teams/View/BlockPermissions";
import TeamsViewCompliance from "../Pages/Teams/View/Compliance";
import TeamsViewCustomFields from "../Pages/Teams/View/CustomFields";
import TeamsViewDelete from "../Pages/Teams/View/Delete";

import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, TeamsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

const TeamsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      {/* Team View - own layout with sidemenu (more specific path first) */}
      <PageRoute
        path={TeamsRoutePath[PageMap.TEAM_VIEW] || ""}
        element={<TeamsViewLayout />}
      >
        <PageRoute
          index
          element={
            <TeamsViewIndex
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TEAM_VIEW_MEMBERS)}
          element={
            <TeamsViewMembers
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW_MEMBERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TEAM_VIEW_PERMISSIONS)}
          element={
            <TeamsViewPermissions
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW_PERMISSIONS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TEAM_VIEW_BLOCK_PERMISSIONS,
          )}
          element={
            <TeamsViewBlockPermissions
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW_BLOCK_PERMISSIONS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TEAM_VIEW_COMPLIANCE)}
          element={
            <TeamsViewCompliance
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW_COMPLIANCE] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TEAM_VIEW_CUSTOM_FIELDS)}
          element={
            <TeamsViewCustomFields
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW_CUSTOM_FIELDS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TEAM_VIEW_DELETE)}
          element={
            <TeamsViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>

      {/* Teams list - wrapped in Teams layout */}
      <PageRoute path="" element={<TeamsLayout />}>
        <PageRoute
          index
          element={
            <TeamsIndex
              {...props}
              pageRoute={RouteMap[PageMap.TEAMS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TEAM_CUSTOM_FIELDS)}
          element={
            <TeamCustomFields
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_CUSTOM_FIELDS] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default TeamsRoutes;
