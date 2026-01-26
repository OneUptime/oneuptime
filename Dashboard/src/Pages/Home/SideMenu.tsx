import IncidentStateUtil from "../../Utils/IncidentState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertStateUtil from "../../Utils/AlertState";

export interface ComponentProps {
  project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);

  const [unresolvedAlertStates, setUnresolvedAlertStates] = useState<
    Array<AlertState>
  >([]);

  const fetchIncidentStates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      if (props.project?.id) {
        const unresolvedIncidentStates: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(
            props.project?.id,
          );
        setUnresolvedIncidentStates(unresolvedIncidentStates);
      }
    } catch {
      // maybe show an error message
    }
  };

  const fetchAlertStates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      if (props.project?.id) {
        const unresolvedAlertStates: Array<AlertState> =
          await AlertStateUtil.getUnresolvedAlertStates(props.project?.id);
        setUnresolvedAlertStates(unresolvedAlertStates);
      }
    } catch {
      // maybe show an error message
    }
  };

  useEffect(() => {
    fetchIncidentStates().catch((_err: Error) => {
      // do nothing
    });

    fetchAlertStates().catch((_err: Error) => {
      // do nothing
    });
  }, []);

  const sections: SideMenuSectionProps[] = [
    {
      title: "Incidents",
      items: [
        {
          link: {
            title: "Active",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
          },
          icon: IconProp.Alert,
          badgeType: BadgeType.DANGER,
          modelType: Incident,
          countQuery: {
            projectId: props.project?._id,
            currentIncidentStateId: new Includes(
              unresolvedIncidentStates.map((state: IncidentState) => {
                return state.id!;
              }),
            ),
          },
        },
      ],
    },
    {
      title: "Alerts",
      items: [
        {
          link: {
            title: "Active Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOME_ACTIVE_ALERTS] as Route,
            ),
          },
          icon: IconProp.ExclaimationCircle,
          badgeType: BadgeType.DANGER,
          modelType: Alert,
          countQuery: {
            projectId: props.project?._id,
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          },
        },
        {
          link: {
            title: "Active Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOME_ACTIVE_EPISODES] as Route,
            ),
          },
          icon: IconProp.SquareStack,
          badgeType: BadgeType.DANGER,
          modelType: AlertEpisode,
          countQuery: {
            projectId: props.project?._id,
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          },
        },
      ],
    },
    {
      title: "Monitors",
      items: [
        {
          link: {
            title: "Inoperational",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOME_NOT_OPERATIONAL_MONITORS] as Route,
            ),
          },
          icon: IconProp.AltGlobe,
          countQuery: {
            projectId: props.project?._id,
            currentMonitorStatus: {
              isOperationalState: false,
            },
          },
          modelType: Monitor,
          badgeType: BadgeType.DANGER,
        },
      ],
    },
    {
      title: "Scheduled Events",
      items: [
        {
          link: {
            title: "Ongoing",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
              ] as Route,
            ),
          },
          icon: IconProp.Clock,
          countQuery: {
            projectId: props.project?._id,
            currentScheduledMaintenanceState: {
              isOngoingState: true,
            },
          },
          modelType: ScheduledMaintenance,
          badgeType: BadgeType.WARNING,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
