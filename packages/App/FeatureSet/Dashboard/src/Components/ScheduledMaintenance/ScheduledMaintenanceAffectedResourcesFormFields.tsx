import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import Service from "Common/Models/DatabaseModels/Service";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React from "react";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../AffectedResources/AffectedResourcesPicker";

/*
 * The Edit form of a scheduled maintenance event's Affected Resources card,
 * split as Create Scheduled Maintenance Event is: the monitors on their own,
 * and everything else the event affects below. Each picker writes back only
 * its own relations, and the form still saves exactly the columns the one
 * picker it replaces did - the monitors and the other resource relations -
 * so what an edit stores is what it stored before for the same picks.
 *
 * There is no "Change Monitor Status to" here, as there was none before: an
 * event's monitor status is chosen when it is created, and the API takes no
 * change to it afterwards. Monitors added here while the event is ongoing
 * are held and changed to that status, as before.
 *
 * In a module of its own so the event's page and its tests draw the same
 * fields.
 */
export const getScheduledMaintenanceAffectedResourcesFormFields: () => Fields<ScheduledMaintenance> =
  (): Fields<ScheduledMaintenance> => {
    return [
      {
        field: {
          monitors: true,
        },
        title: "Monitors",
        description:
          "Search and attach the monitors affected by this scheduled maintenance.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        getCustomElement: (
          values: FormValues<ScheduledMaintenance>,
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
          currentValues: FormValues<ScheduledMaintenance>,
          setNewFormValues: (values: FormValues<ScheduledMaintenance>) => void,
        ) => {
          // Only the monitors are this picker's to write.
          if (isAffectedResourcesPayload(value)) {
            const payload: typeof value = value;
            queueMicrotask(() => {
              setNewFormValues({
                ...currentValues,
                monitors: payload.monitors,
              } as FormValues<ScheduledMaintenance>);
            });
          }
        },
      },
      {
        /*
         * Everything else the event affects, anchored on `hosts`; the
         * payload is split back into each relation below, and the hidden
         * registrations load and save the rest.
         */
        field: {
          hosts: true,
        },
        title: "Other Affected Resources",
        description:
          "Search and attach hosts, clusters, container hosts, databases, IoT fleets, network sites, or services affected by this scheduled maintenance. Attaching a network site covers every site beneath it.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        getCustomElement: (
          values: FormValues<ScheduledMaintenance>,
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
              networkSites={values.networkSites as Array<NetworkSite>}
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
                "NetworkSite",
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
          currentValues: FormValues<ScheduledMaintenance>,
          setNewFormValues: (values: FormValues<ScheduledMaintenance>) => void,
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
                networkSites: payload.networkSites,
                services: payload.services,
              } as FormValues<ScheduledMaintenance>);
            });
          }
        },
      },
      /*
       * Hidden registrations so ModelForm.getSelectFields includes every
       * other relation the second picker writes (clusters, container hosts,
       * IoT fleets, databases, network sites and services) on load and
       * submit; hosts is its anchor above.
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
        field: { networkSites: true },
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
