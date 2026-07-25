import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Navigation from "Common/UI/Utils/Navigation";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import DeviceHealthOidsFormField from "../../../Components/NetworkDevice/DeviceHealthOidsFormField";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { getSnmpConfigFormFields } from "../SnmpConfigFormFields";
import { getDevicePollingFormFields } from "../DevicePollingFormFields";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const NetworkDeviceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<NetworkDevice>
        name="Device Settings"
        cardProps={{
          title: "Device Settings",
          description: "Manage settings for this network device.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formSteps={[
          {
            title: "Device Details",
            id: "device-details",
          },
          {
            title: "SNMP Credentials",
            id: "snmp",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "core-switch-01",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Core switch in the US East datacenter",
          },
          {
            field: {
              hostname: true,
            },
            title: "Hostname",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "10.0.0.1 or switch-01.example.com",
            description: "IP address or hostname the probe will poll via SNMP.",
          },
          ...getSnmpConfigFormFields({ stepId: "snmp" }),
        ]}
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                hostname: true,
              },
              title: "Hostname",
              fieldType: FieldType.Text,
            },
          ],
        }}
      />
      <CardModelDetail<NetworkDevice>
        name="Polling & Data Collection"
        cardProps={{
          title: "Polling & Data Collection",
          description:
            "The assigned probe polls this device on its own schedule — inventory, interfaces, topology neighbors, endpoints, and health OIDs. Monitors are only needed to alert on what these polls report.",
        }}
        isEditable={true}
        editButtonText="Edit Polling"
        formSteps={[
          {
            title: "Polling",
            id: "polling",
          },
          {
            title: "Health OIDs",
            id: "health-oids",
          },
        ]}
        formFields={[
          ...getDevicePollingFormFields({ stepId: "polling" }),
          {
            field: {
              snmpOids: true,
            },
            title: "Health OIDs",
            stepId: "health-oids",
            description:
              "SNMP OIDs (CPU, memory, temperature, or any custom OID) collected on each poll. Values are recorded as device metrics and can be alerted on through monitor criteria.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<NetworkDevice>,
              customElementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <DeviceHealthOidsFormField
                  {...customElementProps}
                  initialValue={
                    (value.snmpOids as Array<SnmpOid> | undefined) || []
                  }
                />
              );
            },
          },
        ]}
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-polling-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                isPollingEnabled: true,
              },
              title: "Polling Enabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                pollingIntervalInMinutes: true,
              },
              title: "Polling Interval (Minutes)",
              fieldType: FieldType.Number,
            },
            {
              field: {
                walkInterfaces: true,
              },
              title: "Walk Interfaces",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                collectEndpoints: true,
              },
              title: "Collect Connected Endpoints",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                snmpOids: true,
              },
              title: "Health OIDs",
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                const oids: Array<SnmpOid> = item.snmpOids || [];
                if (oids.length === 0) {
                  return <span>No health OIDs configured.</span>;
                }
                return (
                  <span>
                    {oids
                      .map((oid: SnmpOid) => {
                        return oid.name || oid.oid;
                      })
                      .join(", ")}
                  </span>
                );
              },
            },
          ],
        }}
      />
      <ArchiveResourceCard<NetworkDevice>
        modelType={NetworkDevice}
        modelId={modelId}
        singularName="device"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICES] as Route,
        )}
      />
    </Fragment>
  );
};

export default NetworkDeviceSettings;
