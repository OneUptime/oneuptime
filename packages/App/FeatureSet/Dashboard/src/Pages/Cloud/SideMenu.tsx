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
 * Cloud: the AWS accounts, Azure subscriptions and Google Cloud projects
 * connected to OneUptime, every resource in them, and what they cost. The
 * apps that managed app and container platforms run (ECS, Cloud Run, App
 * Service, ...) are App Platforms' (Pages/AppPlatforms/SideMenu).
 */
const CloudSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Cloud",
      items: [
        /*
         * Where Cloud opens: every account at a glance - what needs
         * attention now, what the month costs, what could be saved. While
         * there is no account, what Cloud gives and the way to connect one.
         */
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_OVERVIEW] as Route,
            ),
          },
          icon: IconProp.Home,
        },
        /*
         * The AWS accounts, Azure subscriptions and Google Cloud projects
         * the connections read, each with its resources, costs, changes
         * and map.
         */
        {
          link: {
            title: "Accounts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNTS] as Route,
            ),
          },
          icon: IconProp.Cloud,
        },
        /*
         * Every resource in the accounts - virtual machines, load balancers,
         * buckets, managed databases, queues - read by a connection, or from
         * the provider's own monitoring (Azure Monitor, CloudWatch, Cloud
         * Monitoring) by a collector.
         */
        {
          link: {
            title: "All Resources",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_MONITORED_RESOURCES] as Route,
            ),
          },
          icon: IconProp.SquareStack,
        },
        /*
         * Connecting another account: AWS, Azure and Google Cloud, in a few
         * clicks, read on a schedule with read-only access.
         */
        {
          link: {
            title: "Connect",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_CONNECT] as Route,
            ),
          },
          icon: IconProp.Link,
        },
      ],
    },
    /*
     * What the accounts cost, from each cloud's own billing; the ways to
     * spend less, from each cloud's own recommender; and the budgets that
     * alert before a month costs more than it should.
     */
    {
      title: "Spend",
      items: [
        {
          link: {
            title: "Costs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_COSTS] as Route,
            ),
          },
          icon: IconProp.Billing,
        },
        {
          link: {
            title: "Savings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_SAVINGS] as Route,
            ),
          },
          icon: IconProp.ArrowTrendingDown,
        },
        {
          link: {
            title: "Budgets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_BUDGETS] as Route,
            ),
          },
          icon: IconProp.Wallet,
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
              RouteMap[PageMap.CLOUD_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived cloud resources, which the list leaves out.
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
              RouteMap[PageMap.CLOUD_ARCHIVED] as Route,
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
    parentPageKey: PageMap.CLOUD_MONITORED_RESOURCES,
  });

  return <SideMenu sections={sections} />;
};

export default CloudSideMenu;
