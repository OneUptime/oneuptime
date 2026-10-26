import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../AffectedResources/AffectedResourcesPicker";
import { MONITOR_LINKED_RESOURCE_TYPES } from "../AffectedResources/MonitorLinkedResourcesPrefillRules";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import Service from "Common/Models/DatabaseModels/Service";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React from "react";

/*
 * The Edit form of a monitor's Linked Resources card: one picker for
 * everything the monitor watches, the same resource types as an incident's
 * Other Affected Resources. Anchored on `hosts`; the picker's payload is
 * split back into each relation, and the hidden registrations load and save
 * the rest.
 *
 * In a module of its own so the monitor's page and its tests draw the same
 * fields.
 */
export const getMonitorLinkedResourcesFormFields: () => Fields<Monitor> =
  (): Fields<Monitor> => {
    return [
      {
        field: {
          hosts: true,
        },
        title: "Linked Resources",
        description:
          "The hosts, clusters, databases, cloud resources and services this monitor watches. Its incidents and alerts are linked to them, so AI can fix them there.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        getCustomElement: (
          values: FormValues<Monitor>,
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
              storageArrays={values.storageArrays as Array<StorageArray>}
              dockerSwarmClusters={
                values.dockerSwarmClusters as Array<DockerSwarmCluster>
              }
              iotFleets={values.iotFleets as Array<IoTFleet>}
              databaseServers={values.databaseServers as Array<DatabaseServer>}
              cloudResources={values.cloudResources as Array<CloudResource>}
              services={values.services as Array<Service>}
              resourceTypes={MONITOR_LINKED_RESOURCE_TYPES}
              ariaLabelledby={elementProps.ariaLabelledby}
              onChange={(payload: unknown) => {
                elementProps.onChange?.(payload);
              }}
            />
          );
        },
        onChange: (
          value: unknown,
          currentValues: FormValues<Monitor>,
          setNewFormValues: (values: FormValues<Monitor>) => void,
        ) => {
          /*
           * Defer the split so it runs after FormField's internal
           * setFieldValue overwrites the field with our payload.
           */
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
                storageArrays: payload.storageArrays,
                dockerSwarmClusters: payload.dockerSwarmClusters,
                iotFleets: payload.iotFleets,
                databaseServers: payload.databaseServers,
                cloudResources: payload.cloudResources,
                services: payload.services,
              } as FormValues<Monitor>);
            });
          }
        },
      },
      /*
       * Hidden registrations so ModelForm.getSelectFields includes the
       * other relations on load and submit (hosts is the picker's anchor
       * above). Drawn nowhere, so they say nothing.
       */
      {
        field: { kubernetesClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { dockerHosts: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { podmanHosts: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { proxmoxClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { vmwareVCenters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { cephClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { storageArrays: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { dockerSwarmClusters: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { iotFleets: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { databaseServers: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { cloudResources: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
      {
        field: { services: true },
        title: "",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        hideColumnDescription: true,
        showIf: () => {
          return false;
        },
      },
    ];
  };
