import AffectedResourcesDisplay from "../../AffectedResources/AffectedResourcesDisplay";
import { getMonitorLinkedResourcesFormFields } from "../MonitorLinkedResourcesFormFields";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
}

/*
 * What the monitor watches beyond what its configuration names: the
 * cluster, hosts, databases and services behind a website or an API.
 * Every incident and alert the monitor creates is linked to them, so
 * OneUptime AI can investigate them there and the cluster's or resource's
 * AI fix can act - and the incident, alert and maintenance forms prefill
 * them when this monitor is picked.
 */
const MonitorLinkedResourcesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardModelDetail<Monitor>
      name="Monitor Linked Resources"
      cardProps={{
        title: "Linked Resources",
        description:
          "What this monitor watches. Its incidents and alerts are linked to these, so OneUptime AI can investigate and fix them there.",
        headerLayout: "stacked",
      }}
      createEditModalWidth={ModalWidth.Medium}
      editButtonText="Edit"
      isEditable={true}
      formFields={getMonitorLinkedResourcesFormFields()}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        style: DetailStyle.Compact,
        modelType: Monitor,
        id: "model-detail-monitor-linked-resources",
        fields: [
          {
            field: {
              hosts: {
                name: true,
                _id: true,
              },
              kubernetesClusters: {
                name: true,
                _id: true,
              },
              dockerHosts: {
                name: true,
                _id: true,
              },
              podmanHosts: {
                name: true,
                _id: true,
              },
              proxmoxClusters: {
                name: true,
                _id: true,
              },
              vmwareVCenters: {
                name: true,
                _id: true,
              },
              cephClusters: {
                name: true,
                _id: true,
              },
              dockerSwarmClusters: {
                name: true,
                _id: true,
              },
              iotFleets: {
                name: true,
                _id: true,
              },
              databaseServers: {
                name: true,
                _id: true,
              },
              services: {
                name: true,
                _id: true,
                serviceColor: true,
              },
            },
            title: "",
            fieldType: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return (
                <AffectedResourcesDisplay
                  hosts={item.hosts || []}
                  kubernetesClusters={item.kubernetesClusters || []}
                  dockerHosts={item.dockerHosts || []}
                  podmanHosts={item.podmanHosts || []}
                  proxmoxClusters={item.proxmoxClusters || []}
                  vmwareVCenters={item.vmwareVCenters || []}
                  cephClusters={item.cephClusters || []}
                  dockerSwarmClusters={item.dockerSwarmClusters || []}
                  iotFleets={item.iotFleets || []}
                  databaseServers={item.databaseServers || []}
                  services={item.services || []}
                  hideMonitors={true}
                  hideNetworkSites={true}
                  hideServiceLevelObjectives={true}
                  emptyMessage="Not linked to anything yet."
                  emptyDescription="Link the cluster, hosts, databases or services this monitor watches, so its incidents and alerts are linked to them too."
                  columns={1}
                />
              );
            },
          },
        ],
        modelId: props.monitorId,
      }}
    />
  );
};

export default MonitorLinkedResourcesCard;
