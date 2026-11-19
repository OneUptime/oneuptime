import DeviceNameLink from "../DeviceNameLink";
import {
  DiscoveredHostSharedAddress,
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/Types/Translator";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  AmbiguousAddressReason,
  SeenDeviceReason,
} from "Common/Utils/NetworkDevice/DeviceAddressScope";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * WHY A HOST AT A SHARED ADDRESS READS ALREADY ADDED (OneUptime issue
 * #9905), in Review Results.
 *
 * Two sites can each have a 10.0.0.5. A scan's host is the device the
 * scan's probe sees at its address (issue #9677), and when more than one
 * device has the address the read says which, and how
 * (DiscoveredNetworkDevice.sharedAddress): the probe polls it, or it is the
 * only one in the probe's sites. Or it says why the probe cannot tell them
 * apart, and which they are: then the host reads Already added with no
 * device to open and no box to tick, and this line is the only place that
 * says so, with the way forward - give the right device its monitor from
 * its own page - and links to the devices.
 *
 * A host at an address one device has, or a new host, says nothing more:
 * its row is already clear.
 */

export const SHARED_ADDRESS_COPY: {
  polledBy: string;
  polledByUnnamed: string;
  onlyInSites: string;
  onlyInSitesUnnamed: string;
  pollsSeveral: string;
  severalInSites: string;
  reachUnknown: string;
  monitorFromItsPage: string;
} = {
  polledBy: translationKey(
    "More than one device has this address. This host is {{device}}, the one the scan's probe polls.",
  ),
  polledByUnnamed: translationKey(
    "More than one device has this address. This host is the one the scan's probe polls.",
  ),
  onlyInSites: translationKey(
    "More than one device has this address. This host is {{device}}, the only one in the probe's sites.",
  ),
  onlyInSitesUnnamed: translationKey(
    "More than one device has this address. This host is the only one of them in the probe's sites.",
  ),
  pollsSeveral: translationKey(
    "More than one device has this address, and the scan's probe polls more than one of them, so it cannot tell which it found.",
  ),
  severalInSites: translationKey(
    "More than one device has this address in the sites the scan's probe looks into, so it cannot tell which it found.",
  ),
  reachUnknown: translationKey(
    "More than one device has this address, and the scan's probe polls none and is no site's default probe, so it cannot tell which it found.",
  ),
  monitorFromItsPage: translationKey(
    "Give the right device its monitor from its own page.",
  ),
};

// What the line says about a host, worked out without drawing it.
export type SharedAddressLine =
  | {
      kind: "seen";
      template: string;
      // The device the host is, when its name could be read.
      deviceId?: string | undefined;
    }
  | {
      kind: "ambiguous";
      template: string;
      // The devices the probe cannot tell apart, by id, in the read's order.
      deviceIds: Array<string>;
    };

function toIdKey(id: unknown): string {
  return typeof id === "string" ? id.trim().toLowerCase() : "";
}

/*
 * The line for a host, or null when it has nothing to say: the host is no
 * device, or the address is one device's. `deviceNames` are the names the
 * reader may read, by id (lower case): a device whose name is not there is
 * not named.
 */
export function getSharedAddressLine(data: {
  host: DiscoveredNetworkDevice | null | undefined;
  deviceNames: ReadonlyMap<string, string>;
}): SharedAddressLine | null {
  const host: DiscoveredNetworkDevice | null | undefined = data.host;
  const shared: DiscoveredHostSharedAddress | undefined = host?.sharedAddress;

  if (!host?.isAlreadyRegistered || !shared) {
    return null;
  }

  if (shared.ambiguousReason) {
    const template: string | undefined = {
      [AmbiguousAddressReason.PollSeveral]: SHARED_ADDRESS_COPY.pollsSeveral,
      [AmbiguousAddressReason.SeveralInTheirSites]:
        SHARED_ADDRESS_COPY.severalInSites,
      [AmbiguousAddressReason.ReachUnknown]: SHARED_ADDRESS_COPY.reachUnknown,
    }[shared.ambiguousReason];

    if (!template) {
      return null;
    }

    const deviceIds: Array<string> = [];

    for (const id of shared.ambiguousDeviceIds || []) {
      const key: string = toIdKey(id);

      if (key && !deviceIds.includes(key)) {
        deviceIds.push(key);
      }
    }

    return { kind: "ambiguous", template: template, deviceIds: deviceIds };
  }

  const deviceId: string = toIdKey(host.registeredDeviceId);

  if (!deviceId || !shared.seenReason) {
    return null;
  }

  const isNamed: boolean = Boolean(data.deviceNames.get(deviceId));

  if (shared.seenReason === SeenDeviceReason.PolledByTheProbes) {
    return isNamed
      ? { kind: "seen", template: SHARED_ADDRESS_COPY.polledBy, deviceId }
      : { kind: "seen", template: SHARED_ADDRESS_COPY.polledByUnnamed };
  }

  if (shared.seenReason === SeenDeviceReason.OnlyOneInTheirSites) {
    return isNamed
      ? { kind: "seen", template: SHARED_ADDRESS_COPY.onlyInSites, deviceId }
      : { kind: "seen", template: SHARED_ADDRESS_COPY.onlyInSitesUnnamed };
  }

  // The only device at the address cannot share it with another.
  return null;
}

/*
 * The devices a page of hosts names in their lines, each once, in order:
 * the ones whose names are read to link them.
 */
export function getSharedAddressDeviceIds(
  hosts: ReadonlyArray<DiscoveredNetworkDevice>,
): Array<string> {
  const deviceIds: Set<string> = new Set<string>();

  for (const host of hosts) {
    if (!host?.isAlreadyRegistered || !host.sharedAddress) {
      continue;
    }

    const ids: Array<unknown> = host.sharedAddress.ambiguousReason
      ? host.sharedAddress.ambiguousDeviceIds || []
      : [host.registeredDeviceId];

    for (const id of ids) {
      const key: string = toIdKey(id);

      if (key && ObjectID.isValidUUID(key)) {
        deviceIds.add(key);
      }
    }
  }

  return Array.from(deviceIds).sort();
}

export interface DiscoveredHostSharedAddressLineProps {
  host: DiscoveredNetworkDevice;
  // The names the reader may read, by device id (lower case).
  deviceNames: ReadonlyMap<string, string>;
}

/*
 * The muted line under a host at a shared address: which device it is and
 * why, or why none can be named, with the devices to open.
 */
const DiscoveredHostSharedAddressLine: FunctionComponent<
  DiscoveredHostSharedAddressLineProps
> = (props: DiscoveredHostSharedAddressLineProps): ReactElement => {
  const translator: Translator = useTranslator();
  const line: SharedAddressLine | null = getSharedAddressLine({
    host: props.host,
    deviceNames: props.deviceNames,
  });

  if (!line) {
    return <></>;
  }

  const address: string = props.host.ipAddress;

  if (line.kind === "seen") {
    return (
      <div
        className="mt-1 flex min-w-0 items-start gap-1.5 text-xs text-gray-500"
        data-testid={`discovered-host-shared-address-${address}`}
      >
        <Icon
          icon={IconProp.Info}
          className="mt-px h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
        <span>
          <TranslatedSentence
            template={line.template}
            slots={
              line.deviceId
                ? {
                    device: (
                      <DeviceNameLink
                        deviceId={line.deviceId}
                        name={props.deviceNames.get(line.deviceId) || ""}
                        dataTestId={`discovered-host-shared-address-device-${address}`}
                      />
                    ),
                  }
                : {}
            }
          />
        </span>
      </div>
    );
  }

  const named: Array<string> = line.deviceIds.filter((id: string): boolean => {
    return Boolean(props.deviceNames.get(id));
  });

  return (
    <div
      className="mt-1 flex min-w-0 items-start gap-1.5 text-xs text-gray-500"
      data-testid={`discovered-host-shared-address-${address}`}
    >
      <Icon
        icon={IconProp.Info}
        className="mt-px h-3.5 w-3.5 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0">
        <p>
          {translator.translateText(line.template)}{" "}
          {translator.translateText(SHARED_ADDRESS_COPY.monitorFromItsPage)}
        </p>
        {named.length > 0 && (
          <p
            className="mt-0.5 truncate"
            data-testid={`discovered-host-shared-address-devices-${address}`}
          >
            {named.map((id: string, index: number): ReactElement => {
              return (
                <Fragment key={id}>
                  {index > 0 && <InlineSeparator />}
                  <DeviceNameLink
                    deviceId={id}
                    name={props.deviceNames.get(id) || ""}
                    dataTestId={`discovered-host-shared-address-device-${address}-${index}`}
                  />
                </Fragment>
              );
            })}
          </p>
        )}
      </div>
    </div>
  );
};

export default DiscoveredHostSharedAddressLine;
