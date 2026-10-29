import Card from "Common/UI/Components/Card/Card";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { AssetFactSource } from "Common/Utils/Inventory/AssetFactSource";
import {
  InventoryAssetDetail,
  InventoryAssetDetails,
  InventoryAssetField,
  InventoryAssetSource,
  getInventoryAssetDetails,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import AssetFactValue from "./AssetFactValue";
import {
  getAssetFactExactTime,
  getFoundByLine,
  getOtherMachineLine,
  getSharedAssetFactSource,
  getSharedSourceLine,
  isSameAssetFactSource,
  isSightingSaidBySharedSource,
} from "./AssetFactSourceText";
import {
  INVENTORY_ASSET_FIELD_LABELS,
  INVENTORY_ASSET_HELP,
  INVENTORY_ASSET_UNKNOWN,
  NETWORK_DEVICE_CONTROLLER_UNKNOWN,
} from "./InventoryAssetLabels";
import { readNetworkDeviceDiscoveredDetails } from "Common/Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import useNetworkDeviceAssetDetails, {
  LinkedNetworkDeviceSource,
  NetworkDeviceAssetDetailsReader,
  getLinkedNetworkDeviceId,
} from "./useNetworkDeviceAssetDetails";
import useNetworkDeviceRefresh, {
  UseNetworkDeviceRefreshResult,
  deviceOfModel,
} from "../NetworkDevice/useNetworkDeviceRefresh";
import NetworkDeviceRefreshStatus from "../NetworkDevice/NetworkDeviceRefreshStatus";
import { REFRESH_TITLE } from "../NetworkDevice/NetworkDeviceRefreshWords";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";

/*
 * Asset details: what a machine is and where it is, in the same terms for
 * every host and network device (OneUptime issue #4569), and where each
 * detail came from and when (issue #5185).
 *
 * Inventory used to show a machine only as the raw attributes it came in on -
 * `host.arch` and `os.type` for a host, an IP address under
 * `net.device.hostname` for a switch - so two machines read in two
 * vocabularies, and a fact nothing had reported was simply not there. This
 * card lists the same facts, in the same order, for both, and says
 * "Unknown" where a fact is missing, so a gap is something a reader sees
 * rather than something they have to notice is absent. One line under the
 * facts says why they are unknown and where to read how each one is filled.
 *
 * And where each came from. Most of a machine's details come from one
 * reading - a host's collector; a network device's (read from the device
 * itself, current to the moment) own SNMP poll, or, for a device its poll
 * has not read, the discovery scan that read its SNMP system group - and
 * that is said ONCE, first below the details, with when
 * (getSharedAssetFactSource). Every detail from anywhere else says so under
 * its value: a router's ARP table, the device's probe, a reverse-DNS lookup,
 * a value saved on it, a role someone assigned; and, where a value someone
 * saved disagrees with what discovery read, what discovery read, in amber.
 *
 * The raw attributes stay on the Attributes card below, for everything this
 * card does not name.
 */

export interface ComponentProps {
  item: InventoryAssetSource & LinkedNetworkDeviceSource;
  /*
   * A network device was read again (Refresh): the page reads the item
   * again too, which the server copied from the device as that reading
   * landed.
   */
  onRefreshed?: (() => void) | undefined;
}

const InventoryAssetDetailsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const deviceRead: NetworkDeviceAssetDetailsReader =
    useNetworkDeviceAssetDetails(props.item);
  const itemDetails: InventoryAssetDetails | undefined =
    getInventoryAssetDetails(props.item);

  /*
   * Refresh: a network device read again now, by its probe and its Meraki
   * connection - offered to whoever may edit network devices, for a device
   * something reads on its own (useNetworkDeviceRefresh).
   */
  const refresh: UseNetworkDeviceRefreshResult = useNetworkDeviceRefresh({
    deviceId: getLinkedNetworkDeviceId(props.item),
    device: deviceOfModel(deviceRead.device),
    reload: deviceRead.reload,
    onRead: props.onRefreshed,
  });

  /*
   * A network device read from its own record when that worked; the item's
   * facts otherwise, and while it loads.
   */
  const details: InventoryAssetDetails | undefined = itemDetails
    ? deviceRead.details || itemDetails
    : undefined;

  if (!details) {
    return <></>;
  }

  const help: (typeof INVENTORY_ASSET_HELP)[keyof typeof INVENTORY_ASSET_HELP] =
    INVENTORY_ASSET_HELP[details.kind];
  const unknownCount: number = details.unknownFields.length;
  /*
   * A device the Meraki dashboard describes was asked too: the unknown line
   * names it beside the poll and the scans.
   */
  const unknownLine: { one: string; other: string } =
    deviceRead.details &&
    readNetworkDeviceDiscoveredDetails(deviceRead.device?.discoveredDetails)
      .controller
      ? NETWORK_DEVICE_CONTROLLER_UNKNOWN
      : help.unknown;

  // The reading most details came from, said once below them.
  const sharedSource: AssetFactSource | undefined = getSharedAssetFactSource(
    details.details.map(
      (detail: InventoryAssetDetail): AssetFactSource | undefined => {
        return detail.value ? detail.source : undefined;
      },
    ),
  );
  const sharedSourceLine: string | undefined = getSharedSourceLine(
    sharedSource,
    translator,
  );
  /*
   * "Last found at its address by discovery scan ..." - unless the line
   * above already names that scan's reading: a scan that read the device
   * found it.
   */
  const foundBy: InventoryAssetDetails["foundBy"] =
    details.foundBy &&
    !isSightingSaidBySharedSource(details.foundBy, sharedSource)
      ? details.foundBy
      : undefined;

  const buttons: Array<ReactElement> = refresh.canRefresh
    ? [
        <Button
          key="refresh"
          title={REFRESH_TITLE}
          icon={IconProp.Refresh}
          buttonStyle={ButtonStyleType.NORMAL}
          isLoading={refresh.isRefreshing}
          disabled={refresh.isRefreshing}
          onClick={refresh.refresh}
          dataTestId="inventory-asset-details-refresh"
        />,
      ]
    : [];

  return (
    <Card
      title="Asset Details"
      description="What this machine is and where it is, in the same terms for every host and network device. Unknown means nothing has reported it yet."
      buttons={buttons}
    >
      <div data-testid="inventory-asset-details">
        <NetworkDeviceRefreshStatus
          refresh={refresh}
          className="mb-4"
          testId="inventory-asset-details-refresh-status"
        />
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {details.details.map((detail: InventoryAssetDetail): ReactElement => {
            const englishLabel: string =
              INVENTORY_ASSET_FIELD_LABELS[detail.field];
            const label: string =
              translator.translateText(englishLabel) || englishLabel;

            /*
             * A sysDescr runs to a paragraph ("Cisco IOS Software [Gibraltar],
             * Catalyst L3 Switch Software (...), Version 16.12.4, ..."), so it
             * gets the whole row rather than a third of one.
             */
            const isLong: boolean =
              detail.field === InventoryAssetField.SystemDescription;

            return (
              <div
                key={detail.field}
                className={`min-w-0${isLong ? " sm:col-span-2 lg:col-span-3" : ""}`}
                data-testid={`inventory-asset-${detail.field}`}
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {label}
                </dt>
                <dd className="mt-1 min-w-0">
                  {detail.value ? (
                    <AssetFactValue
                      value={detail.value}
                      copyLabel={label}
                      source={detail.source}
                      // Said once, below the details.
                      hideSource={isSameAssetFactSource(
                        detail.source,
                        sharedSource,
                      )}
                      discoveredDifferent={detail.discoveredDifferent}
                      testId={`inventory-asset-${detail.field}-value`}
                    />
                  ) : (
                    <span className="text-sm">
                      <PlaceholderText text={INVENTORY_ASSET_UNKNOWN} />
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {/*
         * Below the details, in the order a reader asks: where they came
         * from, what is still unknown and how it gets filled, when a scan
         * last found the machine, and - in amber - a scan that found another
         * one at its address.
         */}
        {sharedSourceLine ||
        unknownCount > 0 ||
        foundBy ||
        details.otherMachine ? (
          <div className="mt-5 space-y-2 border-t border-gray-100 pt-4 text-sm text-gray-500">
            {sharedSourceLine ? (
              <p
                title={getAssetFactExactTime(sharedSource?.readAt)}
                data-testid="inventory-asset-details-source"
              >
                {sharedSourceLine}
              </p>
            ) : null}

            {unknownCount > 0 ? (
              <p data-testid="inventory-asset-details-unknown">
                {translator.translatePlural(unknownLine, unknownCount)}{" "}
                <a
                  className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                  href={help.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {translator.translateText(help.linkText)}
                </a>
              </p>
            ) : null}

            {foundBy ? (
              <p
                title={getAssetFactExactTime(foundBy.readAt)}
                data-testid="inventory-asset-details-found-by"
              >
                {getFoundByLine(foundBy, translator)}
              </p>
            ) : null}

            {details.otherMachine ? (
              <div
                className="flex items-start gap-x-1.5 text-amber-700"
                title={getAssetFactExactTime(details.otherMachine.readAt)}
                data-testid="inventory-asset-details-other-machine"
              >
                <Icon
                  icon={IconProp.ExclaimationCircle}
                  size={SizeProp.Small}
                  className="mt-0.5 h-4 w-4 flex-none"
                />
                <span className="min-w-0 break-words">
                  {getOtherMachineLine(details.otherMachine, translator)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

export default InventoryAssetDetailsCard;
