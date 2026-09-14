import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const SecurityEventsSideMenu: FunctionComponent = (): ReactElement => {
  const sections: Array<SideMenuSectionProps> = [
    {
      title: "Security Events",
      items: [
        {
          link: {
            title: "Events",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Correlate",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_CORRELATE] as Route,
            ),
          },
          icon: IconProp.Graph,
        },
      ],
    },
    {
      title: "Detection & Alerting",
      items: [
        {
          link: {
            title: "Detection Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_DETECTION_RULES] as Route,
            ),
          },
          icon: IconProp.ShieldCheck,
        },
        {
          link: {
            title: "Threat Intel",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_THREAT_INTEL] as Route,
            ),
          },
          icon: IconProp.ShieldExclamation,
        },
        {
          link: {
            title: "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_MONITORS] as Route,
            ),
          },
          icon: IconProp.AltGlobe,
        },
      ],
    },
    {
      title: "Integrations",
      items: [
        {
          link: {
            title: "Connections",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
      ],
    },
    {
      title: "Help",
      items: [
        {
          link: {
            title: "Setup Guide",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION] as Route,
            ),
          },
          icon: IconProp.Book,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default SecurityEventsSideMenu;
