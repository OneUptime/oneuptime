import ComponentProps from "../Pages/PageComponentProps";
import ProfilesLayout from "../Pages/Profiles/Layout";
import ProfilesViewLayout from "../Pages/Profiles/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, ProfilesRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import ProfilesPage from "../Pages/Profiles/Index";
import ProfilesListPage from "../Pages/Profiles/List";
import ProfilesDocumentationPage from "../Pages/Profiles/Documentation";
import ProfileViewPage from "../Pages/Profiles/View/Index";
import ProfilesAIInsightsPage from "../Pages/Profiles/AI/Insights";
import ProfilesAIInsightViewPage from "../Pages/Profiles/AI/InsightView";
import ProfilesAILogsPage from "../Pages/Profiles/AI/Logs";
import ProfilesAISettingsPage from "../Pages/Profiles/AI/Settings";

const ProfilesRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ProfilesLayout {...props} />}>
        <PageRoute
          index
          element={
            <ProfilesPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILES] as Route}
            />
          }
        />
        <PageRoute
          path={ProfilesRoutePath[PageMap.PROFILES_INSIGHTS] || ""}
          element={
            <ProfilesListPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILES_INSIGHTS] as Route}
            />
          }
        />
        <PageRoute
          path={ProfilesRoutePath[PageMap.PROFILES_DOCUMENTATION] || ""}
          element={
            <ProfilesDocumentationPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILES_DOCUMENTATION] as Route}
            />
          }
        />

        {/* The AI section: what OneUptime found, what it did, its settings. */}
        <PageRoute
          path={ProfilesRoutePath[PageMap.PROFILES_AI_INSIGHTS] || ""}
          element={
            <ProfilesAIInsightsPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILES_AI_INSIGHTS] as Route}
            />
          }
        />
        <PageRoute
          path={ProfilesRoutePath[PageMap.PROFILES_AI_INSIGHT_VIEW] || ""}
          element={
            <ProfilesAIInsightViewPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILES_AI_INSIGHT_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={ProfilesRoutePath[PageMap.PROFILES_AI_LOGS] || ""}
          element={
            <ProfilesAILogsPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILES_AI_LOGS] as Route}
            />
          }
        />
        <PageRoute
          path={ProfilesRoutePath[PageMap.PROFILES_AI_SETTINGS] || ""}
          element={
            <ProfilesAISettingsPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILES_AI_SETTINGS] as Route}
            />
          }
        />
      </PageRoute>

      {/* Profile View */}
      <PageRoute
        path={ProfilesRoutePath[PageMap.PROFILE_VIEW] || ""}
        element={<ProfilesViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <ProfileViewPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PROFILE_VIEW)}
          element={
            <ProfileViewPage
              {...props}
              pageRoute={RouteMap[PageMap.PROFILE_VIEW] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ProfilesRoutes;
