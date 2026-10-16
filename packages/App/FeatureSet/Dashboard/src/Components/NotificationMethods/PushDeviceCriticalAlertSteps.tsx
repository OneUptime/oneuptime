import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";
import {
  CRITICAL_ALERT_HOW_TO_HEAR_IT,
  CRITICAL_ALERT_ONCE_ON,
  CRITICAL_ALERT_STEPS,
  CRITICAL_ALERT_TEST_DID_NOT_RING,
  CRITICAL_ALERT_TROUBLESHOOTING,
  CriticalAlertSentenceSlot,
  MOBILE_APP_LABELS,
  PUSH_DEVICE_PLATFORM_LABELS,
  PushDevicePlatform,
} from "./PushDeviceCriticalAlerts";
import {
  APP_STORE_NAME,
  GOOGLE_PLAY_NAME,
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../Utils/MobileAppStoreLinks";
import { getMobileAppServerUrl } from "../../Utils/MobileAppServerUrl";

/*
 * How to turn critical alerts on, for one device of the Push Notification
 * Devices card: the steps in the OneUptime On-Call app on THAT phone - iOS
 * and Android ask differently (PushDeviceCriticalAlerts) - what it does once
 * it is on, and what to do when the steps did not turn it on. For a browser,
 * which can never have them, how to get them on a phone instead.
 *
 * A dialog rather than a popover or a line under the row: four numbered
 * steps and their fixes are too much for a popover - which the table's
 * scrolling box would also clip - and a line that opens under the row would
 * stretch the column and push the rest of the list around. The table keeps
 * one short status per row; the steps open on demand, the same on a phone
 * (as a sheet) and in the dark theme.
 */

export const CRITICAL_ALERT_STEPS_TEST_ID: string = "critical-alert-steps";

export const CRITICAL_ALERT_TEST_DID_NOT_RING_TEST_ID: string =
  "test-notification-did-not-ring";

/*
 * One of the OneUptime On-Call app's own labels, as the app draws it: in
 * bold, in English whatever the Dashboard's language, and kept on one line,
 * as the phone shows it.
 */
export const MobileAppLabel: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return (
    <strong className="whitespace-nowrap font-semibold text-gray-900">
      {props.text}
    </strong>
  );
};

/*
 * The line under a sent test's words when it went to a phone as a critical
 * alert (Push.tsx): where on the phone to look when it did not ring through
 * (CRITICAL_ALERT_TEST_DID_NOT_RING). Quieter than the words above it - an
 * aside for when the test did not do what they say - and naming the app's
 * labels as these steps do.
 */
export const CriticalAlertTestDidNotRingHint: FunctionComponent =
  (): ReactElement => {
    return (
      <p
        className="text-sm leading-6 text-gray-500"
        data-testid={CRITICAL_ALERT_TEST_DID_NOT_RING_TEST_ID}
      >
        <TranslatedSentence
          template={CRITICAL_ALERT_TEST_DID_NOT_RING}
          slots={{
            app: <MobileAppLabel text={MOBILE_APP_LABELS.appName} />,
            settings: <MobileAppLabel text={MOBILE_APP_LABELS.settingsTab} />,
            criticalAlerts: (
              <MobileAppLabel text={MOBILE_APP_LABELS.criticalAlertsSwitch} />
            ),
          }}
        />
      </p>
    );
  };

export interface ComponentProps {
  deviceName: string;
  platform: PushDevicePlatform;
  onClose: () => void;
}

const PushDeviceCriticalAlertSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const isBrowser: boolean = props.platform === PushDevicePlatform.Browser;

  // A label as the app draws it.
  const appLabel: (text: string) => ReactElement = (
    text: string,
  ): ReactElement => {
    return <MobileAppLabel text={text} />;
  };

  // Settings > Notifications > Alarm sound: wraps between its steps only.
  const alarmSoundPath: ReactElement = (
    <>
      {[
        MOBILE_APP_LABELS.settingsTab,
        MOBILE_APP_LABELS.notificationsSection,
        MOBILE_APP_LABELS.alarmSoundRow,
      ].map((label: string, index: number): ReactElement => {
        return (
          <Fragment key={label}>
            {index > 0 ? " > " : ""}
            {appLabel(label)}
          </Fragment>
        );
      })}
    </>
  );

  const storeLink: (data: {
    name: string;
    url: string;
  }) => ReactElement = (data: { name: string; url: string }): ReactElement => {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-500"
      >
        {data.name}
      </a>
    );
  };

  const slots: Record<CriticalAlertSentenceSlot, ReactNode> = {
    app: appLabel(MOBILE_APP_LABELS.appName),
    settings: appLabel(MOBILE_APP_LABELS.settingsTab),
    notifications: appLabel(MOBILE_APP_LABELS.notificationsSection),
    criticalAlerts: appLabel(MOBILE_APP_LABELS.criticalAlertsSwitch),
    alarmSoundPath: alarmSoundPath,
    appStore: storeLink({ name: APP_STORE_NAME, url: MOBILE_APP_IOS_URL }),
    googlePlay: storeLink({
      name: GOOGLE_PLAY_NAME,
      url: MOBILE_APP_ANDROID_URL,
    }),
    /*
     * What to type into the app's Server URL: code, as it is typed, and
     * wrapped onto its own line only when it does not fit on one.
     */
    serverUrl: (
      <code
        className="break-words rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.8125rem] font-medium text-gray-900"
        data-testid="critical-alert-steps-server-url"
        dir="ltr"
      >
        {getMobileAppServerUrl()}
      </code>
    ),
  };

  // Each sentence is given only the slots it names.
  const sentence: (template: string) => ReactElement = (
    template: string,
  ): ReactElement => {
    const used: Record<string, ReactNode> = {};

    for (const [name, element] of Object.entries(slots)) {
      if (template.includes(`{{${name}}}`)) {
        used[name] = element;
      }
    }

    return <TranslatedSentence template={template} slots={used} />;
  };

  const steps: ReadonlyArray<string> = CRITICAL_ALERT_STEPS[props.platform];
  const troubleshooting: ReadonlyArray<string> =
    CRITICAL_ALERT_TROUBLESHOOTING[props.platform];

  return (
    <Modal
      title={isBrowser ? "Get the mobile app" : "Turn on critical alerts"}
      description={
        isBrowser
          ? "Get push notifications on your phone with the OneUptime On-Call app. Its critical alerts ring on-call pages through silent mode and Do Not Disturb, which a browser can't."
          : "Critical alerts make on-call pages ring this phone even on silent or in Do Not Disturb. They are turned on in the app, on the phone itself."
      }
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div className="space-y-5" data-testid={CRITICAL_ALERT_STEPS_TEST_ID}>
        {isBrowser ? (
          <></>
        ) : (
          <div
            className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5 ring-1 ring-inset ring-gray-200"
            data-testid="critical-alert-steps-device"
          >
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white text-gray-500 ring-1 ring-inset ring-gray-200">
              <Icon icon={IconProp.DevicePhoneMobile} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              {/*
               * Wrapped, never cut short: the end of a long name ("... work
               * phone") is often what tells two phones apart.
               */}
              <p
                className="break-words text-sm font-medium text-gray-900"
                data-testid="critical-alert-steps-device-name"
              >
                {props.deviceName}
              </p>
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  PUSH_DEVICE_PLATFORM_LABELS[props.platform],
                )}
              </p>
            </div>
          </div>
        )}

        <ol className="space-y-3" data-testid="critical-alert-steps-list">
          {steps.map((template: string, index: number): ReactElement => {
            return (
              <li key={template} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
                >
                  {index + 1}
                </span>
                <p className="min-w-0 pt-0.5 text-sm leading-5 text-gray-700">
                  {sentence(template)}
                </p>
              </li>
            );
          })}
        </ol>

        {isBrowser ? (
          <></>
        ) : (
          <div
            className="flex gap-3 rounded-lg bg-indigo-50 px-3 py-3 ring-1 ring-inset ring-indigo-100"
            data-testid="critical-alert-steps-once-on"
          >
            <Icon
              icon={IconProp.BellAlert}
              className="mt-0.5 h-4 w-4 flex-none text-indigo-600"
            />
            <div className="min-w-0 space-y-1 text-sm leading-5 text-gray-700">
              <p>{sentence(CRITICAL_ALERT_ONCE_ON)}</p>
              <p>{translator.translateText(CRITICAL_ALERT_HOW_TO_HEAR_IT)}</p>
            </div>
          </div>
        )}

        {troubleshooting.length > 0 ? (
          <div data-testid="critical-alert-steps-troubleshooting">
            {/* The dialog's title is its h3; this is a section of it. */}
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translator.translateText("If it doesn't turn on")}
            </h4>
            <ul className="mt-2 space-y-2">
              {troubleshooting.map((template: string): ReactElement => {
                return (
                  <li
                    key={template}
                    className="flex gap-2.5 text-sm leading-5 text-gray-600"
                  >
                    {/*
                     * A plain bullet: a chevron here read as a link to
                     * somewhere, and these are only things to try. Drawn in
                     * its text colour, which the dark theme re-tints.
                     */}
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1 w-1 flex-none rounded-full bg-current text-gray-400"
                    />
                    <p className="min-w-0">{sentence(template)}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default PushDeviceCriticalAlertSteps;
