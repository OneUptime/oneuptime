import {
  NetworkEventSource,
  NetworkEventSourceKind,
} from "./NetworkEventsModel";
import {
  NetworkQuickAction,
  getNetworkQuickActionRoute,
} from "../Network/NetworkQuickActions";
import {
  NETWORK_DEVICE_LINK_PICKER,
  readNetworkDeviceToLink,
} from "../Network/NetworkDeviceLinkPicker";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import IconProp from "Common/Types/Icon/IconProp";
import NetworkDeviceOtherAddressesUtil from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getDialogWhatFailed } from "Common/UI/Utils/DialogWhatFailed";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Who is sending syslog or SNMP traps to a probe without being a device
 * yet (#11407) - with the two ways to make it one. "Add as device" opens
 * Add Device with the address and the probe filled in, and the site when a
 * site's default SNMPv3 credentials signed its traps; "It is one of my
 * devices" adds the address to that device's Other Addresses, and what it
 * sends goes to the device from the next minute on.
 *
 * Nothing it sent is lost meanwhile: it is kept for the project, its events
 * on the Events page with the address in place of a device's name, and the
 * rest - an enterprise trap that is no event - in Logs.
 *
 * Every row here is an address that is not a device yet - the card's title
 * says so once, so no row repeats it. Each says what it sends.
 */

export interface ComponentProps {
  sources: Array<NetworkEventSource>;
  // Called once an address was added to a device, to read the page again.
  onLinked: () => void;
}

// Which of a sender's kinds the words are for.
type SenderWords = "syslog" | "snmpTraps" | "both";

function wordsFor(kinds: Array<NetworkEventSourceKind>): SenderWords {
  const sendsSyslog: boolean = kinds.includes(NetworkEventSourceKind.Syslog);
  const sendsTraps: boolean = kinds.includes(NetworkEventSourceKind.SnmpTraps);

  if (sendsSyslog && sendsTraps) {
    return "both";
  }

  return sendsTraps ? "snmpTraps" : "syslog";
}

// What "It is one of my devices" says, by what the address sends.
const LINK_WORDS: Record<
  SenderWords,
  { title: string; description: string; pick: string; linked: string }
> = {
  syslog: {
    title: translationKey("Which device sends this syslog?"),
    description: translationKey(
      "Syslog from {{address}} will go to the device you pick. The address is added to the device's Other Addresses, where you can remove it again.",
    ),
    pick: translationKey("Pick the device that sends this syslog."),
    linked: translationKey(
      "Syslog from {{address}} goes to {{device}} from the next minute on.",
    ),
  },
  snmpTraps: {
    title: translationKey("Which device sends these SNMP traps?"),
    description: translationKey(
      "SNMP traps from {{address}} will go to the device you pick. The address is added to the device's Other Addresses, where you can remove it again.",
    ),
    pick: translationKey("Pick the device that sends these SNMP traps."),
    linked: translationKey(
      "SNMP traps from {{address}} go to {{device}} from the next minute on.",
    ),
  },
  both: {
    title: translationKey("Which device sends from this address?"),
    description: translationKey(
      "Syslog and SNMP traps from {{address}} will go to the device you pick. The address is added to its Other Addresses, where you can remove it again.",
    ),
    pick: translationKey("Pick the device that sends from this address."),
    linked: translationKey(
      "Syslog and SNMP traps from {{address}} go to {{device}} from the next minute on.",
    ),
  },
};

// The chip each kind is shown with.
const KIND_LABELS: Record<NetworkEventSourceKind, string> = {
  [NetworkEventSourceKind.Syslog]: translationKey("Syslog"),
  [NetworkEventSourceKind.SnmpTraps]: translationKey("SNMP traps"),
};

export const LinkSourceModal: FunctionComponent<{
  address: string;
  // What the address sends; syslog when not said.
  kinds?: Array<NetworkEventSourceKind> | undefined;
  onClose: () => void;
  onLinked: (deviceName: string) => void;
}> = (props: {
  address: string;
  kinds?: Array<NetworkEventSourceKind> | undefined;
  onClose: () => void;
  onLinked: (deviceName: string) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [selected, setSelected] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const words: {
    title: string;
    description: string;
    pick: string;
    linked: string;
  } = LINK_WORDS[wordsFor(props.kinds || [NetworkEventSourceKind.Syslog])];

  const save: () => Promise<void> = async (): Promise<void> => {
    const pickError: string = translator.translateText(words.pick) || "";

    if (!selected) {
      setError(pickError);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      // As it is now: its Other Addresses may have changed since.
      const device: NetworkDevice | null =
        await readNetworkDeviceToLink(selected);

      if (!device || !device.id) {
        setError(pickError);
        setIsSaving(false);
        return;
      }

      await ModelAPI.updateById<NetworkDevice>({
        modelType: NetworkDevice,
        id: device.id,
        data: {
          otherAddresses: NetworkDeviceOtherAddressesUtil.add(
            device.otherAddresses,
            props.address,
          ),
        },
      });

      props.onLinked(device.name || device.hostname || "");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={words.title}
      description={translator.translateTemplate(words.description, {
        address: props.address,
      })}
      onClose={props.onClose}
      submitButtonText="Use this device"
      onSubmit={() => {
        save().catch(() => {
          // handled inside.
        });
      }}
      isLoading={isSaving}
      disableSubmitButton={!selected}
      error={error || undefined}
      /*
       * What failed is the Use this device the person pressed, as its
       * button names it: the title names no action (#7680).
       */
      errorWhatFailed={getDialogWhatFailed(
        translator,
        translator.translateText("Use this device") || "Use this device",
      )}
    >
      <div data-testid="network-event-link-source">
        <EntityDropdown
          {...NETWORK_DEVICE_LINK_PICKER}
          placeholder="Pick a device"
          ariaLabel={translator.translateText("Device")}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            setSelected(value ? String(value) : null);
          }}
          dataTestId="network-event-link-source-device"
        />
      </div>
    </Modal>
  );
};

const NetworkEventSourcesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [linking, setLinking] = useState<NetworkEventSource | null>(null);
  const [notice, setNotice] = useState<string>("");

  if (props.sources.length === 0 && !notice) {
    return <></>;
  }

  // "6 minutes ago", in the reader's language - not moment's English.
  const clock: FeedClock = getFeedClock({ language: translator.language });

  return (
    <div id="network-event-sources">
      <Card
        title="Sending syslog or SNMP traps, not a device yet"
        description="Addresses that sent syslog or SNMP traps to one of your probes in this time range and are not a device in OneUptime. What they sent is kept; make each a device to get its own page."
      >
        <div data-testid="network-event-sources">
          {notice ? (
            <div
              role="status"
              className="mb-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200"
              data-testid="network-event-sources-notice"
            >
              <Icon
                icon={IconProp.CheckCircle}
                className="h-4 w-4 text-emerald-600"
              />
              <span>{notice}</span>
            </div>
          ) : (
            <></>
          )}
          <ul className="divide-y divide-gray-100">
            {props.sources.map((source: NetworkEventSource): ReactElement => {
              const details: Array<string> = [];

              if (source.vendor) {
                details.push(source.vendor);
              }

              const lastSeenAgo: string | undefined = source.lastSeenAt
                ? formatFeedTimeAgo(source.lastSeenAt, clock)
                : undefined;

              if (lastSeenAgo) {
                details.push(
                  wordsFor(source.kinds) === "snmpTraps"
                    ? translator.translateTemplate("last trap {{time}}", {
                        time: lastSeenAgo,
                      })
                    : translator.translateTemplate("last message {{time}}", {
                        time: lastSeenAgo,
                      }),
                );
              }

              const hasOwnName: boolean = Boolean(
                source.hostname && source.hostname !== source.address,
              );

              return (
                <li
                  key={source.address}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid="network-event-source"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                          {source.address}
                        </span>
                        {hasOwnName ? (
                          <span
                            className="min-w-0 text-sm text-gray-600 [overflow-wrap:anywhere]"
                            data-testid="network-event-source-name"
                          >
                            {source.hostname}
                          </span>
                        ) : (
                          <></>
                        )}
                        {source.kinds.map(
                          (kind: NetworkEventSourceKind): ReactElement => {
                            return (
                              <span
                                key={kind}
                                className="flex-shrink-0 whitespace-nowrap rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200"
                                data-testid="network-event-source-kind"
                              >
                                {translator.translateText(KIND_LABELS[kind])}
                              </span>
                            );
                          },
                        )}
                      </div>
                      {details.length > 0 ? (
                        <div
                          className="mt-0.5 text-xs text-gray-500"
                          title={
                            source.lastSeenAt
                              ? formatFeedFullTime(source.lastSeenAt, clock)
                              : undefined
                          }
                        >
                          {details.join(" · ")}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap gap-2 sm:justify-end">
                    <Button
                      title="Add as device"
                      icon={IconProp.Add}
                      buttonSize={ButtonSize.Small}
                      buttonStyle={ButtonStyleType.NORMAL}
                      dataTestId="network-event-source-add"
                      onClick={() => {
                        Navigation.navigate(
                          getNetworkQuickActionRoute(
                            NetworkQuickAction.AddDevice,
                            {
                              address: source.address,
                              probeId: source.probeId,
                              siteId: source.siteId,
                            },
                          ),
                        );
                      }}
                    />
                    <Button
                      title="It is one of my devices"
                      icon={IconProp.Link}
                      buttonSize={ButtonSize.Small}
                      buttonStyle={ButtonStyleType.NORMAL}
                      dataTestId="network-event-source-link"
                      onClick={() => {
                        setLinking(source);
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
      {linking ? (
        <LinkSourceModal
          address={linking.address}
          kinds={linking.kinds}
          onClose={() => {
            setLinking(null);
          }}
          onLinked={(deviceName: string) => {
            setNotice(
              translator.translateTemplate(
                LINK_WORDS[wordsFor(linking.kinds)].linked,
                { address: linking.address, device: deviceName },
              ),
            );
            setLinking(null);
            props.onLinked();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default NetworkEventSourcesCard;
