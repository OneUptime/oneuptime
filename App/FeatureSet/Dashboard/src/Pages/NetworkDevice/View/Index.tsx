import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { getSnmpConfigFormFields } from "../SnmpConfigFormFields";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const NetworkDeviceView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  type GetInterfaceStatusElementFunction = (
    item: NetworkInterface,
  ) => ReactElement;

  const getInterfaceStatusElement: GetInterfaceStatusElementFunction = (
    item: NetworkInterface,
  ): ReactElement => {
    const isAdminUp: boolean = Boolean(item.isAdministrativelyUp);
    const isOperUp: boolean = Boolean(item.isOperationallyUp);

    if (!isAdminUp) {
      return (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
          <span className="text-sm font-medium text-gray-500">Disabled</span>
        </div>
      );
    }

    if (isOperUp) {
      return (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">Up</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
        <span className="text-sm font-medium text-red-700">Down</span>
      </div>
    );
  };

  return (
    <Fragment>
      <CardModelDetail<NetworkDevice>
        name="Network Device Details"
        cardProps={{
          title: "Network Device Details",
          description: "Overview and SNMP settings for this network device.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "core-switch-01",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Core switch in the US East datacenter",
          },
          {
            field: {
              hostname: true,
            },
            title: "Hostname",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "10.0.0.1 or switch-01.example.com",
          },
          ...getSnmpConfigFormFields(),
        ]}
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-details",
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
                hostname: true,
              },
              title: "Hostname",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                sysName: true,
              },
              title: "System Name (sysName)",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.sysName);
              },
            },
            {
              field: {
                sysDescr: true,
              },
              title: "System Description (sysDescr)",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.sysDescr);
              },
            },
            {
              field: {
                snmpVersion: true,
              },
              title: "SNMP Version",
              fieldType: FieldType.Text,
            },
            {
              field: {
                snmpCommunityString: true,
              },
              title: "SNMP Community String",
              fieldType: FieldType.HiddenText,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.snmpCommunityString);
              },
            },
            /*
             * v3 credentials are readable by viewer roles, so the auth/priv
             * keys are deliberately not surfaced here — only the settings a
             * user needs to confirm the device is configured the way they
             * expect.
             */
            {
              field: {
                snmpV3SecurityLevel: true,
              },
              title: "SNMP v3 Security Level",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.snmpV3SecurityLevel);
              },
            },
            {
              field: {
                snmpV3Username: true,
              },
              title: "SNMP v3 Username",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.snmpV3Username);
              },
            },
            {
              field: {
                snmpV3AuthProtocol: true,
              },
              title: "SNMP v3 Authentication Protocol",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.snmpV3AuthProtocol);
              },
            },
            {
              field: {
                snmpV3PrivProtocol: true,
              },
              title: "SNMP v3 Privacy Protocol",
              fieldType: FieldType.Text,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.snmpV3PrivProtocol);
              },
            },
            {
              field: {
                snmpPort: true,
              },
              title: "SNMP Port",
              fieldType: FieldType.Number,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
              showIf: (item: NetworkDevice): boolean => {
                return Boolean(item.lastSeenAt);
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                return (
                  <LabelsElement labels={item["labels"] as Array<Label>} />
                );
              },
              showIf: (item: NetworkDevice): boolean => {
                const labels: Array<Label> | undefined =
                  (item.labels as Array<Label> | undefined) ?? undefined;
                return Array.isArray(labels) && labels.length > 0;
              },
            },
          ],
        }}
      />
      <ModelTable<NetworkInterface>
        modelType={NetworkInterface}
        id="network-interfaces-table"
        userPreferencesKey="network-interfaces-table"
        query={{
          networkDeviceId: modelId.toString(),
        }}
        isDeleteable={false}
        isEditable={true}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        name="Network Interfaces"
        sortBy="interfaceIndex"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Interfaces",
          description:
            "Interfaces discovered on this device via SNMP. Toggle monitoring per interface.",
        }}
        noItemsMessage={
          "No interfaces discovered yet. Interfaces will appear here after the first successful SNMP poll."
        }
        filters={[]}
        formFields={[
          {
            field: {
              isMonitored: true,
            },
            title: "Monitor this Interface",
            description:
              "When enabled, this interface is polled and its metrics are collected.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        selectMoreFields={{
          isAdministrativelyUp: true,
          outRateMbps: true,
        }}
        columns={[
          {
            field: {
              interfaceIndex: true,
            },
            title: "Index",
            type: FieldType.Number,
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              alias: true,
            },
            title: "Alias",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              isOperationallyUp: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: NetworkInterface): ReactElement => {
              return getInterfaceStatusElement(item);
            },
          },
          {
            field: {
              speedInMbps: true,
            },
            title: "Speed (Mbps)",
            type: FieldType.Number,
            hideOnMobile: true,
          },
          {
            field: {
              inRateMbps: true,
            },
            title: "In / Out (Mbps)",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkInterface): ReactElement => {
              const inRate: number | undefined =
                (item.inRateMbps as number | undefined) ?? undefined;
              const outRate: number | undefined =
                (item.outRateMbps as number | undefined) ?? undefined;
              return (
                <span className="text-sm text-gray-700">
                  {inRate !== undefined ? inRate : "—"}
                  <span className="text-gray-400"> / </span>
                  {outRate !== undefined ? outRate : "—"}
                </span>
              );
            },
          },
          {
            field: {
              utilizationPercent: true,
            },
            title: "Utilization",
            type: FieldType.Percent,
            hideOnMobile: true,
          },
          {
            field: {
              errorsPerSecond: true,
            },
            title: "Errors / sec",
            type: FieldType.Number,
            hideOnMobile: true,
          },
          {
            field: {
              isMonitored: true,
            },
            title: "Monitored",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkDeviceView;
