import MonitorElement from "../Monitor/Monitor";
import DeviceNameLink from "./DeviceNameLink";
import { UntiedMonitorsListing } from "./DeviceMonitorLookupUtil";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { AmbiguousAddressReason } from "Common/Utils/NetworkDevice/DeviceAddressScope";
import {
  UntiedDeviceMonitor,
  UntiedMonitorMatch,
} from "Common/Utils/NetworkDevice/UntiedDeviceMonitor";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * THE MONITORS THAT CHECK A DEVICE'S ADDRESS BUT ARE TIED TO NO DEVICE, on
 * its Monitors card (OneUptime issue #9903).
 *
 * A monitor made from Monitors is tied to the device its probes see at the
 * address it checks (#9677), and left untied when they cannot tell which
 * device that is. Untied, it is not on the device's pages, what it raises
 * is not linked to the device, and imports may give the device a second
 * monitor like it - and nothing pointed a person to it. Under the device's
 * own monitors, a muted line counts them, and each says what its probes
 * see at the address (Common/Utils/NetworkDevice/UntiedDeviceMonitor):
 *
 *   - this device: Add ties it in one click, as Add Existing Monitor does;
 *   - this device and others they cannot tell apart, or nothing they can
 *     know: the row says so plainly, names the other devices, and leaves
 *     the choice to a person who knows (Add Existing Monitor).
 */

export const UNTIED_MONITORS_HEADING: PluralTemplate = {
  one: "{{count}} monitor checks this device's address but is not tied to it.",
  other:
    "{{count}} monitors check this device's address but are not tied to it.",
};

export const UNTIED_MONITORS_COPY: {
  add: string;
  addAriaLabel: string;
  added: string;
  notAdded: string;
  probesInNoSite: string;
  pollsSeveral: string;
  severalInSites: string;
  reachUnknown: string;
  alsoAtThisAddress: string;
  addItIfItChecksThisDevice: string;
  hasMore: string;
} = {
  // Written as the literal "Add" where it is drawn, as Remove is.
  add: translationKey("Add"),
  addAriaLabel: translationKey("Add {{monitorName}} to this device"),
  added: translationKey("Monitor added to this device."),
  notAdded: translationKey("The monitor was not added to this device."),
  probesInNoSite: translationKey(
    "Its probes poll no device and are no site's default probe, so OneUptime cannot tell whether they reach this device.",
  ),
  pollsSeveral: translationKey(
    "Its probes poll more than one device at this address, so OneUptime cannot tell which one it checks.",
  ),
  severalInSites: translationKey(
    "More than one device has this address in its probes' sites, so OneUptime cannot tell which one it checks.",
  ),
  reachUnknown: translationKey(
    "More than one device has this address, and its probes poll none and are no site's default probe, so OneUptime cannot tell which one it checks.",
  ),
  alsoAtThisAddress: translationKey("Also at this address: {{devices}}"),
  addItIfItChecksThisDevice: translationKey(
    "If it checks this device, add it with Add Existing Monitor.",
  ),
  hasMore: translationKey(
    "More monitors may check this address than are listed.",
  ),
};

/*
 * Why a monitor is not tied to this device, in a sentence, or "" for one
 * whose probes see this device: Add says all there is.
 */
export function getUntiedMonitorReason(monitor: UntiedDeviceMonitor): string {
  if (monitor.match === UntiedMonitorMatch.ProbesInNoSite) {
    return UNTIED_MONITORS_COPY.probesInNoSite;
  }

  if (monitor.match !== UntiedMonitorMatch.CannotTellApart) {
    return "";
  }

  switch (monitor.ambiguousReason) {
    case AmbiguousAddressReason.PollSeveral:
      return UNTIED_MONITORS_COPY.pollsSeveral;
    case AmbiguousAddressReason.SeveralInTheirSites:
      return UNTIED_MONITORS_COPY.severalInSites;
    case AmbiguousAddressReason.ReachUnknown:
      return UNTIED_MONITORS_COPY.reachUnknown;
    default:
      return "";
  }
}

// The row's monitor, as the card's monitor link reads one.
function toMonitor(untied: UntiedDeviceMonitor): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = untied.monitorId;
  monitor.name = untied.name;
  return monitor;
}

export interface ComponentProps {
  listing: UntiedMonitorsListing;
  networkDeviceId: string;
  /*
   * Whether the reader may tie a monitor to the device here, on a page that
   * reads its monitors again after: Add is offered only then.
   */
  mayAdd: boolean;
  // Read the device's monitors again: one was just added to it.
  onMonitorAdded: () => void;
}

const DeviceUntiedMonitors: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  // The monitor being added, while it saves.
  const [addingMonitorId, setAddingMonitorId] = useState<string>("");
  // Why the last Add failed, by the monitor it was for.
  const [addError, setAddError] = useState<{
    monitorId: string;
    message: string;
  } | null>(null);

  if (props.listing.monitors.length === 0) {
    return null;
  }

  /*
   * Ties the monitor to the device, and nothing else about it, as Add
   * Existing Monitor does: the page reads its monitors again, and the
   * monitor moves up among them. A refusal is said under its row.
   */
  const addMonitor: (monitor: UntiedDeviceMonitor) => Promise<void> = async (
    monitor: UntiedDeviceMonitor,
  ): Promise<void> => {
    setAddingMonitorId(monitor.monitorId);
    setAddError(null);

    try {
      await ModelAPI.updateById<Monitor>({
        modelType: Monitor,
        id: new ObjectID(monitor.monitorId),
        data: {
          networkDeviceId: new ObjectID(props.networkDeviceId),
        },
      });
    } catch (err) {
      setAddError({
        monitorId: monitor.monitorId,
        message: API.getFriendlyMessage(err),
      });
      setAddingMonitorId("");
      return;
    }

    setAddingMonitorId("");
    Toast.success(
      translator.translateText(UNTIED_MONITORS_COPY.added) ||
        UNTIED_MONITORS_COPY.added,
    );
    props.onMonitorAdded();
  };

  return (
    <div
      className="mt-4 border-t border-gray-200 pt-4"
      data-testid="device-untied-monitors"
    >
      <p className="text-sm text-gray-500">
        {translator.translatePlural(
          UNTIED_MONITORS_HEADING,
          props.listing.monitors.length,
        )}
      </p>
      <div className="divide-y divide-gray-100">
        {props.listing.monitors.map(
          (monitor: UntiedDeviceMonitor): ReactElement => {
            const reason: string = getUntiedMonitorReason(monitor);
            const namedOthers: Array<string> = (
              monitor.otherDeviceIds || []
            ).filter((id: string): boolean => {
              return Boolean(props.listing.deviceNames.get(id));
            });
            const canAddHere: boolean =
              props.mayAdd && monitor.match === UntiedMonitorMatch.ThisDevice;

            return (
              <div
                key={monitor.monitorId}
                className="py-3"
                data-testid={`device-untied-monitor-${monitor.monitorId}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm font-medium text-gray-900">
                    <MonitorElement monitor={toMonitor(monitor)} />
                  </div>
                  {canAddHere && (
                    <div className="flex flex-shrink-0 items-center">
                      <Button
                        title={UNTIED_MONITORS_COPY.add}
                        buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                        buttonSize={ButtonSize.Small}
                        ariaLabel={translator.translateTemplate(
                          UNTIED_MONITORS_COPY.addAriaLabel,
                          { monitorName: monitor.name },
                        )}
                        isAriaLabelTranslated={true}
                        isLoading={addingMonitorId === monitor.monitorId}
                        disabled={Boolean(addingMonitorId)}
                        dataTestId={`device-untied-monitors-add-${monitor.monitorId}`}
                        onClick={() => {
                          void addMonitor(monitor);
                        }}
                      />
                    </div>
                  )}
                </div>
                {reason && (
                  <p className="mt-1 text-xs text-gray-500">
                    {translator.translateText(reason)}
                    {props.mayAdd && (
                      <Fragment>
                        {" "}
                        {translator.translateText(
                          UNTIED_MONITORS_COPY.addItIfItChecksThisDevice,
                        )}
                      </Fragment>
                    )}
                  </p>
                )}
                {reason && namedOthers.length > 0 && (
                  <p
                    className="mt-0.5 text-xs text-gray-500"
                    data-testid={`device-untied-monitor-others-${monitor.monitorId}`}
                  >
                    <TranslatedSentence
                      template={UNTIED_MONITORS_COPY.alsoAtThisAddress}
                      slots={{
                        devices: (
                          <span>
                            {namedOthers.map(
                              (id: string, index: number): ReactElement => {
                                return (
                                  <Fragment key={id}>
                                    {index > 0 && <InlineSeparator />}
                                    <DeviceNameLink
                                      deviceId={id}
                                      name={
                                        props.listing.deviceNames.get(id) || ""
                                      }
                                      dataTestId={`device-untied-monitor-device-${monitor.monitorId}-${index}`}
                                    />
                                  </Fragment>
                                );
                              },
                            )}
                          </span>
                        ),
                      }}
                    />
                  </p>
                )}
                {addError && addError.monitorId === monitor.monitorId && (
                  <ErrorLine
                    message={addError.message}
                    whatFailed={translator.translateText(
                      UNTIED_MONITORS_COPY.notAdded,
                    )}
                    className="mt-1 break-words text-xs text-red-600"
                    dataTestId={`device-untied-monitor-error-${monitor.monitorId}`}
                  />
                )}
              </div>
            );
          },
        )}
      </div>
      {props.listing.hasMore && (
        <p className="mt-1 text-xs text-gray-500">
          {translator.translateText(UNTIED_MONITORS_COPY.hasMore)}
        </p>
      )}
    </div>
  );
};

export default DeviceUntiedMonitors;
