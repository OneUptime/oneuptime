import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

/*
 * App Platforms: the apps a managed app or container platform runs for you
 * - AWS ECS and Fargate, App Runner and Elastic Beanstalk, Google Cloud Run
 * and App Engine, Azure Container Apps, Container Instances and App
 * Service. Its Overview says how they are doing across every platform, All
 * Apps lists every app - an ECS service, a Cloud Run service, a Container
 * App - with its requests, errors and latency, and All Environments lists
 * one environment per platform, account and region, as the apps' own
 * OpenTelemetry reports them.
 */
const AppPlatformsSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "App Platforms",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_OVERVIEW] as Route,
            ),
          },
          // As Inventory's Overview: how the whole product is doing.
          icon: IconProp.ChartBar,
        },
        {
          link: {
            title: "All Apps",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_APPS] as Route,
            ),
          },
          icon: IconProp.Squares,
        },
        {
          link: {
            title: "All Environments",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived environments, which the list leaves out.
     * Few visits need it, so it waits in Advanced: folded away until opened,
     * and open by itself on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: CloudResource,
    scope: DeveloperDocsScope.List,
    parentPageKey: PageMap.APP_PLATFORMS_ENVIRONMENTS,
  });

  return <SideMenu sections={sections} />;
};

export default AppPlatformsSideMenu;
