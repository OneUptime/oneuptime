import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const UPTIME_TITLE: string = "Uptime";

export interface InventoryUptimeValueProps {
  lastRebootedAt: Date;
}

/*
 * The Uptime field's value: how long since the device last restarted, with
 * the boot time on hover and an (i) that says where the number comes from.
 *
 * The (i) sits beside the value rather than the label because a model
 * detail field's title is a plain string with no tooltip slot. It is the
 * hero's Hardware Uptime text on purpose: both read lastRebootedAt against
 * the clock, so they are the same number and must be explained the same
 * way - including that an SNMP agent restart or a counter wrap makes it
 * read short.
 */
export const InventoryUptimeValue: FunctionComponent<
  InventoryUptimeValueProps
> = (props: InventoryUptimeValueProps): ReactElement => {
  const humanizedUptime: string =
    OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
      props.lastRebootedAt,
      OneUptimeDate.getCurrentDate(),
    );

  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip
        text={`Booted at ${OneUptimeDate.getDateAsFormattedString(
          props.lastRebootedAt,
        )}`}
      >
        <span className="text-sm text-gray-900">{humanizedUptime}</span>
      </Tooltip>
      <InfoTooltip
        label={UPTIME_TITLE}
        text={NETWORK_DEVICE_METRIC_DESCRIPTIONS.hardwareUptime}
      />
    </span>
  );
};

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

    return (
      <InventoryUptimeValue
        lastRebootedAt={OneUptimeDate.fromString(item.lastRebootedAt)}
      />
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
            title: UPTIME_TITLE,
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
