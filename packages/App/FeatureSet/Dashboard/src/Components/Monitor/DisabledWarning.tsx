import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { subscribeToArchiveStateChanges } from "../Archive/ArchiveStateEvents";
import MonitoringSwitchCopy, {
  MONITORING_OFF_BANNER_TEST_ID,
  MONITORING_SWITCH_COLUMN,
  TURN_MONITORING_ON_BUTTON_TEST_ID,
  TURN_MONITORING_ON_ERROR_TEST_ID,
} from "./MonitoringSwitchCopy";
import useTurnMonitoringOn, { TurnMonitoringOn } from "./useTurnMonitoringOn";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  refreshToggle?: string | undefined;
}

// Why a monitor is not being checked, when it is not.
export enum MonitoringOffReason {
  // Someone turned monitoring off: the Monitoring switch on Settings.
  TurnedOff = "TurnedOff",
  // A manually declared incident paused it until it is resolved.
  ManualIncident = "ManualIncident",
  // A scheduled maintenance event paused it until it ends.
  ScheduledMaintenance = "ScheduledMaintenance",
}

export interface MonitoringOffNotice {
  reason: MonitoringOffReason;
  title: string;
  message: string;
}

const PAUSED_TITLE: string = translationKey("This monitor is disabled");

/*
 * What the banner says about a monitor, or null when it is being checked.
 *
 * Turned off: what off means, with the button that turns it back on. An
 * incident or a maintenance event that paused it keeps the wording it had:
 * monitoring resumes when that ends, so there is nothing to switch here.
 */
export const getMonitoringOffNotice: (
  monitor: Monitor | null,
) => MonitoringOffNotice | null = (
  monitor: Monitor | null,
): MonitoringOffNotice | null => {
  if (!monitor || monitor.monitorType === MonitorType.Manual) {
    return null;
  }

  /*
   * An archived monitor is not checked either, but the archived banner at the
   * top of its pages already says so and offers the way back. Two banners
   * saying "not monitoring" for two reasons would only make the reader
   * decide which one matters; once it is unarchived, this one speaks again
   * if the monitor is also turned off.
   */
  if (monitor.isArchived) {
    return null;
  }

  if (monitor.disableActiveMonitoring) {
    return {
      reason: MonitoringOffReason.TurnedOff,
      title: MonitoringSwitchCopy.bannerTitle,
      message: MonitoringSwitchCopy.offDescription,
    };
  }

  if (monitor.disableActiveMonitoringBecauseOfManualIncident) {
    return {
      reason: MonitoringOffReason.ManualIncident,
      title: PAUSED_TITLE,
      message: translationKey(
        "We are not monitoring this monitor since it is disabled because of an active incident. To enable active monitoring, please resolve the incident.",
      ),
    };
  }

  if (monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent) {
    return {
      reason: MonitoringOffReason.ScheduledMaintenance,
      title: PAUSED_TITLE,
      message: translationKey(
        "We are not monitoring this monitor since it is disabled because of an ongoing scheduled maintenance event. To enable active monitoring, please resolve the scheduled maintenance event.",
      ),
    };
  }

  return null;
};

// The banner's message for a monitor, or "" when it is being monitored.
export const getDisabledMessage: (monitor: Monitor | null) => string = (
  monitor: Monitor | null,
): string => {
  return getMonitoringOffNotice(monitor)?.message || "";
};

/*
 * Across the top of a monitor's pages while nothing is checking it: why,
 * and - when someone turned monitoring off - a "Turn monitoring on" button
 * that turns it back on right there. It used to send the reader to Settings
 * to find a switch called "Disable Active Monitoring" and turn it off.
 *
 * A quiet banner with a pause icon, like the archived one above it: a
 * monitor someone paused is a choice, not an outage, and an assertive red
 * alert on every page of it said otherwise.
 *
 * It reads the monitor itself, so a page renders it with the id alone, and
 * renders nothing while it reads, when the monitor is checked, and when the
 * read fails (the page owns its own errors). It reads again on
 * refreshToggle, when the monitor is archived or unarchived on the page, and
 * when monitoring is switched on or off anywhere on the page.
 */
const DisabledWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [notice, setNotice] = useState<MonitoringOffNotice | null>(null);
  const monitorIdString: string = props.monitorId.toString();

  const turnMonitoringOn: TurnMonitoringOn = useTurnMonitoringOn({
    monitorId: props.monitorId,
  });

  useEffect(() => {
    let cancelled: boolean = false;

    /*
     * Start every read from "being checked": the banner used to be set and
     * never cleared, so it stayed up after the monitor was re-enabled, and
     * a banner for the previous monitor showed on the next one.
     */
    setNotice(null);

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const monitor: Monitor | null = await ModelAPI.getItem({
          modelType: Monitor,
          id: props.monitorId,
          select: {
            disableActiveMonitoring: true,
            disableActiveMonitoringBecauseOfManualIncident: true,
            disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
            monitorType: true,
            isArchived: true,
          },
        });

        if (!cancelled) {
          setNotice(getMonitoringOffNotice(monitor));
        }
      } catch {
        /*
         * A warning banner is not worth an error of its own: the page it
         * sits on reports its own failures. Show nothing rather than leave
         * an unhandled rejection behind.
         */
        if (!cancelled) {
          setNotice(null);
        }
      }
    };

    const reload: () => void = (): void => {
      load().catch(() => {
        // load() handles its own failures.
      });
    };

    reload();

    // Read again when the monitor is archived or unarchived on this page.
    const unsubscribeArchive: () => void = subscribeToArchiveStateChanges({
      modelType: Monitor,
      modelId: props.monitorId,
      onChange: reload,
    });

    /*
     * And when monitoring is switched on or off on this page: the
     * Monitoring card's switch on Settings, or this banner's own button.
     */
    const unsubscribeMonitoring: () => void = subscribeToModelSwitchSaved({
      modelType: Monitor,
      modelId: props.monitorId,
      column: MONITORING_SWITCH_COLUMN,
      onSaved: reload,
    });

    return () => {
      cancelled = true;
      unsubscribeArchive();
      unsubscribeMonitoring();
    };
  }, [monitorIdString, props.refreshToggle]);

  if (!notice) {
    return <></>;
  }

  if (notice.reason !== MonitoringOffReason.TurnedOff) {
    return (
      <AlertBanner
        type={AlertBannerType.Info}
        icon={IconProp.PauseCircle}
        title={notice.title}
        dataTestId={MONITORING_OFF_BANNER_TEST_ID}
      >
        <p>{translator.translateText(notice.message)}</p>
      </AlertBanner>
    );
  }

  /*
   * The button is hidden only while there is nothing honest to say about
   * it: the permission snapshot has not arrived yet (PermissionGate).
   * Someone who may not turn monitoring on sees it locked, with why.
   */
  const showButton: boolean =
    turnMonitoringOn.gate.isAllowed ||
    Boolean(turnMonitoringOn.gate.disabledReason);

  return (
    <AlertBanner
      type={AlertBannerType.Info}
      icon={IconProp.PauseCircle}
      title={notice.title}
      dataTestId={MONITORING_OFF_BANNER_TEST_ID}
      rightElement={
        showButton ? (
          <Button
            title={MonitoringSwitchCopy.turnOnButton}
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={TURN_MONITORING_ON_BUTTON_TEST_ID}
            isLoading={turnMonitoringOn.isSaving}
            disabled={!turnMonitoringOn.gate.isAllowed}
            tooltip={turnMonitoringOn.gate.disabledReason}
            onClick={turnMonitoringOn.turnOn}
          />
        ) : undefined
      }
    >
      <>
        <p>{translator.translateText(notice.message)}</p>
        {turnMonitoringOn.error ? (
          <p
            className="mt-1 text-sm text-red-600"
            role="alert"
            data-testid={TURN_MONITORING_ON_ERROR_TEST_ID}
          >
            {turnMonitoringOn.error}
          </p>
        ) : (
          <></>
        )}
      </>
    </AlertBanner>
  );
};

export default DisabledWarning;
