import {
  ManagedDeviceStatus,
  getManagedDeviceStatus,
} from "Common/Types/DeviceManagement/ManagedDeviceStatus";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { formatMinutesAgo } from "../Inventory/InventoryLiveness";
import {
  ManagedDeviceStatusWords,
  getManagedDeviceStatusWords,
} from "./DeviceManagementWords";

/*
 * Whether a managed device is there, as one chip: Online, Offline, being
 * set up, disabled, wiped or removed - and, for a device that is online or
 * offline, how long since it last checked in ("Offline · 3h ago"). Red only
 * for what went wrong; grey for what someone chose.
 */

export interface ComponentProps {
  providerState?: number | undefined | null;
  lastCheckInAt?: Date | string | undefined | null;
  removedAt?: Date | string | undefined | null;
  now: Date;
  // "· 3h ago" after an online or offline device's status.
  showAge?: boolean | undefined;
}

// Whole minutes since a check-in, or null when none is known.
export function getMinutesSinceCheckIn(
  lastCheckInAt: Date | string | undefined | null,
  now: Date,
): number | null {
  if (!lastCheckInAt) {
    return null;
  }

  const time: number = new Date(lastCheckInAt).getTime();

  if (Number.isNaN(time)) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - time) / (60 * 1000)));
}

const ManagedDeviceStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: ManagedDeviceStatus = getManagedDeviceStatus({
    providerState: props.providerState,
    lastCheckInAt: props.lastCheckInAt,
    removedAt: props.removedAt,
    now: props.now,
  });
  const words: ManagedDeviceStatusWords = getManagedDeviceStatusWords(status);
  const minutes: number | null = getMinutesSinceCheckIn(
    props.lastCheckInAt,
    props.now,
  );
  const showsAge: boolean =
    Boolean(props.showAge) &&
    minutes !== null &&
    (status === ManagedDeviceStatus.Online ||
      status === ManagedDeviceStatus.Offline);

  return (
    <div
      className="flex flex-wrap items-center gap-x-2"
      data-testid="managed-device-status"
      data-status={status}
    >
      <Pill tone={words.tone} text={words.label} />
      {showsAge ? (
        <span className="text-xs text-gray-500">
          {formatMinutesAgo(minutes!, translator)}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ManagedDeviceStatusPill;
