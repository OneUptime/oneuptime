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
