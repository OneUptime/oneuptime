import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import React, { FunctionComponent, ReactElement } from "react";
import { isOpenStackIssueAbout } from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import { OpenStackPart } from "./UseOpenStackPart";

/*
 * What is open on a part and whether anyone will hear about it, on the shared cards. Turn
 * on N alerts goes to the cloud's Recommendations with those alerts ticked, as a Proxmox
 * part's does, because each is one monitor on the cloud that fires for any part crossing it.
 */

export interface OpenEventsProps {
  testId: string;
  // "Open on this hypervisor".
  title: string;
  description: string;
  part: OpenStackPart;
  // Whether a record is about this part. Defaults to its own row's labels.
  isAbout?: ((record: OpenIssueRecord) => boolean) | undefined;
  row: OpenStackResource;
}

export const OpenStackPartOpenEvents: FunctionComponent<OpenEventsProps> = (
  props: OpenEventsProps,
): ReactElement => {
  return (
    <ResourcePartOpenEventsCard
      testId={props.testId}
      title={props.title}
      description={props.description}
      resourceRelation="openStackClouds"
      resourceId={props.part.openStackCloudId}
      isAbout={
        props.isAbout ||
        ((record: OpenIssueRecord): boolean => {
          return isOpenStackIssueAbout(record, props.row);
        })
      }
      getIncidentRoute={props.part.routes.getIncidentRoute}
      getAlertRoute={props.part.routes.getAlertRoute}
      incidentsRoute={props.part.routes.incidentsRoute}
      alertsRoute={props.part.routes.alertsRoute}
      refreshToken={props.part.refreshToken}
    />
  );
};

export interface AlertsProps {
  testId: string;
  // "Hypervisor alerts".
  title: string;
  description: string;
  templateIds: Array<string>;
  part: OpenStackPart;
}

export const OpenStackPartAlerts: FunctionComponent<AlertsProps> = (
  props: AlertsProps,
): ReactElement => {
  return (
    <ResourcePartAlertsCard
      testId={props.testId}
      title={props.title}
      description={props.description}
      resourceType={MonitorRecommendationResourceType.OpenStack}
      templateIds={props.templateIds}
      resourceId={props.part.openStackCloudId}
      resourceIdentifier={props.part.cloudName}
      getRecommendationsRoute={props.part.routes.getRecommendationsRoute}
      getMonitorRoute={props.part.routes.getMonitorRoute}
      refreshToken={props.part.refreshToken}
    />
  );
};
