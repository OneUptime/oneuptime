import Incident from "Common/Models/DatabaseModels/Incident";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import Service from "Common/Models/DatabaseModels/Service";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import { ModelFormOnBeforeUpdate } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React from "react";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../AffectedResources/AffectedResourcesPicker";
import {
  hasPickedMonitors,
  omitMonitorStatusWithoutMonitors,
} from "./ChangeMonitorStatusField";

/*
 * The Edit form of an incident's Affected Resources card, split as Declare
 * Incident is: the monitors on their own, the status they change to right
 * under them once one is picked, and everything else the incident affects
 * below. Each picker writes back only its own relations, and the form still
 * saves exactly the columns the one picker it replaces did - the monitors,
 * the other resource relations and the monitor status - so what an edit
 * stores is what it stored before for the same picks.
 *
 * In a module of its own so the incident page and its tests draw the same
 * fields.
 */
export const getIncidentAffectedResourcesFormFields: () => Fields<Incident> =
  (): Fields<Incident> => {
    return [
      {
        field: {
          monitors: true,
        },
        title: "Monitors",
        description:
          "Search and attach the monitors affected by this incident. The status pages that list them show it.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        getCustomElement: (
          values: FormValues<Incident>,
          elementProps: CustomElementProps,
        ) => {
          return (
            <AffectedResourcesPicker
              monitors={values.monitors as Array<Monitor>}
              resourceTypes={["Monitor"]}
              placeholder="Search monitors..."
              ariaLabelledby={elementProps.ariaLabelledby}
              onChange={(payload: unknown) => {
                elementProps.onChange?.(payload);
              }}
            />
          );
        },
        onChange: (
          value: unknown,
          currentValues: FormValues<Incident>,
          setNewFormValues: (values: FormValues<Incident>) => void,
        ) => {
          // Only the monitors are this picker's to write.
          if (isAffectedResourcesPayload(value)) {
            const payload: typeof value = value;
            queueMicrotask(() => {
              setNewFormValues({
                ...currentValues,
                monitors: payload.monitors,
              } as FormValues<Incident>);
            });
          }
        },
      },
      {
        field: {
          changeMonitorStatusTo: true,
        },
        title: "Change Monitor Status to",
        description:
          "This will change the status of all the monitors attached to this incident.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownModal: {
          type: MonitorStatus,
          labelField: "name",
          valueField: "_id",
          sort: {
            priority: SortOrder.Ascending,
          },
        },
        required: false,
        placeholder: "Monitor Status",
        showIf: (values: FormValues<Incident>): boolean => {
          return hasPickedMonitors(values);
        },
      },
      {
        /*
         * Everything else the incident affects, anchored on `hosts`;
         * the payload is split back into each relation below, and
         * the hidden registrations load and save the rest.
         */
        field: {
          hosts: true,
        },
        title: "Other Affected Resources",
        description:
          "Search and attach hosts, Kubernetes clusters, Docker hosts, databases, or services affected by this incident.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        getCustomElement: (
          values: FormValues<Incident>,
          elementProps: CustomElementProps,
        ) => {
          return (
            <AffectedResourcesPicker
              hosts={values.hosts as Array<Host>}
              kubernetesClusters={
                values.kubernetesClusters as Array<KubernetesCluster>
              }
              dockerHosts={values.dockerHosts as Array<DockerHost>}
              podmanHosts={values.podmanHosts as Array<PodmanHost>}
              proxmoxClusters={values.proxmoxClusters as Array<ProxmoxCluster>}
              vmwareVCenters={values.vmwareVCenters as Array<VMwareVCenter>}
              cephClusters={values.cephClusters as Array<CephCluster>}
              dockerSwarmClusters={
                values.dockerSwarmClusters as Array<DockerSwarmCluster>
              }
              iotFleets={values.iotFleets as Array<IoTFleet>}
              databaseServers={values.databaseServers as Array<DatabaseServer>}
              services={values.services as Array<Service>}
              resourceTypes={[
                "Host",
                "KubernetesCluster",
                "DockerHost",
                "PodmanHost",
                "ProxmoxCluster",
                "VMwareVCenter",
                "CephCluster",
                "DockerSwarmCluster",
                "IoTFleet",
                "DatabaseServer",
                "Service",
              ]}
              ariaLabelledby={elementProps.ariaLabelledby}
              onChange={(payload: unknown) => {
                elementProps.onChange?.(payload);
              }}
            />
          );
        },
        onChange: (
          value: unknown,
          currentValues: FormValues<Incident>,
          setNewFormValues: (values: FormValues<Incident>) => void,
        ) => {
          // The monitors are the other picker's: not written here.
          if (isAffectedResourcesPayload(value)) {
            const payload: typeof value = value;
            queueMicrotask(() => {
              setNewFormValues({
                ...currentValues,
                hosts: payload.hosts,
                kubernetesClusters: payload.kubernetesClusters,
                dockerHosts: payload.dockerHosts,
                podmanHosts: payload.podmanHosts,
                proxmoxClusters: payload.proxmoxClusters,
                vmwareVCenters: payload.vmwareVCenters,
                cephClusters: payload.cephClusters,
                dockerSwarmClusters: payload.dockerSwarmClusters,
                iotFleets: payload.iotFleets,
                databaseServers: payload.databaseServers,
                services: payload.services,
              } as FormValues<Incident>);
            });
          }
        },
      },
      /*
       * Hidden registrations so ModelForm.getSelectFields includes
       * kubernetesClusters/dockerHosts/services and the rest on load
       * and submit (hosts is the picker's anchor above).
       */
      {
        field: { kubernetesClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { dockerHosts: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { podmanHosts: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { proxmoxClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { vmwareVCenters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { cephClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { dockerSwarmClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { iotFleets: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { databaseServers: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
      {
        field: { services: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: () => {
          return false;
        },
      },
    ];
  };

/*
 * Change Monitor Status to is asked only while a monitor is picked. Without
 * one, the status is not sent at all, so the incident keeps the one it had -
 * as it did when the form sent it back unchanged - and a status changed
 * before the last monitor was removed is not saved unseen.
 */
export const onBeforeIncidentAffectedResourcesUpdate: ModelFormOnBeforeUpdate<
  Incident
> = async (
  item: Incident,
  _miscDataProps: JSONObject,
  formValues: JSONObject,
): Promise<Incident> => {
  return omitMonitorStatusWithoutMonitors({
    item: item,
    formValues: formValues,
  });
};
