import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getNetworkMapRootRoute } from "../NetworkSite/NetworkMapDrillState";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { addDeveloperSideMenuSection } from "../DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../DeveloperDocs/DeveloperDocsPages";

/*
 * The one side menu for the whole Network area. Both the Network Devices
 * and Network Sites route families render this same component, so wherever
 * the user lands they see the entire product as one coherent thing.
 *
 * "It has so many options. It confuses people." (the maintainer) The menu is
 * built from what someone opening Network actually comes for, in the order
 * they come for it, and nothing else is open:
 *
 *   - Overview: is my network healthy, and if not, what and where?
 *   - Devices: the things on it, and the way to add one.
 *   - Sites: where they are.
 *   - Map: the network drawn - by location when there are sites, as one
 *     device graph when there are none.
 *   - Discovery: find the devices you have not added yet.
 *
 * Everything else is folded down to a section title, one click away and
 * open by itself on any of its own pages: the deeper Topology views and the
 * links drawn by hand, the Rules that automate, the Settings that are set up
 * once, the archive and the Developer pages.
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
          /*
           * `to` resets the map's query-backed drill state. `activeRoute`
           * deliberately omits that query so the item still highlights on
           * the map page and names itself in the mobile menu summary.
           */
          link: {
            title: "Map",
            to: getNetworkMapRootRoute(),
          },
          activeRoute: RouteUtil.populateRouteParams(
            RouteMap[PageMap.NETWORK_SITE_MAP] as Route,
          ),
          icon: IconProp.Map,
        },
        {
          link: {
            title: "Discovery",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route,
            ),
          },
          icon: IconProp.Search,
        },
      ],
    },
    /*
     * The deeper views of how the network is wired, and the links drawn by
     * hand for cables discovery cannot see. The Map above is where people
     * look; these are where they dig, so they wait folded.
     */
    {
      title: "Topology",
      defaultCollapsed: true,
      items: [
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
          /*
           * What is plugged into the switches and routers - learned from
           * their ARP and forwarding tables, and only when a device collects
           * endpoints, which is off by default.
           */
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
    /*
     * Set up once, in the order people need them: how devices raise
     * incidents, then the credentials that let a device be read over SNMP,
     * then the vocabularies (roles, site types) and the OID lists.
     */
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          /*
           * A definition, not a rule: a policy is the intent "alert on
           * devices like these"; the engine that provisions the monitors
           * is what runs, and it is not something an operator opens. The
           * Overview says whether any policy is on, and links here.
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
          /*
           * Named credential sets a device is walked WITH; a device or a
           * whole site points at one, so a community string is typed once.
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
            title: "Site Types",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITE_SETTINGS_SITE_TYPES] as Route,
            ),
          },
          icon: IconProp.Layers,
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
      ],
    },
    /*
     * The way back to archived devices, which the device lists leave out. Few
     * visits need it, so it waits in Advanced: folded away until opened, and
     * open by itself on the Archived Devices page.
     */
    {
      title: "Advanced",
      items: [
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
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: NetworkDevice,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default NetworkSideMenu;
