import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getNetworkMapRootRoute } from "../NetworkSite/NetworkMapDrillState";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The one side menu for the whole Network area. Both the Network Devices
 * and Network Sites sections render this same component, so wherever the
 * user lands they see the entire product as one coherent thing instead of
 * two disconnected page groups. Day-to-day inventory comes first, followed
 * by topology, then the collapsed rule and definition sections.
 */
const NetworkSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Network",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_OVERVIEW] as Route,
            ),
          },
          icon: IconProp.Window,
        },
        {
          link: {
            title: "Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICES] as Route,
            ),
          },
          icon: IconProp.Signal,
        },
        {
          link: {
            title: "Sites",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITES] as Route,
            ),
          },
          icon: IconProp.BuildingOffice,
        },
        {
          link: {
            title: "Endpoints",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_ENDPOINTS] as Route,
            ),
          },
          icon: IconProp.Squares,
        },
        {
          link: {
            title: "Discovery Scans",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route,
            ),
          },
          icon: IconProp.Search,
        },
        {
          link: {
            title: "Archived Devices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
    {
      title: "Topology",
      items: [
        {
          /*
           * `to` resets the map's query-backed drill state. `activeRoute`
           * deliberately omits that query so the item still highlights on
           * the map page and names itself in the mobile menu summary.
           */
          link: {
            title: "Network Map",
            to: getNetworkMapRootRoute(),
          },
          activeRoute: RouteUtil.populateRouteParams(
            RouteMap[PageMap.NETWORK_SITE_MAP] as Route,
          ),
          icon: IconProp.Map,
        },
        {
          link: {
            title: "Device Topology",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_TOPOLOGY] as Route,
            ),
          },
          icon: IconProp.Graph,
        },
        {
          link: {
            title: "Latency Matrix",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_LATENCY_MATRIX] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Site Links",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_LINKS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
        {
          link: {
            title: "Device Links",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_LINKS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
      ],
    },
    {
      title: "Rules",
      defaultCollapsed: true,
      items: [
        {
          /*
           * First in the section on purpose: auto import creates the
           * devices every other rule here then acts on.
           */
          link: {
            title: "Auto Import Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.NETWORK_DEVICE_SETTINGS_AUTO_IMPORT_RULES
              ] as Route,
            ),
          },
          icon: IconProp.Download,
        },
        {
          link: {
            title: "Site Assignment Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_ASSIGNMENT_RULES] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Label,
        },
        {
          link: {
            title: "Link Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_LINK_RULES] as Route,
            ),
          },
          icon: IconProp.Link,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Device Roles",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_DEVICE_ROLES] as Route,
            ),
          },
          icon: IconProp.Identification,
        },
        {
          link: {
            title: "OID Collection Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_OID_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          /*
           * Beside the OID templates on purpose: both are named sets a
           * device links to rather than copies from — one says what a
           * device COLLECTS, this says what it is walked WITH.
           */
          link: {
            title: "SNMP Credentials",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.NETWORK_DEVICE_SETTINGS_SNMP_CREDENTIAL_PROFILES
              ] as Route,
            ),
          },
          icon: IconProp.Key,
        },
        {
          /*
           * A definition, not a rule: a policy is the intent "alert on
           * devices like these"; the engine that provisions the monitors
           * is what runs, and it is not something an operator opens.
           */
          link: {
            title: "Alert Policies",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Site Types",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_SETTINGS_SITE_TYPES] as Route,
            ),
          },
          icon: IconProp.Layers,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default NetworkSideMenu;
