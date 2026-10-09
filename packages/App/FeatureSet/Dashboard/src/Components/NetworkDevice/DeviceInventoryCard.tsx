import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  NetworkDeviceAssetFacts,
  getNetworkDeviceAssetFacts,
} from "Common/Utils/NetworkDevice/NetworkDeviceAssetFacts";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

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
  const translator: Translator = useTranslator();
  const humanizedUptime: string =
    OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
      props.lastRebootedAt,
      OneUptimeDate.getCurrentDate(),
    );

  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip
        text={translator.translateTemplate("Booted at {{date}}", {
          date: OneUptimeDate.getDateAsFormattedString(props.lastRebootedAt),
        })}
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
 *
 * Vendor, model, operating system and versions are the device's asset facts
 * (Common/Utils/NetworkDevice/NetworkDeviceAssetFacts, issue #4569): what
 * ENTITY-MIB reported, else what the sysDescr names - a Meraki MX implements
 * no ENTITY-MIB, and its sysDescr is "Meraki MX85". The device's Inventory
 * item shows the same values, so the two pages never disagree about what
 * the box is.
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

  type FactElementFunction = (
    fact: keyof NetworkDeviceAssetFacts,
  ) => (item: NetworkDevice) => ReactElement;

  const factElement: FactElementFunction = (
    fact: keyof NetworkDeviceAssetFacts,
  ): ((item: NetworkDevice) => ReactElement) => {
    return (item: NetworkDevice): ReactElement => {
      return <span>{getNetworkDeviceAssetFacts(item)[fact] || "-"}</span>;
    };
  };

  type HasFactFunction = (
    fact: keyof NetworkDeviceAssetFacts,
  ) => (item: NetworkDevice) => boolean;

  const hasFact: HasFactFunction = (
    fact: keyof NetworkDeviceAssetFacts,
  ): ((item: NetworkDevice) => boolean) => {
    return (item: NetworkDevice): boolean => {
      return Boolean(getNetworkDeviceAssetFacts(item)[fact]);
    };
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
        // What the asset facts read beyond the columns shown.
        selectMoreFields: {
          sysDescr: true,
          sysObjectId: true,
        },
        fields: [
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            fieldType: FieldType.Element,
            getElement: factElement("manufacturer"),
            showIf: hasFact("manufacturer"),
          },
          {
            field: {
              deviceModel: true,
            },
            title: "Model",
            fieldType: FieldType.Element,
            getElement: factElement("model"),
            showIf: hasFact("model"),
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
            fieldType: FieldType.Element,
            getElement: factElement("firmwareVersion"),
            showIf: hasFact("firmwareVersion"),
          },
          {
            field: {
              sysDescr: true,
            },
            title: "Operating System",
            fieldType: FieldType.Element,
            getElement: factElement("operatingSystem"),
            showIf: hasFact("operatingSystem"),
          },
          {
            field: {
              softwareVersion: true,
            },
            title: "Software Version",
            fieldType: FieldType.Element,
            getElement: factElement("osVersion"),
            showIf: hasFact("osVersion"),
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
