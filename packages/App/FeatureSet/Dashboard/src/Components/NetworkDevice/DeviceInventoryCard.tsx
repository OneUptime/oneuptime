import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import AssetFactValue from "../Inventory/AssetFactValue";
import {
  getFoundByLine,
  getOtherMachineLine,
  isNativeAssetFactSource,
} from "../Inventory/AssetFactSourceText";
import { NETWORK_DEVICE_ASSET_FACT_COLUMNS } from "../Inventory/NetworkDeviceAssetSelect";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  NetworkDeviceDiscoverySighting,
  NetworkDeviceOtherMachineSighting,
} from "Common/Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  NetworkDeviceAssetFactKey,
  NetworkDeviceFactDetail,
  NetworkDeviceSystemKey,
  getNetworkDeviceFactDetails,
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
 * firmware/software versions, SNMP system fields, uptime, and freshness -
 * each with where it came from (OneUptime issue #5185). The card is
 * deliberately not editable: its values are read, by the device's own poll
 * or by discovery, not typed here.
 *
 * Vendor, model, operating system and versions are the device's asset facts
 * (Common/Utils/NetworkDevice/NetworkDeviceAssetFacts, issue #4569): what
 * ENTITY-MIB reported, else what the sysDescr names - a Meraki MX implements
 * no ENTITY-MIB, and its sysDescr is "Meraki MX85". A device its probe only
 * pings has none of those columns, and takes what the discovery scan of its
 * address read about it instead, said as such. The device's Inventory item
 * shows the same values, so the two pages never disagree about what the box
 * is.
 */
const DeviceInventoryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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

  type DetailOfFunction = (item: NetworkDevice) => NetworkDeviceFactDetail;

  // A fact's value with its source, or a dash when it has none.
  const detailElement: (
    detail: NetworkDeviceFactDetail,
    testId: string,
  ) => ReactElement = (
    detail: NetworkDeviceFactDetail,
    testId: string,
  ): ReactElement => {
    if (!detail.value) {
      return <span>-</span>;
    }

    return (
      <AssetFactValue
        value={detail.value}
        source={detail.source}
        /*
         * What this device's own SNMP poll read is what the card is for (its
         * description says so); only a value from anywhere else says where
         * it came from.
         */
        hideSource={isNativeAssetFactSource(detail.source)}
        discoveredDifferent={detail.discoveredDifferent}
        testId={testId}
      />
    );
  };

  const fact: (key: NetworkDeviceAssetFactKey) => DetailOfFunction = (
    key: NetworkDeviceAssetFactKey,
  ): DetailOfFunction => {
    return (item: NetworkDevice): NetworkDeviceFactDetail => {
      return getNetworkDeviceFactDetails(item).facts[key];
    };
  };

  const system: (key: NetworkDeviceSystemKey) => DetailOfFunction = (
    key: NetworkDeviceSystemKey,
  ): DetailOfFunction => {
    return (item: NetworkDevice): NetworkDeviceFactDetail => {
      return getNetworkDeviceFactDetails(item).system[key];
    };
  };

  // The field of one fact: its value and source, shown only when known.
  type FactField = {
    getElement: (item: NetworkDevice) => ReactElement;
    showIf: (item: NetworkDevice) => boolean;
  };

  const factField: (
    detailOf: DetailOfFunction,
    testId: string,
  ) => FactField = (detailOf: DetailOfFunction, testId: string): FactField => {
    return {
      getElement: (item: NetworkDevice): ReactElement => {
        return detailElement(detailOf(item), testId);
      },
      showIf: (item: NetworkDevice): boolean => {
        return Boolean(detailOf(item).value);
      },
    };
  };

  return (
    <CardModelDetail<NetworkDevice>
      name="Device Inventory"
      cardProps={{
        title: "Inventory",
        description:
          "Hardware, software and location details from this device's SNMP poll and from discovery.",
      }}
      isEditable={false}
      modelDetailProps={{
        modelType: NetworkDevice,
        id: "network-device-inventory",
        modelId: props.modelId,
        /*
         * Every column the asset facts read, and what discovery read with
         * when the device's poll last did, so each value says where it came
         * from (NetworkDeviceAssetSelect).
         */
        selectMoreFields: {
          ...NETWORK_DEVICE_ASSET_FACT_COLUMNS,
        },
        fields: [
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            fieldType: FieldType.Element,
            ...factField(fact("manufacturer"), "device-inventory-vendor"),
          },
          {
            field: {
              deviceModel: true,
            },
            title: "Model",
            fieldType: FieldType.Element,
            ...factField(fact("model"), "device-inventory-model"),
          },
          {
            field: {
              serialNumber: true,
            },
            title: "Serial Number",
            fieldType: FieldType.Element,
            ...factField(fact("serialNumber"), "device-inventory-serial"),
          },
          {
            field: {
              firmwareVersion: true,
            },
            title: "Firmware Version",
            fieldType: FieldType.Element,
            ...factField(fact("firmwareVersion"), "device-inventory-firmware"),
          },
          {
            field: {
              sysDescr: true,
            },
            title: "Operating System",
            fieldType: FieldType.Element,
            ...factField(fact("operatingSystem"), "device-inventory-os"),
          },
          {
            field: {
              softwareVersion: true,
            },
            title: "Software Version",
            fieldType: FieldType.Element,
            ...factField(fact("osVersion"), "device-inventory-software"),
          },
          {
            field: {
              sysObjectId: true,
            },
            title: "sysObjectID",
            fieldType: FieldType.Element,
            ...factField(system("sysObjectId"), "device-inventory-sysobjectid"),
          },
          {
            field: {
              sysLocation: true,
            },
            title: "Location (sysLocation)",
            fieldType: FieldType.Element,
            ...factField(system("sysLocation"), "device-inventory-location"),
          },
          {
            field: {
              sysContact: true,
            },
            title: "Contact (sysContact)",
            fieldType: FieldType.Element,
            ...factField(system("sysContact"), "device-inventory-contact"),
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
          /*
           * The device's discovery source (issue #5185): the scan that last
           * found it at its address, and when - so "where does this record
           * come from, and is it still true" has an answer on the page. And,
           * in amber under it, a scan that found ANOTHER machine answering at
           * the address, with what that machine said it was.
           */
          {
            field: {
              discoveredDetails: true,
            },
            title: "Discovery",
            fieldType: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              const foundBy: NetworkDeviceDiscoverySighting | undefined =
                getNetworkDeviceFactDetails(item).foundBy;
              const otherMachine:
                | NetworkDeviceOtherMachineSighting
                | undefined = getNetworkDeviceFactDetails(item).otherMachine;

              return (
                <div className="space-y-1 text-sm">
                  {foundBy ? (
                    <p
                      className="text-gray-900"
                      data-testid="device-inventory-found-by"
                    >
                      {getFoundByLine(foundBy, translator)}
                    </p>
                  ) : null}
                  {otherMachine ? (
                    <p
                      className="text-amber-700"
                      data-testid="device-inventory-other-machine"
                    >
                      {getOtherMachineLine(otherMachine, translator)}
                    </p>
                  ) : null}
                </div>
              );
            },
            showIf: (item: NetworkDevice): boolean => {
              const facts: { foundBy?: unknown; otherMachine?: unknown } =
                getNetworkDeviceFactDetails(item);

              return Boolean(facts.foundBy || facts.otherMachine);
            },
          },
        ],
      }}
    />
  );
};

export default DeviceInventoryCard;
