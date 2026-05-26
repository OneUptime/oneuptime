import ComponentProps from "../Pages/PageComponentProps";
import UsersLayout from "../Pages/Users/Layout";
import UsersIndex from "../Pages/Users/Index";
import UserCustomFields from "../Pages/Users/CustomFields";

import UsersViewLayout from "../Pages/Users/View/Layout";
import UsersViewIndex from "../Pages/Users/View/Index";
import UsersViewTeams from "../Pages/Users/View/Teams";
import UsersViewCustomFields from "../Pages/Users/View/CustomFields";
import UsersViewDelete from "../Pages/Users/View/Delete";

import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, UsersRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

const UsersRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      {/* User View - own layout with sidemenu (more specific path first) */}
      <PageRoute
        path={`${UsersRoutePath[PageMap.USER_VIEW]}/*`}
        element={<UsersViewLayout />}
      >
        <PageRoute
          index
          element={
            <UsersViewIndex
              {...props}
              pageRoute={RouteMap[PageMap.USER_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.USER_VIEW_TEAMS)}
          element={
            <UsersViewTeams
              {...props}
              pageRoute={RouteMap[PageMap.USER_VIEW_TEAMS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.USER_VIEW_CUSTOM_FIELDS)}
          element={
            <UsersViewCustomFields
              {...props}
              pageRoute={RouteMap[PageMap.USER_VIEW_CUSTOM_FIELDS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.USER_VIEW_DELETE)}
          element={
            <UsersViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.USER_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>

      {/* Users list and Custom Fields - wrapped in Users layout */}
      <PageRoute path="" element={<UsersLayout />}>
        <PageRoute
          index
          element={
            <UsersIndex
              {...props}
              pageRoute={RouteMap[PageMap.USERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.USER_CUSTOM_FIELDS)}
          element={
            <UserCustomFields
              {...props}
              pageRoute={RouteMap[PageMap.USER_CUSTOM_FIELDS] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default UsersRoutes;
