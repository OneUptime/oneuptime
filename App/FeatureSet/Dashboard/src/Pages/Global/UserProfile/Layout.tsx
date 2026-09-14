import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement, Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

interface SecondaryBreadcrumb {
  page: PageMap;
  title: string;
}

const secondaryBreadcrumbs: Array<SecondaryBreadcrumb> = [
  { page: PageMap.USER_PROFILE_PICTURE, title: "Profile Picture" },
  { page: PageMap.USER_PROFILE_PASSWORD, title: "Password Management" },
  { page: PageMap.USER_PASSKEYS, title: "Passkeys" },
  {
    page: PageMap.USER_TWO_FACTOR_AUTH,
    title: "Two-factor authentication",
  },
  { page: PageMap.USER_PROFILE_DELETE, title: "Delete Account" },
];

const normalizePath: (path: string) => string = (path: string): string => {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
};

const UserProfileLayout: FunctionComponent = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const breadcrumbLinks: Array<Link> = [
    {
      title: "Home",
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: "User Profile",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route,
      ),
    },
  ];

  const currentBreadcrumb: SecondaryBreadcrumb | undefined =
    secondaryBreadcrumbs.find((breadcrumb: SecondaryBreadcrumb): boolean => {
      return (
        normalizePath(RouteMap[breadcrumb.page]!.toString()) ===
        normalizePath(location.pathname)
      );
    });

  if (currentBreadcrumb) {
    breadcrumbLinks.push({
      title: currentBreadcrumb.title,
      to: RouteUtil.populateRouteParams(
        RouteMap[currentBreadcrumb.page] as Route,
      ),
    });
  }

  return (
    <Page
      title="User Profile"
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<SideMenu />}
    >
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <Outlet />
      </Suspense>
    </Page>
  );
};

export default UserProfileLayout;
