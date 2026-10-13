import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { CriticalAlertDeviceState } from "./PushDeviceCriticalAlerts";

/*
 * One device's cell in the Critical Alerts column of the Push Notification
 * Devices card: a status, never a control.
 *
 * The state is the device's own (the OneUptime On-Call app sets it), so
 * nothing here looks clickable but the one link that says what to do -
 * "How to turn on" on a phone that has it off, and "Get them on your phone"
 * on a browser when no phone is listed yet. The badges are plain boxes:
 * no hover, no pointer, no focus.
 *
 * Colours come from classes Theme.css re-tints for the dark theme
 * (App/Tests/Dashboard/PushDeviceCriticalAlertsDarkMode.test.ts holds them
 * to it).
 */

const BADGE_CLASS_NAME: string =
  "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

const ON_BADGE_CLASS_NAME: string = `${BADGE_CLASS_NAME} bg-emerald-50 text-emerald-700 ring-emerald-200`;

const OFF_BADGE_CLASS_NAME: string = `${BADGE_CLASS_NAME} bg-gray-50 text-gray-700 ring-gray-200`;

/*
 * Dashed and unfilled: there is nothing to be on or off here, which a
 * filled grey "Off" would not say.
 */
const NOT_AVAILABLE_BADGE_CLASS_NAME: string =
  "inline-flex max-w-full items-center rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-500";

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export const CRITICAL_ALERT_STATUS_TEST_ID: string = "critical-alert-status";

export const CRITICAL_ALERT_STEPS_LINK_TEST_ID: string =
  "critical-alert-steps-link";

export interface ComponentProps {
  state: CriticalAlertDeviceState;
  // The device's name, for the link's accessible name.
  deviceName: string;
  /*
   * Opens the steps for this device. Left out, no link is drawn: a browser
   * once the person has a phone listed, which is where they would go.
   */
  onShowSteps?: (() => void) | undefined;
}

const PushDeviceCriticalAlertStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const getStepsLink: (data: {
    text: string;
    accessibleName: string;
  }) => ReactElement = (data: {
    text: string;
    accessibleName: string;
  }): ReactElement => {
    if (!props.onShowSteps) {
      return <></>;
    }

    return (
      <button
        type="button"
        className={LINK_CLASS_NAME}
        aria-label={data.accessibleName}
        aria-haspopup="dialog"
        data-testid={CRITICAL_ALERT_STEPS_LINK_TEST_ID}
        onClick={() => {
          props.onShowSteps?.();
        }}
      >
        {data.text}
        <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
      </button>
    );
  };

  if (props.state === CriticalAlertDeviceState.NotReceiving) {
    return (
      <div
        className="text-sm text-gray-400"
        data-testid={CRITICAL_ALERT_STATUS_TEST_ID}
        data-state={props.state}
        title={translator.translateText(
          "Nothing reaches this device until it is registered again.",
        )}
      >
        <span aria-hidden="true">—</span>
        <span className="sr-only">
          {translator.translateText(
            "Nothing reaches this device until it is registered again.",
          )}
        </span>
      </div>
    );
  }

  if (props.state === CriticalAlertDeviceState.On) {
    return (
      <div
        className="flex flex-col items-start gap-1"
        data-testid={CRITICAL_ALERT_STATUS_TEST_ID}
        data-state={props.state}
      >
        <div className={ON_BADGE_CLASS_NAME}>
          <Icon icon={IconProp.BellAlert} className="h-3.5 w-3.5 flex-none" />
          <span>{translator.translateText("On")}</span>
        </div>
        <p className="text-xs leading-5 text-gray-500">
          {translator.translateText(
            "Rings through silent mode and Do Not Disturb",
          )}
        </p>
      </div>
    );
  }

  if (props.state === CriticalAlertDeviceState.Off) {
    return (
      <div
        className="flex flex-col items-start gap-1"
        data-testid={CRITICAL_ALERT_STATUS_TEST_ID}
        data-state={props.state}
      >
        {/*
         * No crossed-out bell: a phone with critical alerts off still gets
         * every push, as its sound settings allow.
         */}
        <div className={OFF_BADGE_CLASS_NAME}>
          <span>{translator.translateText("Off")}</span>
        </div>
        {getStepsLink({
          text: translator.translateText("How to turn on") || "How to turn on",
          accessibleName: translator.translateTemplate(
            "How to turn on critical alerts on {{deviceName}}",
            { deviceName: props.deviceName },
          ),
        })}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid={CRITICAL_ALERT_STATUS_TEST_ID}
      data-state={props.state}
    >
      <div className={NOT_AVAILABLE_BADGE_CLASS_NAME}>
        <span>{translator.translateText("Not available in browsers")}</span>
      </div>
      {props.onShowSteps ? (
        getStepsLink({
          text:
            translator.translateText("Get them on your phone") ||
            "Get them on your phone",
          accessibleName:
            translator.translateText(
              "How to get critical alerts on your phone",
            ) || "How to get critical alerts on your phone",
        })
      ) : (
        <p className="text-xs leading-5 text-gray-500">
          {translator.translateText("A browser can't ring through silent mode")}
        </p>
      )}
    </div>
  );
};

export default PushDeviceCriticalAlertStatus;
