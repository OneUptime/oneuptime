import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import AssetFactValue from "../Inventory/AssetFactValue";
import {
  getAssetFactExactTime,
  getFoundByLine,
  getOtherMachineLine,
  getSharedAssetFactSource,
  getSharedSourceLine,
  isSameAssetFactSource,
  isSightingSaidBySharedSource,
  isUndisputedSavedValue,
} from "../Inventory/AssetFactSourceText";
import { NETWORK_DEVICE_ASSET_FACT_COLUMNS } from "../Inventory/NetworkDeviceAssetSelect";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  NetworkDeviceDiscoverySighting,
  NetworkDeviceOtherMachineSighting,
} from "Common/Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactSource,
  AssetFactSourceKind,
} from "Common/Utils/Inventory/AssetFactSource";
import {
  NetworkDeviceAssetFactKey,
  NetworkDeviceFactDetail,
  NetworkDeviceFactDetails,
  NetworkDeviceSystemKey,
  getNetworkDeviceFactDetails,
} from "Common/Utils/NetworkDevice/NetworkDeviceAssetFacts";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import FieldType from "Common/UI/Components/Types/FieldType";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  modelId: ObjectID;
}

const UPTIME_TITLE: string = "Uptime";

/*
 * A device nothing has read yet - added a moment ago, or never answered: the
 * card says how it fills in, rather than standing empty under its title.
 */
export const NOTHING_READ_YET: string = translationKey(
  "Nothing has been read from this device yet. Its details fill in after its first SNMP walk, or the next discovery scan of its address.",
);

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
 * address read about it instead. The device's Inventory item shows the same
 * values, so the two pages never disagree about what the box is.
 *
 * Where each value came from is said the way Inventory's Asset Details card
 * says it: the reading most of them came from once, the rest under their
 * values. On the device's own page its own poll is what every value is by
 * default, so it goes unsaid; a discovery scan is said once, in the
 * Discovery row at the end. A value saved on the device says so only when
 * discovery reads it differently.
 */

// The facts this card shows: what its shared source is counted over.
function getCardFactDetails(
  details: NetworkDeviceFactDetails,
): Array<NetworkDeviceFactDetail> {
  return [
    details.facts.manufacturer,
    details.facts.model,
    details.facts.serialNumber,
    details.facts.firmwareVersion,
    details.facts.operatingSystem,
    details.facts.osVersion,
    details.system.sysObjectId,
    details.system.sysLocation,
    details.system.sysContact,
  ];
}

/*
 * The reading most of the card's values came from (getSharedAssetFactSource):
 * not said under any of them.
 */
function getDeviceInventorySharedSource(
  item: NetworkDevice,
): AssetFactSource | undefined {
  return getSharedAssetFactSource(
    getCardFactDetails(getNetworkDeviceFactDetails(item)).map(
      (detail: NetworkDeviceFactDetail): AssetFactSource | undefined => {
        return detail.value ? detail.source : undefined;
      },
    ),
  );
}

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

  // What the Discovery row says - see the row.
  type DiscoveryLines = {
    scanLine?: string | undefined;
    scanReadAt?: string | undefined;
    foundBy?: NetworkDeviceDiscoverySighting | undefined;
    otherMachine?: NetworkDeviceOtherMachineSighting | undefined;
  };

  const getDiscoveryLines: (item: NetworkDevice) => DiscoveryLines = (
    item: NetworkDevice,
  ): DiscoveryLines => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(item);
    const shared: AssetFactSource | undefined =
      getDeviceInventorySharedSource(item);
    // The device's own poll goes unsaid on its own page.
    const scanSource: AssetFactSource | undefined =
      shared?.kind === AssetFactSourceKind.Discovered ? shared : undefined;

    return {
      scanLine: getSharedSourceLine(scanSource, translator),
      scanReadAt: scanSource?.readAt,
      foundBy:
        details.foundBy &&
        !isSightingSaidBySharedSource(details.foundBy, scanSource)
          ? details.foundBy
          : undefined,
      otherMachine: details.otherMachine,
    };
  };

  // Whether any row of the card has something to show for the device.
  const hasAnythingToShow: (item: NetworkDevice) => boolean = (
    item: NetworkDevice,
  ): boolean => {
    const discovery: DiscoveryLines = getDiscoveryLines(item);

    return Boolean(
      getCardFactDetails(getNetworkDeviceFactDetails(item)).some(
        (detail: NetworkDeviceFactDetail): boolean => {
          return Boolean(detail.value);
        },
      ) ||
        item.lastRebootedAt ||
        item.lastSeenAt ||
        discovery.scanLine ||
        discovery.foundBy ||
        discovery.otherMachine,
    );
  };

  type DetailOfFunction = (item: NetworkDevice) => NetworkDeviceFactDetail;

  // A fact's value with its source, or a dash when it has none.
  const detailElement: (
    detail: NetworkDeviceFactDetail,
    testId: string,
    sharedSource: AssetFactSource | undefined,
  ) => ReactElement = (
    detail: NetworkDeviceFactDetail,
    testId: string,
    sharedSource: AssetFactSource | undefined,
  ): ReactElement => {
    if (!detail.value) {
      return <span>-</span>;
    }

    return (
      <AssetFactValue
        value={detail.value}
        source={detail.source}
        /*
         * The reading most values came from is said once (see the header),
         * and a saved value only when discovery reads it differently.
         */
        hideSource={
          isSameAssetFactSource(detail.source, sharedSource) ||
          isUndisputedSavedValue(
            detail.source,
            Boolean(detail.discoveredDifferent),
          )
        }
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

  const factField: (detailOf: DetailOfFunction, testId: string) => FactField = (
    detailOf: DetailOfFunction,
    testId: string,
  ): FactField => {
    return {
      getElement: (item: NetworkDevice): ReactElement => {
        return detailElement(
          detailOf(item),
          testId,
          getDeviceInventorySharedSource(item),
        );
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
           * What discovery says about the device (issue #5185): the scan the
           * values above came from, when one did - said once, here, rather
           * than under each of them; the scan that last found it at its
           * address, and when, so "where does this record come from, and is
           * it still true" has an answer on the page; and, in amber, a scan
           * that found ANOTHER machine answering at the address, with what
           * that machine said it was.
           */
          {
            field: {
              discoveredDetails: true,
            },
            title: "Discovery",
            fieldType: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              const discovery: DiscoveryLines = getDiscoveryLines(item);

              return (
                <div className="space-y-1 text-sm">
                  {discovery.scanLine ? (
                    <p
                      className="text-gray-900"
                      title={getAssetFactExactTime(discovery.scanReadAt)}
                      data-testid="device-inventory-source"
                    >
                      {discovery.scanLine}
                    </p>
                  ) : null}
                  {discovery.foundBy ? (
                    <p
                      className="text-gray-900"
                      title={getAssetFactExactTime(discovery.foundBy.readAt)}
                      data-testid="device-inventory-found-by"
                    >
                      {getFoundByLine(discovery.foundBy, translator)}
                    </p>
                  ) : null}
                  {discovery.otherMachine ? (
                    <div
                      className="flex items-start gap-x-1.5 text-amber-700"
                      title={getAssetFactExactTime(
                        discovery.otherMachine.readAt,
                      )}
                      data-testid="device-inventory-other-machine"
                    >
                      <Icon
                        icon={IconProp.ExclaimationCircle}
                        size={SizeProp.Small}
                        className="mt-0.5 h-4 w-4 flex-none"
                      />
                      <span className="min-w-0 break-words">
                        {getOtherMachineLine(
                          discovery.otherMachine,
                          translator,
                        )}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            },
            showIf: (item: NetworkDevice): boolean => {
              const discovery: DiscoveryLines = getDiscoveryLines(item);

              return Boolean(
                discovery.scanLine ||
                  discovery.foundBy ||
                  discovery.otherMachine,
              );
            },
          },
          /*
           * Nothing read yet: one line on how the card fills in, in the
           * Discovery row's place, rather than an empty card.
           */
          {
            field: {
              lastSnmpSeenAt: true,
            },
            title: "Discovery",
            fieldType: FieldType.Element,
            getElement: (): ReactElement => {
              return (
                <p
                  className="text-sm text-gray-500"
                  data-testid="device-inventory-nothing-read"
                >
                  {translator.translateText(NOTHING_READ_YET) ||
                    NOTHING_READ_YET}
                </p>
              );
            },
            showIf: (item: NetworkDevice): boolean => {
              return !hasAnythingToShow(item);
            },
          },
        ],
      }}
    />
  );
};

export default DeviceInventoryCard;
