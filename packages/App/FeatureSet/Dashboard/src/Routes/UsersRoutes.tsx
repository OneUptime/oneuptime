import ComponentProps from "../Pages/PageComponentProps";
import UsersLayout from "../Pages/Users/Layout";
import UsersIndex from "../Pages/Users/Index";
import UserCustomFields from "../Pages/Users/CustomFields";

import UsersViewLayout from "../Pages/Users/View/Layout";
import UsersViewIndex from "../Pages/Users/View/Index";
import UsersViewTeams from "../Pages/Users/View/Teams";
import UsersViewNotificationRules from "../Pages/Users/View/NotificationRules";
import UsersViewOnCallLayout from "../Pages/Users/View/OnCall/Layout";
import UsersViewOnCallReadiness from "../Pages/Users/View/OnCall/Readiness";
import UsersViewNotificationMethods from "../Pages/Users/View/OnCall/NotificationMethods";
import UsersViewOnCallRules from "../Pages/Users/View/OnCall/Rules";
import UsersViewCustomFields from "../Pages/Users/View/CustomFields";
import UsersViewDelete from "../Pages/Users/View/Delete";
import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";

import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, UsersRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OnCallRuleKind, {
  MOVED_ON_CALL_RULES_PATHS,
  getOnCallRuleKindQuery,
} from "Common/Types/NotificationRule/OnCallRuleKind";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

const UsersRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      {/* User View - own layout with sidemenu (more specific path first) */}
      <PageRoute
        path={UsersRoutePath[PageMap.USER_VIEW] || ""}
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
        {/*
         * The path is the LAST segment only, never RouteMap's full value: the
         * parent route above has already consumed `:id`, so handing this the
         * dictionary value would ask react-router to match `:id/:id/…` and the
         * page would render for nobody.
         *
         * This one no longer renders the section — it redirects to the
         * readiness overview. The single page it used to render carried the
         * readiness summary, the notification methods, the coverage grid and
         * four rule types at once, and is now three pages under the layout
         * below. The route survives because it is the URL people bookmarked.
         */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.USER_VIEW_NOTIFICATION_RULES,
          )}
          element={
            <UsersViewNotificationRules
              {...props}
              pageRoute={
                RouteMap[PageMap.USER_VIEW_NOTIFICATION_RULES] as Route
              }
            />
          }
        />

        {/*
         * The four pages a member's on-call rules used to be, one per kind of
         * rule, forwarding to the tab of On-Call Rules each one became. Here,
         * outside the On-Call layout below, so the forward does not wait for
         * the section's reads.
         */}
        {Object.keys(MOVED_ON_CALL_RULES_PATHS).map(
          (movedPath: string): ReactElement => {
            const kind: OnCallRuleKind = MOVED_ON_CALL_RULES_PATHS[
              movedPath
            ] as OnCallRuleKind;

            return (
              <PageRoute
                key={movedPath}
                path={movedPath}
                element={
                  <MovedPageRedirect
                    pageMap={PageMap.USER_VIEW_ON_CALL_RULES}
                    searchParams={getOnCallRuleKindQuery(kind)}
                  />
                }
              />
            );
          },
        )}

        {/*
         * The On-Call section: a PATHLESS layout route, so it adds no segment
         * of its own and the three pages below keep the flat `:id/<page>` URLs
         * the rest of this file uses. What it buys is one load of the target
         * user's identity and readiness for the whole section, one permission
         * decision, and one "you are editing on behalf of" banner — see
         * Pages/Users/View/OnCall/Layout.tsx.
         */}
        <PageRoute element={<UsersViewOnCallLayout />}>
          <PageRoute
            path={RouteUtil.getLastPathForKey(
              PageMap.USER_VIEW_ON_CALL_READINESS,
            )}
            element={
              <UsersViewOnCallReadiness
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_VIEW_ON_CALL_READINESS] as Route
                }
              />
            }
          />
          <PageRoute
            path={RouteUtil.getLastPathForKey(
              PageMap.USER_VIEW_NOTIFICATION_METHODS,
            )}
            element={
              <UsersViewNotificationMethods
                {...props}
                pageRoute={
                  RouteMap[PageMap.USER_VIEW_NOTIFICATION_METHODS] as Route
                }
              />
            }
          />
          {/*
           * One page with a tab per kind of rule, the same component a member's
           * own User Settings page draws (Components/NotificationRule/
           * OnCallRulesTabs.tsx).
           */}
          <PageRoute
            path={RouteUtil.getLastPathForKey(PageMap.USER_VIEW_ON_CALL_RULES)}
            element={
              <UsersViewOnCallRules
                {...props}
                pageRoute={RouteMap[PageMap.USER_VIEW_ON_CALL_RULES] as Route}
              />
            }
          />
        </PageRoute>
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
