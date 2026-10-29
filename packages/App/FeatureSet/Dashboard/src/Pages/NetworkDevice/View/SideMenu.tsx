import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentStateUtil from "../../../Utils/IncidentState";
import AlertStateUtil from "../../../Utils/AlertState";
import {
  getNetworkDeviceOpenAlertCountQuery,
  getNetworkDeviceOpenIncidentCountQuery,
} from "../Utils/NetworkDeviceOpenActivityCountQuery";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A device's own menu. Open: what most visits are for - is it OK
 * (Overview), its ports, its numbers, its traffic and logs, and what alerts
 * on it. Folded: the vendor tables some devices report and the SNMP walk
 * that finds what a device exposes (More), managing it from code
 * (Developer), and its owners, settings and delete (Manage). Activity is
 * the incidents and alerts linked to it (issue #5341), each with how many
 * are open, as a host's and a cloud resource's menus have them.
 */
const NetworkDeviceSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  /*
   * The Incidents and Alerts badges count what is still open, which takes
   * the project's unresolved state ids. They stay null until those arrive
   * (or for good, if they cannot be loaded), and the count queries stay
   * undefined meanwhile, so no badge flashes a number about to change.
   */
  const [unresolvedIncidentStateIds, setUnresolvedIncidentStateIds] =
    useState<Array<ObjectID> | null>(null);
  const [unresolvedAlertStateIds, setUnresolvedAlertStateIds] =
    useState<Array<ObjectID> | null>(null);

  useEffect(() => {
    const fetchIncidentStateIds: PromiseVoidFunction =
      async (): Promise<void> => {
        if (!projectId) {
          return;
        }

        const states: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId);

        setUnresolvedIncidentStateIds(
          states
            .map((state: IncidentState): ObjectID | null => {
              return state.id;
            })
            .filter((id: ObjectID | null): id is ObjectID => {
              return Boolean(id);
            }),
        );
      };

    const fetchAlertStateIds: PromiseVoidFunction = async (): Promise<void> => {
      if (!projectId) {
        return;
      }

      const states: Array<AlertState> =
        await AlertStateUtil.getUnresolvedAlertStates(projectId);

      setUnresolvedAlertStateIds(
        states
          .map((state: AlertState): ObjectID | null => {
            return state.id;
          })
          .filter((id: ObjectID | null): id is ObjectID => {
            return Boolean(id);
          }),
      );
    };

    /*
     * Both lists come from ModelListCache, which the header has usually
     * warmed already. A failure only costs its badge: the items still link
     * to their tabs.
     */
    fetchIncidentStateIds().catch(() => {
      // The Incidents badge simply stays hidden.
    });
    fetchAlertStateIds().catch(() => {
      // The Alerts badge simply stays hidden.
    });
  }, []);

  return (
    <SideMenu>
      <SideMenuSection title="Device">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Interfaces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_INTERFACES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bolt}
        />
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Graph}
        />
        <SideMenuItem
          link={{
            title: "Traffic",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_TRAFFIC] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ArrowUpDown}
        />
        <SideMenuItem
          link={{
            title: "Events",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_EVENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Activity}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
        <SideMenuItem
          link={{
            title: "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_MONITORS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.AltGlobe}
        />
      </SideMenuSection>

      <SideMenuSection title="Activity">
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={getNetworkDeviceOpenIncidentCountQuery({
            projectId: projectId,
            networkDeviceId: props.modelId,
            unresolvedStateIds: unresolvedIncidentStateIds,
          })}
        />
        <CountModelSideMenuItem<Alert>
          link={{
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={getNetworkDeviceOpenAlertCountQuery({
            projectId: projectId,
            networkDeviceId: props.modelId,
            unresolvedStateIds: unresolvedAlertStateIds,
          })}
        />
      </SideMenuSection>

      {/*
       * The vendor tables a walk reads - IPsec tunnels, fans, power
       * supplies, an access point's radios and SSIDs. Most devices have
       * none, so they wait folded, and open by themselves on their pages.
       */}
      <SideMenuSection title="More" defaultCollapsed={true}>
        <SideMenuItem
          link={{
            title: "SNMP Tables",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_TABLES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TableCells}
        />
        {/*
         * Every OID the device answers (issue #5184): what to collect, when
         * setting a device up, rather than a page of every visit.
         */}
        <SideMenuItem
          link={{
            title: "SNMP Walk",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.MagnifyingGlass}
        />
        <SideMenuItem
          link={{
            title: "Wi-Fi",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_WIFI] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Wifi}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: NetworkDevice,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Manage">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Device",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default NetworkDeviceSideMenu;
