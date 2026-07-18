import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * Read-only inventory card for the device Overview: vendor, model, serial,
 * firmware/software versions, SNMP system fields, uptime, and freshness.
 * Every field is probe-managed (enriched from SNMP walks), so the card is
 * deliberately not editable — edits happen on the next poll, not here.
 */
const DeviceInventoryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetUptimeElementFunction = (item: NetworkDevice) => ReactElement;

  const getUptimeElement: GetUptimeElementFunction = (
    item: NetworkDevice,
  ): ReactElement => {
    if (!item.lastRebootedAt) {
      return <span>-</span>;
    }

    const lastRebootedAt: Date = OneUptimeDate.fromString(item.lastRebootedAt);

    const humanizedUptime: string =
      OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
        lastRebootedAt,
        OneUptimeDate.getCurrentDate(),
      );

    return (
      <Tooltip
        text={`Booted at ${OneUptimeDate.getDateAsFormattedString(
          lastRebootedAt,
        )}`}
      >
        <span className="text-sm text-gray-900">{humanizedUptime}</span>
      </Tooltip>
    );
  };

  return (
    <CardModelDetail<NetworkDevice>
      name="Device Inventory"
      cardProps={{
        title: "Inventory",
        description:
          "Hardware, software, and location details discovered from this device via SNMP.",
      }}
      isEditable={false}
      modelDetailProps={{
        modelType: NetworkDevice,
        id: "network-device-inventory",
        modelId: props.modelId,
        fields: [
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.vendor);
            },
          },
          {
            field: {
              deviceModel: true,
            },
            title: "Model",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.deviceModel);
            },
          },
          {
            field: {
              serialNumber: true,
            },
            title: "Serial Number",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.serialNumber);
            },
          },
          {
            field: {
              firmwareVersion: true,
            },
            title: "Firmware Version",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.firmwareVersion);
            },
          },
          {
            field: {
              softwareVersion: true,
            },
            title: "Software Version",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.softwareVersion);
            },
          },
          {
            field: {
              sysObjectId: true,
            },
            title: "sysObjectID",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.sysObjectId);
            },
          },
          {
            field: {
              sysLocation: true,
            },
            title: "Location (sysLocation)",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.sysLocation);
            },
          },
          {
            field: {
              sysContact: true,
            },
            title: "Contact (sysContact)",
            fieldType: FieldType.Text,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.sysContact);
            },
          },
          {
            field: {
              lastRebootedAt: true,
            },
            title: "Uptime",
            fieldType: FieldType.Element,
            getElement: getUptimeElement,
            showIf: (item: NetworkDevice): boolean => {
              return Boolean(item.lastRebootedAt);
            },
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
        ],
      }}
    />
  );
};

export default DeviceInventoryCard;
