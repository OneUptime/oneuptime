import ComponentProps from "../Pages/PageComponentProps";
import TeamsLayout from "../Pages/Teams/Layout";
import TeamsIndex from "../Pages/Teams/Index";
import TeamCustomFields from "../Pages/Teams/CustomFields";

import TeamsViewLayout from "../Pages/Teams/View/Layout";
import TeamsViewIndex from "../Pages/Teams/View/Index";
import TeamsViewMembers from "../Pages/Teams/View/Members";
import TeamsViewPermissions from "../Pages/Teams/View/Permissions";
import TeamsViewCompliance from "../Pages/Teams/View/Compliance";
import TeamsViewOnCallSchedules from "../Pages/Teams/View/OnCallSchedules";
import TeamsViewCustomFields from "../Pages/Teams/View/CustomFields";
import TeamsViewDelete from "../Pages/Teams/View/Delete";

import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, TeamsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";
import TeamModel from "Common/Models/DatabaseModels/Team";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";
import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";

/*
 * Where a team's Block Permissions page used to be, relative to the team's
 * own URL. Block permissions are on the Permissions page now, folded under
 * Advanced at the bottom, so nothing in the RouteMap points here any more;
 * the URL is kept only so a bookmark or a link in a wiki still arrives
 * somewhere.
 */
export const MOVED_TEAM_BLOCK_PERMISSIONS_PATH: string = "block-permissions";

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
          path={MOVED_TEAM_BLOCK_PERMISSIONS_PATH}
          element={
            <MovedPageRedirect pageMap={PageMap.TEAM_VIEW_PERMISSIONS} />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TEAM_VIEW_ON_CALL_SCHEDULES,
          )}
          element={
            <TeamsViewOnCallSchedules
              {...props}
              pageRoute={RouteMap[PageMap.TEAM_VIEW_ON_CALL_SCHEDULES] as Route}
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

        {getDeveloperDocsRoutes({
          modelType: TeamModel,
          scope: DeveloperDocsScope.View,
          props,
        })}
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

        {getDeveloperDocsRoutes({
          modelType: TeamModel,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.TEAMS_ROOT,
        })}
      </PageRoute>
    </Routes>
  );
};

export default TeamsRoutes;
