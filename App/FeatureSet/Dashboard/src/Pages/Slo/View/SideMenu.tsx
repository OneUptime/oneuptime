import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import AlertStateUtil from "../../../Utils/AlertState";
import IncidentStateUtil from "../../../Utils/IncidentState";
import {
  getSloOpenAlertCountQuery,
  getSloOpenIncidentCountQuery,
} from "../Utils/SloOpenActivityCountQuery";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const SloViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  /*
   * The Alerts and Incidents badges count what is still OPEN, which takes the
   * project's unresolved state ids. They stay null until those arrive (or for
   * good, if they cannot be loaded), and the count queries stay undefined
   * meanwhile, so no badge flashes a number that is about to change.
   */
  const [unresolvedIncidentStateIds, setUnresolvedIncidentStateIds] =
    useState<Array<ObjectID> | null>(null);
  const [unresolvedAlertStateIds, setUnresolvedAlertStateIds] =
    useState<Array<ObjectID> | null>(null);

  const fetchUnresolvedIncidentStateIds: PromiseVoidFunction =
    async (): Promise<void> => {
      if (!projectId) {
        return;
      }

      const states: Array<IncidentState> =
        await IncidentStateUtil.getUnresolvedIncidentStates(projectId);
      const stateIds: Array<ObjectID> = [];

      for (const state of states) {
        if (state.id) {
          stateIds.push(state.id);
        }
      }

      setUnresolvedIncidentStateIds(stateIds);
    };

  const fetchUnresolvedAlertStateIds: PromiseVoidFunction =
    async (): Promise<void> => {
      if (!projectId) {
        return;
      }

      const states: Array<AlertState> =
        await AlertStateUtil.getUnresolvedAlertStates(projectId);
      const stateIds: Array<ObjectID> = [];

      for (const state of states) {
        if (state.id) {
          stateIds.push(state.id);
        }
      }

      setUnresolvedAlertStateIds(stateIds);
    };

  useEffect(() => {
    /*
     * Both lists come from ModelListCache, which the header has usually
     * warmed already. A failure only costs the badge - the items still link
     * to their tabs.
     */
    fetchUnresolvedIncidentStateIds().catch(() => {
      // ignore — the badge simply stays hidden
    });
    fetchUnresolvedAlertStateIds().catch(() => {
      // ignore — the badge simply stays hidden
    });
  }, []);

  return (
    <SideMenu>
      <SideMenuSection title="SLO">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        {/*
         * Monitors and Monitor Rules sit together: the rules decide which
         * monitors are attached, so whoever is looking at one usually needs
         * the other next.
         */}
        <SideMenuItem
          link={{
            title: "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_MONITORS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.AltGlobe}
        />
        <SideMenuItem
          link={{
            title: "Monitor Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_MONITOR_RULES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Filter}
        />
        <SideMenuItem
          link={{
            title: "Burn Rate Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_BURN_RATE_RULES] as Route,
              { modelId: props.modelId },
            ),
          }}
          /*
           * The model's own icon. Alert used to be here, which now collides
           * with the Incidents item below — and the rules do more than
           * alerts anyway.
           */
          icon={IconProp.Fire}
        />
        {/*
         * Metrics replaces the old Charts entry: the SLO's history is one of
         * its views. The Charts route itself still resolves for bookmarks.
         */}
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Graph}
        />
        {/*
         * Open counts, not totals: the badge is a prompt to look, so it counts
         * only what this SLO raised that is still unresolved - through the
         * same serviceLevelObjectives relation the two tabs list.
         */}
        <CountModelSideMenuItem<Alert>
          link={{
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={getSloOpenAlertCountQuery({
            projectId: projectId,
            sloId: props.modelId,
            unresolvedStateIds: unresolvedAlertStateIds,
          })}
        />
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={getSloOpenIncidentCountQuery({
            projectId: projectId,
            sloId: props.modelId,
            unresolvedStateIds: unresolvedIncidentStateIds,
          })}
        />
        <SideMenuItem
          link={{
            title: "Feed",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_FEED] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete SLO",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLO_VIEW_DELETE] as Route,
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

export default SloViewSideMenu;
