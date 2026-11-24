import PageMap from "../../Utils/PageMap";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import { ONBOARDING_PAGE_CLASS_NAME } from "../../Components/GuidedSetup/OnboardingPage";
import Link from "Common/Types/Link";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, {
  FunctionComponent,
  ReactElement,
  Suspense,
  useMemo,
  useState,
} from "react";
import { Outlet } from "react-router-dom";

/*
 * What Home tells its frame (#10276): whether a new project's quickstart is
 * all of Home (HomeMode.Quickstart). While it is, the page is centred, its
 * title and trail over the quickstart, as wide as the guided setups it leads
 * to: a wide screen drew the question in its left half and nothing beside
 * it. Everything else on Home keeps the page's whole width.
 */
export interface HomeFrame {
  setIsQuickstart: (isQuickstart: boolean) => void;
}

// Home's page while the quickstart is all of it (Page's className).
export const HOME_QUICKSTART_PAGE_CLASS_NAME: string =
  ONBOARDING_PAGE_CLASS_NAME;

/*
 * Home's frame. Home is one page, the overview, and it has no side menu: it
 * draws what needs attention itself, and each thing it counts - active
 * incidents, active alerts, monitors that are not operational, maintenance
 * in progress, SLOs at risk - opens that product's own list, where its side
 * menu, filters and actions are. Home used to keep copies of six such lists
 * under a menu of its own, so its Active Alerts opened a Home page instead of
 * the one in Alerts; their addresses forward to the products' lists now
 * (Routes/MovedHomeRoutes).
 */
const HomeLayout: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const homeRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.HOME] as Route,
  );

  const [isQuickstart, setIsQuickstart] = useState<boolean>(false);

  // One object for Home's whole life, so its effect runs on its own changes.
  const frame: HomeFrame = useMemo((): HomeFrame => {
    return { setIsQuickstart: setIsQuickstart };
  }, []);

  const breadcrumbLinks: Array<Link> = [
    {
      title: "Project",
      to: homeRoute,
    },
    {
      title: "Home",
      to: homeRoute,
    },
  ];

  return (
    <Page
      title="Home"
      breadcrumbLinks={breadcrumbLinks}
      className={isQuickstart ? HOME_QUICKSTART_PAGE_CLASS_NAME : undefined}
    >
      <Suspense fallback={<PageSkeleton />}>
        <Outlet context={frame} />
      </Suspense>
    </Page>
  );
};

export default HomeLayout;
