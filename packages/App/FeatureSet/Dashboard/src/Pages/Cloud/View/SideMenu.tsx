import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentStateUtil from "../../../Utils/IncidentState";
import AlertStateUtil from "../../../Utils/AlertState";
import ScheduledMaintenanceStateUtil from "../../../Utils/ScheduledMaintenanceState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import ProjectUtil from "Common/UI/Utils/Project";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";
import {
  ResourceDataSecurityMenu,
  useResourceDataSecurityMenu,
  useResourceSecurityEventsMenu,
} from "../../../Components/ResourceDataSecurity/UseResourceSecurityMenu";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import RecommendationsSideMenuItem from "../../../Components/Recommendations/RecommendationsSideMenuItem";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

export interface ComponentProps {
  modelId: ObjectID;
  /*
   * A kind of resource whose logs an AWS stream files under it - a
   * function, a database (canCloudResourceHaveStreamedLogs): its menu has
   * Logs, after Metrics.
   */
  hasStreamedLogs?: boolean | undefined;
  /*
   * A type OneUptime recommends monitors for (CloudAlertTemplates): its
   * menu has Recommendations, after its Overview. A VPC's, a bucket's or a
   * role's would only ever say there are none.
   */
  hasRecommendations?: boolean | undefined;
  /*
   * A resource an event can reach: one its cloud's audit log names by its
   * own ID, with logs of its own, or answering on a name or address of its
   * own (canCloudResourceHaveSecurityEvents). Its menu has Security
   * Events, after Logs.
   */
  hasSecurityEvents?: boolean | undefined;
}

/*
 * A cloud resource's menu in Cloud. Its metrics are what its provider's
 * monitoring publishes about it, so it has no traces or instances of its
 * own; it has the monitors OneUptime recommends from those metrics, the
 * Changes its account's activity log records, the maintenance events that
 * hold it, and - for a kind of resource a CloudWatch Logs group names - the
 * logs a stream delivers. An environment's menu is App Platforms'
 * (Pages/AppPlatforms/View/SideMenu).
 */
const CloudResourceViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  // Security Events inside the resource (#9779).
  const showSecurityEvents: boolean = useResourceSecurityEventsMenu();
  const dataSecurityMenu: ResourceDataSecurityMenu | null =
    useResourceDataSecurityMenu({
      kind: DataStoreResourceKind.CloudResource,
      modelId: props.modelId,
    });

  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);
  const [unresolvedAlertStates, setUnresolvedAlertStates] = useState<
    Array<AlertState>
  >([]);
  const [
    activeScheduledMaintenanceStates,
    setActiveScheduledMaintenanceStates,
  ] = useState<Array<ScheduledMaintenanceState>>([]);

  const fetchStates: PromiseVoidFunction = async (): Promise<void> => {
    if (!projectId) {
      return;
    }

    try {
      setUnresolvedIncidentStates(
        await IncidentStateUtil.getUnresolvedIncidentStates(projectId),
      );
    } catch {
      // ignore — the badge simply shows no count
    }

    try {
      setUnresolvedAlertStates(
        await AlertStateUtil.getUnresolvedAlertStates(projectId),
      );
    } catch {
      // ignore — the badge simply shows no count
    }

    try {
      setActiveScheduledMaintenanceStates(
        await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
          projectId,
        ),
      );
    } catch {
      // ignore — the badge simply shows no count
    }
  };

  useEffect(() => {
    fetchStates().catch(() => {
      // fetchStates reports nothing: the badges stay empty
    });
  }, []);

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        {/*
         * The monitors OneUptime recommends for this resource, from the
         * metrics its connection reads, for a type it recommends some for.
         * The badge counts what is still to set up for its type (see
         * RecommendationsSideMenuItem); what they open lands on its
         * Incidents and Alerts, as each is linked to it.
         */}
        {props.hasRecommendations ? (
          <RecommendationsSideMenuItem
            link={{
              title: "Recommendations",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS] as Route,
                { modelId: props.modelId },
              ),
            }}
            resourceType={MonitorRecommendationResourceType.CloudResource}
            resourceId={props.modelId}
          />
        ) : (
          <></>
        )}
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Observability">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ChartBar}
        />
        {props.hasStreamedLogs ? (
          <SideMenuItem
            link={{
              title: "Logs",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_LOGS] as Route,
                { modelId: props.modelId },
              ),
            }}
            icon={IconProp.Terminal}
          />
        ) : (
          <></>
        )}
        {/*
         * The security events about this resource (#9779): what its
         * cloud's audit log names it in, and what was read from its own
         * logs. Only in a project that uses Security Events, for whoever may
         * read them, and for a resource an event can reach at all.
         */}
        {showSecurityEvents && props.hasSecurityEvents ? (
          <SideMenuItem
            link={{
              title: "Security Events",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_SECURITY_EVENTS] as Route,
                { modelId: props.modelId },
              ),
            }}
            icon={IconProp.ShieldCheck}
          />
        ) : (
          <></>
        )}
        <SideMenuItem
          link={{
            title: "Feed",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_FEED] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      {/*
       * The incidents and alerts linked to this resource - by a person, by
       * the monitor that watches it, or by OneUptime AI - the maintenance
       * events that hold it, and what its account's activity log recorded
       * about it.
       */}
      <SideMenuSection title="Activity">
        <CountModelSideMenuItem<Incident>
          link={{
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={{
            projectId: projectId!,
            cloudResources: new Includes([props.modelId]),
            currentIncidentStateId: new Includes(
              unresolvedIncidentStates.map((state: IncidentState) => {
                return state.id!;
              }),
            ),
          }}
        />
        <CountModelSideMenuItem<Alert>
          link={{
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={{
            projectId: projectId!,
            cloudResources: new Includes([props.modelId]),
            currentAlertStateId: new Includes(
              unresolvedAlertStates.map((state: AlertState) => {
                return state.id!;
              }),
            ),
          }}
        />
        {/*
         * The maintenance events that hold it: while one is in progress the
         * monitors that read its metrics open nothing. The badge counts the
         * ones in progress.
         */}
        <CountModelSideMenuItem<ScheduledMaintenance>
          link={{
            title: "Scheduled Maintenance",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.CLOUD_RESOURCE_VIEW_SCHEDULED_MAINTENANCE
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Clock}
          badgeType={BadgeType.WARNING}
          modelType={ScheduledMaintenance}
          countQuery={{
            projectId: projectId!,
            cloudResources: new Includes([props.modelId]),
            currentScheduledMaintenanceStateId: new Includes(
              activeScheduledMaintenanceStates.map(
                (state: ScheduledMaintenanceState) => {
                  return state.id!;
                },
              ),
            ),
          }}
        />
        <SideMenuItem
          link={{
            title: "Changes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_CHANGES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Activity}
        />
      </SideMenuSection>

      {/*
       * What Data Security says about this resource (#9547): the sensitive
       * data a bucket or a database holds and what to fix on it, and how it
       * stands against each framework (#9555) - only for a resource Data
       * Security has read, in a project that uses Data Security. Folded by
       * its title, and open by itself on its own pages.
       */}
      {dataSecurityMenu ? (
        <SideMenuSection title="Security">
          <SideMenuItem
            link={{
              title: "Data Security",
              to: dataSecurityMenu.dataSecurityRoute,
            }}
            icon={IconProp.Fingerprint}
          />
          <SideMenuItem
            link={{
              title: "Compliance",
              to: dataSecurityMenu.complianceRoute,
            }}
            icon={IconProp.ClipboardDocumentCheck}
          />
        </SideMenuSection>
      ) : (
        <></>
      )}

      {getDeveloperSideMenuSection({
        modelType: CloudResource,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
        parentPageKey: PageMap.CLOUD_RESOURCE_VIEW,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        {/*
         * Settings sits with the other pages that change the record. It
         * was the only entry of a Settings section, under a heading of
         * its own name (#9134).
         */}
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete Resource",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW_DELETE] as Route,
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

export default CloudResourceViewSideMenu;
