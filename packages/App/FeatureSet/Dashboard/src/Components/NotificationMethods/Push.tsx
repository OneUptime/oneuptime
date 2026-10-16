import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { Blue500, Red500 } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import { isExpoPushDeviceType } from "Common/Types/PushNotification/ExpoPushDeviceType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { TableEmptyStateActionStyle } from "Common/UI/Components/Table/TableEmptyState";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, VAPID_PUBLIC_KEY } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import User from "Common/UI/Utils/User";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import React, { ReactElement, useRef, useState } from "react";
import ObjectID from "Common/Types/ObjectID";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";
import {
  BROWSER_PUSH_PROBLEM_MESSAGES,
  BrowserPushError,
  BrowserPushProblem,
  DASHBOARD_SERVICE_WORKER_URL,
  askForNotificationPermission,
  getBrowserPushProblem,
  getDefaultDeviceName,
  getPushSubscription,
  getServiceWorkerRegistration,
  getThisBrowserDeviceId,
  readBrowserIdentity,
  readBrowserPushEnvironment,
  replacePushSubscription,
  sendPushConfigurationToServiceWorker,
  setThisBrowserDeviceId,
  waitForActiveServiceWorker,
} from "./BrowserPushRegistration";
import {
  CriticalAlertDeviceState,
  PUSH_DEVICE_PLATFORM_LABELS,
  PushDevicePlatform,
  getCriticalAlertDeviceState,
  getPushDevicePlatform,
  readTestNotificationIsCritical,
  wasTestSentAsCriticalAlert,
} from "./PushDeviceCriticalAlerts";
import PushDeviceCriticalAlertStatus from "./PushDeviceCriticalAlertStatus";
import PushDeviceCriticalAlertSteps, {
  CriticalAlertTestDidNotRingHint,
} from "./PushDeviceCriticalAlertSteps";

interface RegisteredBrowser {
  deviceId: string;
  alreadyRegistered: boolean;
}

/*
 * A device's Critical Alerts cell in a CSV export: the words the cell shows,
 * not a raw true or false. English here, looked up when exported.
 */
const CRITICAL_ALERT_EXPORT_TEXT: Record<CriticalAlertDeviceState, string> = {
  [CriticalAlertDeviceState.On]: translationKey("On"),
  [CriticalAlertDeviceState.Off]: translationKey("Off"),
  [CriticalAlertDeviceState.NotAvailable]: translationKey(
    "Not available in browsers",
  ),
  [CriticalAlertDeviceState.NotReceiving]: translationKey(
    "Not receiving notifications",
  ),
};

// The device a dialog of this card is about: its steps, or its test.
export interface ShownPushDevice {
  deviceName: string;
  platform: PushDevicePlatform;
  isCriticalAlertEnabled: boolean;
}

// How a test notification went: the error to show, or what it did.
interface TestNotificationResult {
  failure: string | null;
  // Whether it went as a critical alert, when the server said.
  isCriticalAlert: boolean | null;
}

/*
 * What a test notification does on the device it went to, said once it is
 * on its way. A phone with critical alerts on is sent a critical test - it
 * rings through silent mode as a page would (UserPushAPI's
 * test-notification route) - and any other phone an ordinary one, which a
 * silenced phone keeps quiet. A browser shows it only where the site may
 * show notifications. For a test from the list, isCriticalAlertEnabled is
 * what the server said it sent (wasTestSentAsCriticalAlert), not what the
 * list showed.
 *
 * An ordinary test says why: critical alerts are off on that phone. The
 * list may have said On a moment ago - the phone's app turned them off
 * since, and the row catches up behind the dialog - and "it follows the
 * phone's sound settings" alone left the person to work out that the
 * Dashboard now knows.
 */
export function getTestNotificationSentDescription(
  translator: Translator,
  device: ShownPushDevice,
): string {
  if (device.platform === PushDevicePlatform.Browser) {
    return translator.translateTemplate(
      "Sent to {{deviceName}}. If it doesn't appear, check that this site may show notifications in that browser, and that Do Not Disturb or Focus is off on the computer.",
      { deviceName: device.deviceName },
    );
  }

  if (device.isCriticalAlertEnabled) {
    return translator.translateTemplate(
      "Sent to {{deviceName}} as a critical alert: it rings even when the phone is on silent or in Do Not Disturb, as an on-call page would.",
      { deviceName: device.deviceName },
    );
  }

  return translator.translateTemplate(
    "Sent to {{deviceName}}. Critical alerts are off on that phone, so it stays quiet on silent or in Do Not Disturb. Turn them on to have on-call pages ring through.",
    { deviceName: device.deviceName },
  );
}

/*
 * Whether the dialog that says a test went out also says what to do when it
 * did not ring through (CriticalAlertTestDidNotRingHint): only for a phone
 * it went to as a critical alert - the one dialog that promises it rings
 * through silent mode, which the phone's own settings can still have
 * stopped without its app saying so.
 */
export function canOfferDidNotRingHintAfterTest(
  device: ShownPushDevice,
): boolean {
  return (
    device.platform !== PushDevicePlatform.Browser &&
    device.isCriticalAlertEnabled
  );
}

/*
 * Whether the dialog that says a test went out also offers the steps that
 * turn critical alerts on: only for a phone that has them off - the one the
 * dialog tells to turn them on. A browser cannot have them, and a phone that
 * has them is done.
 */
export function canOfferCriticalAlertStepsAfterTest(
  device: ShownPushDevice,
): boolean {
  return (
    device.platform !== PushDevicePlatform.Browser &&
    !device.isCriticalAlertEnabled
  );
}

const SUBSCRIPTION_NOT_RENEWED_MESSAGE: string =
  "This browser's push subscription could not be renewed. Reload the page and register this browser again.";

/*
 * Replaces a subscription the push service no longer accepts
 * (replacePushSubscription), and has the devices registered with it carry the
 * new one: what the service worker reports when the browser replaces a
 * subscription itself (sw.js.template). The error to show, or null.
 */
async function renewGoneSubscription(data: {
  registration: ServiceWorkerRegistration;
  subscription: PushSubscription;
}): Promise<string | null> {
  const goneDeviceToken: string = JSON.stringify(data.subscription);

  const subscription: PushSubscription = await replacePushSubscription({
    pushManager: data.registration.pushManager,
    subscription: data.subscription,
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/user-push/subscription-change",
      ),
      data: {
        oldDeviceToken: goneDeviceToken,
        newDeviceToken: JSON.stringify(subscription),
      },
    });

  if (response.isFailure()) {
    return API.getFriendlyMessage(response);
  }

  // No device took the new subscription: the one found still receives nothing.
  if (
    !((response as HTTPResponse<JSONObject>).data["devicesUpdated"] as number)
  ) {
    return SUBSCRIPTION_NOT_RENEWED_MESSAGE;
  }

  return null;
}

/*
 * What stops this browser from being registered, known before anything is
 * asked of the person: a server without push keys, an insecure page, a
 * browser without push, an iPhone that has not added OneUptime to its Home
 * Screen. Permission is asked for, and answered, on Register Device.
 */
function getProblemBeforeAsking(): BrowserPushProblem | null {
  return getBrowserPushProblem({
    environment: readBrowserPushEnvironment(window),
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });
}

const Push: () => JSX.Element = (): ReactElement => {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  const [showRegisterDeviceModal, setShowRegisterDeviceModal] =
    useState<boolean>(false);

  const [error, setError] = useState<string>("");
  /*
   * A new value reads the table again. A fresh id rather than the time: the
   * time to the second repeats when a registration finishes within the
   * second the page opened, and the table then kept its old rows.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>(
    ObjectID.generate().toString(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  /*
   * The dialog swaps its form for a spinner while it works and builds the
   * form again afterwards, from its initial values: a name the person typed
   * is kept here so a failed attempt does not throw it away.
   */
  const [deviceName, setDeviceName] = useState<string>((): string => {
    return getDefaultDeviceName(readBrowserIdentity(window.navigator));
  });

  const [registeredBrowser, setRegisteredBrowser] =
    useState<RegisteredBrowser | null>(null);

  const [thisBrowserDeviceId, setThisBrowserDeviceIdInState] = useState<
    string | null
  >((): string | null => {
    return getThisBrowserDeviceId(projectId);
  });

  const [isSendingTestNotification, setIsSendingTestNotification] =
    useState<boolean>(false);

  const [testNotificationError, setTestNotificationError] =
    useState<string>("");

  // The device a test notification just went to, while the card says so.
  const [testedDevice, setTestedDevice] = useState<ShownPushDevice | null>(
    null,
  );

  // The device whose critical alert steps are open.
  const [stepsDevice, setStepsDevice] = useState<ShownPushDevice | null>(null);

  /*
   * Whether a phone is listed. A browser row only offers the way to get
   * critical alerts on a phone while there is none: once there is, that is
   * where they are turned on, and the link would only repeat itself.
   *
   * A ref, read when a cell is drawn, rather than state: the table keeps
   * the column closures it was given and swaps them in an effect, so a
   * closure over state drew one frame of rows with the previous answer - a
   * browser's link flashed up beside a phone. The list read sets this
   * before the rows it read are drawn.
   */
  const isPhoneListedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const translator: Translator = useTranslator();

  const toShownDevice: (item: UserPush) => ShownPushDevice = (
    item: UserPush,
  ): ShownPushDevice => {
    return {
      deviceName: item.deviceName || "",
      platform: getPushDevicePlatform(item.deviceType),
      isCriticalAlertEnabled: Boolean(item.isCriticalAlertEnabled),
    };
  };

  // The way to a phone with critical alerts: the app, for whoever has none.
  const showGetTheAppSteps: () => void = (): void => {
    setStepsDevice({
      deviceName: "",
      platform: PushDevicePlatform.Browser,
      isCriticalAlertEnabled: false,
    });
  };

  /*
   * Closing the steps reads the list again: whoever followed them on the
   * phone meanwhile sees the device's new state without reloading.
   */
  const closeSteps: () => void = (): void => {
    setStepsDevice(null);
    setRefreshToggle(ObjectID.generate().toString());
  };

  const openRegisterDeviceModal: () => void = (): void => {
    const problem: BrowserPushProblem | null = getProblemBeforeAsking();

    setError(problem ? BROWSER_PUSH_PROBLEM_MESSAGES[problem] : "");
    setShowRegisterDeviceModal(true);
  };

  const closeRegisterDeviceModal: () => void = (): void => {
    setShowRegisterDeviceModal(false);
    setError("");
  };

  const registerThisBrowser: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    const name: string =
      ((data["deviceName"] as string) || "").trim() ||
      getDefaultDeviceName(readBrowserIdentity(window.navigator));

    setDeviceName(name);
    setError("");

    const problem: BrowserPushProblem | null = getProblemBeforeAsking();

    if (problem) {
      setError(BROWSER_PUSH_PROBLEM_MESSAGES[problem]);
      return;
    }

    setIsLoading(true);

    try {
      // First, while this is still the person's click: browsers only prompt then.
      await askForNotificationPermission(window.Notification);

      const registration: ServiceWorkerRegistration =
        await getServiceWorkerRegistration(
          window.navigator.serviceWorker,
          DASHBOARD_SERVICE_WORKER_URL,
        );

      await waitForActiveServiceWorker(registration);

      const subscription: PushSubscription = await getPushSubscription({
        pushManager: registration.pushManager,
        vapidPublicKey: VAPID_PUBLIC_KEY,
      });

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-push/register",
          ),
          data: {
            // A string: the ObjectID itself is written as { _type, value }.
            projectId: ProjectUtil.getCurrentProjectId()!.toString(),
            deviceToken: JSON.stringify(subscription),
            deviceType: PushDeviceType.Web,
            deviceName: name,
          },
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        return;
      }

      const result: JSONObject = (response as HTTPResponse<JSONObject>).data;
      const deviceId: string = result["deviceId"]
        ? result["deviceId"].toString()
        : "";
      let alreadyRegistered: boolean = result["alreadyRegistered"] === true;

      /*
       * Registered already, but the device no longer receives notifications:
       * the push service stopped accepting the subscription this browser
       * still holds. Registering it again as it is would change nothing.
       */
      if (alreadyRegistered && result["isVerified"] === false) {
        const renewalError: string | null = await renewGoneSubscription({
          registration: registration,
          subscription: subscription,
        });

        if (renewalError) {
          setError(renewalError);
          return;
        }

        alreadyRegistered = false;
      }

      // So the worker can renew the subscription when the browser replaces it.
      sendPushConfigurationToServiceWorker({
        registration: registration,
        vapidPublicKey: VAPID_PUBLIC_KEY,
      });

      if (deviceId) {
        setThisBrowserDeviceId({ projectId: projectId, deviceId: deviceId });
        setThisBrowserDeviceIdInState(deviceId);
      }

      setShowRegisterDeviceModal(false);
      setTestNotificationError("");
      setRegisteredBrowser({
        deviceId: deviceId,
        alreadyRegistered: alreadyRegistered,
      });
      setRefreshToggle(ObjectID.generate().toString());
    } catch (err: unknown) {
      setError(
        err instanceof BrowserPushError
          ? err.message
          : API.getFriendlyMessage(err),
      );
    } finally {
      setIsLoading(false);
    }
  };

  // The error to show, or - once it is on its way - what it went as.
  const sendTestNotification: (
    deviceId: string,
  ) => Promise<TestNotificationResult> = async (
    deviceId: string,
  ): Promise<TestNotificationResult> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-push/" + deviceId + "/test-notification",
          ),
          data: {
            projectId: ProjectUtil.getCurrentProjectId()!.toString(),
          },
        });

      if (response.isFailure()) {
        return {
          failure: API.getFriendlyMessage(response),
          isCriticalAlert: null,
        };
      }

      return {
        failure: null,
        isCriticalAlert: readTestNotificationIsCritical(
          (response as HTTPResponse<JSONObject>).data,
        ),
      };
    } catch (err: unknown) {
      return { failure: API.getFriendlyMessage(err), isCriticalAlert: null };
    }
  };

  const sendTestNotificationToRegisteredBrowser: () => Promise<void> =
    async (): Promise<void> => {
      if (!registeredBrowser?.deviceId) {
        setRegisteredBrowser(null);
        return;
      }

      setIsSendingTestNotification(true);
      setTestNotificationError("");

      const result: TestNotificationResult = await sendTestNotification(
        registeredBrowser.deviceId,
      );

      setIsSendingTestNotification(false);

      if (result.failure) {
        setTestNotificationError(result.failure);
        return;
      }

      setRegisteredBrowser(null);
      setTestedDevice({
        deviceName: deviceName,
        platform: PushDevicePlatform.Browser,
        isCriticalAlertEnabled: false,
      });
    };

  /*
   * Unregistering a device cascades to every notification rule that pushes to
   * it, so the confirmation is the impact modal rather than ModelTable's
   * generic one, and the built-in delete is switched off so there is only one
   * way in.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserPush> =
    useNotificationMethodDeleteGuard<UserPush>({
      modelType: UserPush,
      relationName: "userPush",
      singularName: "Device",
      onDeleted: () => {
        setRefreshToggle(ObjectID.generate().toString());
      },
    });

  // Whether the dialog that says a test went out also leads to the steps.
  const canShowStepsAfterTest: boolean = Boolean(
    testedDevice && canOfferCriticalAlertStepsAfterTest(testedDevice),
  );

  // Whether it also says what to do when a critical test did not ring through.
  const canShowDidNotRingHint: boolean = Boolean(
    testedDevice && canOfferDidNotRingHintAfterTest(testedDevice),
  );

  return (
    <>
      <ModelTable<UserPush>
        userPreferencesKey={"user-push-table"}
        modelType={UserPush}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        selectMoreFields={{
          isVerified: true,
          deviceType: true,
        }}
        onFetchSuccess={(devices: Array<UserPush>) => {
          isPhoneListedRef.current = devices.some((item: UserPush): boolean => {
            return (
              getPushDevicePlatform(item.deviceType) !==
              PushDevicePlatform.Browser
            );
          });
        }}
        actionButtons={[
          {
            title: "Test Notification",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Bell,
            onClick: async (
              item: UserPush,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              const result: TestNotificationResult = await sendTestNotification(
                item._id!.toString(),
              );

              onCompleteAction();

              if (result.failure) {
                onError(new Error(result.failure));
                return;
              }

              const listed: ShownPushDevice = toShownDevice(item);

              const isCriticalAlert: boolean = wasTestSentAsCriticalAlert({
                platform: listed.platform,
                isListedAsOn: listed.isCriticalAlertEnabled,
                answer: result.isCriticalAlert,
              });

              setTestedDevice({
                ...listed,
                isCriticalAlertEnabled: isCriticalAlert,
              });

              /*
               * The phone's app changed its critical alerts since the list
               * was read: read it again, so the row says what the test did.
               */
              if (isCriticalAlert !== listed.isCriticalAlertEnabled) {
                setRefreshToggle(ObjectID.generate().toString());
              }
            },
          },
          deleteGuard.deleteActionButton,
        ]}
        id="user-push-devices"
        name="User Settings > Notification Methods > Push Notifications"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false} // We use custom registration flow
        cardProps={{
          title: "Push Notification Devices",
          description:
            "Phones signed in to the OneUptime On-Call app, and browsers you register here, get push notifications for this project.",
          buttons: [
            {
              title: "Register Device",
              icon: IconProp.Add,
              onClick: () => {
                openRegisterDeviceModal();
              },
              buttonStyle: ButtonStyleType.NORMAL,
            },
          ],
        }}
        /*
         * The card's description says what the list is for, and the empty
         * state offers both ways onto it: Register Device for this browser
         * (the card's button, which the empty state repeats), and the app
         * for a phone.
         */
        emptyState={{
          title: "No devices yet",
          icon: IconProp.DevicePhoneMobile,
          actions: [
            {
              title: "Get the mobile app",
              icon: IconProp.DevicePhoneMobile,
              style: TableEmptyStateActionStyle.Link,
              dataTestId: "push-devices-empty-get-app",
              onClick: () => {
                showGetTheAppSteps();
              },
            },
          ],
        }}
        formFields={[]} // No manual form fields since we auto-detect everything
        showRefreshButton={true}
        filters={[]} // No filters
        columns={[
          {
            field: {
              deviceName: true,
            },
            title: "Device",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            getElement: (item: UserPush): ReactElement => {
              const isThisBrowser: boolean =
                Boolean(thisBrowserDeviceId) &&
                item._id?.toString() === thisBrowserDeviceId;

              const platform: PushDevicePlatform = getPushDevicePlatform(
                item.deviceType,
              );

              return (
                <div
                  className="flex min-w-0 items-start gap-3"
                  data-testid="push-device"
                  data-platform={platform}
                >
                  {/*
                   * What kind of device it is, at a glance: a phone with the
                   * app, or a browser. The line under the name says it in
                   * words, which a phone's model name ("SM-S918B") does not.
                   */}
                  <div
                    aria-hidden="true"
                    className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200"
                  >
                    <Icon
                      icon={
                        platform === PushDevicePlatform.Browser
                          ? IconProp.ComputerDesktop
                          : IconProp.DevicePhoneMobile
                      }
                      className="h-4 w-4"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-gray-900">
                        {item.deviceName}
                      </span>
                      {isThisBrowser ? (
                        <Pill
                          text="This browser"
                          color={Blue500}
                          size={PillSize.Small}
                          isMinimal={true}
                        />
                      ) : (
                        <></>
                      )}
                      {/*
                       * Its push subscription is gone - or, for a phone, Expo
                       * said its push token is - and nothing is sent to it
                       * (UserPushService.markWebPushSubscriptionAsGone,
                       * markExpoPushTokenAsGone). The list used to show it
                       * like any other device. A phone comes back when its
                       * app is opened, which registers it again.
                       */}
                      {item.isVerified === false ? (
                        <Pill
                          text="Not receiving notifications"
                          color={Red500}
                          size={PillSize.Small}
                          tooltip={
                            isExpoPushDeviceType(item.deviceType)
                              ? "The mobile app was removed from this device, or its push token is no longer valid. Open the mobile app on it to register it again."
                              : "This device's push subscription expired or was revoked. Register it again from the browser or app it belongs to."
                          }
                        />
                      ) : (
                        <></>
                      )}
                    </div>
                    <p
                      className="mt-0.5 text-xs text-gray-500"
                      data-testid="push-device-platform"
                    >
                      {translator.translateText(
                        PUSH_DEVICE_PLATFORM_LABELS[platform],
                      )}
                    </p>
                  </div>
                </div>
              );
            },
          },
          /*
           * A state of the device, set in the OneUptime On-Call app on it:
           * drawn as a status (PushDeviceCriticalAlertStatus) with, while it
           * is off, the way to turn it on - never as a checkmark that reads
           * like a switch this card could flip. What the phone will really
           * do, as its app last reported it: the app reports it whenever
           * it is opened, and turns it off here when the phone's own
           * settings stop allowing critical alerts.
           *
           * The (i) says what it does and where it is set, in two sentences.
           * That a browser cannot have it is said by the browser's own cell
           * ("Not available in browsers"), so the (i) does not say it again.
           */
          {
            field: {
              isCriticalAlertEnabled: true,
            },
            title: "Critical Alerts",
            headerTooltip:
              "On-call pages to this device override silent mode and Do Not Disturb, except from on-call rules set to Standard. Set in the OneUptime On-Call mobile app, which updates it here each time it's opened.",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getExportValue: (item: UserPush): string => {
              const text: string =
                CRITICAL_ALERT_EXPORT_TEXT[getCriticalAlertDeviceState(item)];

              return translator.translateText(text) || text;
            },
            getElement: (item: UserPush): ReactElement => {
              const state: CriticalAlertDeviceState =
                getCriticalAlertDeviceState(item);

              const canShowSteps: boolean =
                state === CriticalAlertDeviceState.Off ||
                (state === CriticalAlertDeviceState.NotAvailable &&
                  !isPhoneListedRef.current);

              return (
                <PushDeviceCriticalAlertStatus
                  state={state}
                  deviceName={item.deviceName || ""}
                  onShowSteps={
                    canShowSteps
                      ? () => {
                          setStepsDevice(toShownDevice(item));
                        }
                      : undefined
                  }
                />
              );
            },
          },
        ]}
      />

      {deleteGuard.deletionModal}

      {showRegisterDeviceModal ? (
        <BasicFormModal
          title="Register Device for Push Notifications"
          description="This will register your current browser to receive push notifications from OneUptime. You'll be asked for permission to show notifications."
          isLoading={isLoading}
          submitButtonText="Register Device"
          onClose={() => {
            return closeRegisterDeviceModal();
          }}
          onSubmit={(data: JSONObject) => {
            return registerThisBrowser(data);
          }}
          formProps={{
            name: "Register Device",
            error: error, // Pass error to BasicForm instead of BasicFormModal
            initialValues: {
              deviceName: deviceName,
            },
            fields: [
              {
                field: {
                  deviceName: true,
                },
                title: "Device Name",
                description:
                  "Give this device a name to identify it in your notification settings.",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Chrome, Safari, Firefox",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {registeredBrowser ? (
        <ConfirmModal
          title={
            registeredBrowser.alreadyRegistered
              ? "This Browser Is Already Registered"
              : "Browser Registered"
          }
          description={
            registeredBrowser.alreadyRegistered
              ? "This browser already receives push notifications for this project. Send a test notification to check that they still arrive."
              : "This browser will now receive push notifications for alerts, incidents and on-call pages in this project. Send a test notification to check that they arrive."
          }
          submitButtonText="Send Test Notification"
          submitButtonType={ButtonStyleType.PRIMARY}
          closeButtonText="Close"
          isLoading={isSendingTestNotification}
          error={testNotificationError || undefined}
          onClose={() => {
            setRegisteredBrowser(null);
            setTestNotificationError("");
          }}
          onSubmit={async () => {
            await sendTestNotificationToRegisteredBrowser();
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * A phone with critical alerts off is told to turn them on, so the
       * dialog leads there - to that phone's steps - rather than leaving the
       * advice with nowhere to go. A phone sent a critical test is told where
       * to look if it did not ring through. Any other device's dialog only
       * closes.
       */}
      {testedDevice ? (
        <ConfirmModal
          title="Test Notification Sent"
          description={getTestNotificationSentDescription(
            translator,
            testedDevice,
          )}
          submitButtonType={
            canShowStepsAfterTest
              ? ButtonStyleType.PRIMARY
              : ButtonStyleType.NORMAL
          }
          submitButtonText={canShowStepsAfterTest ? "How to turn on" : "Close"}
          closeButtonText="Close"
          onClose={
            canShowStepsAfterTest
              ? () => {
                  setTestedDevice(null);
                }
              : undefined
          }
          onSubmit={() => {
            setTestedDevice(null);

            if (canShowStepsAfterTest) {
              setStepsDevice(testedDevice);
            }
          }}
        >
          {canShowDidNotRingHint ? (
            <CriticalAlertTestDidNotRingHint />
          ) : undefined}
        </ConfirmModal>
      ) : (
        <></>
      )}

      {stepsDevice ? (
        <PushDeviceCriticalAlertSteps
          deviceName={stepsDevice.deviceName}
          platform={stepsDevice.platform}
          onClose={closeSteps}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default Push;
