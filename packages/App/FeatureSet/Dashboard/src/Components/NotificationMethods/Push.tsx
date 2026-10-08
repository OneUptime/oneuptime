import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { Blue500 } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, VAPID_PUBLIC_KEY } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import User from "Common/UI/Utils/User";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import React, { ReactElement, useState } from "react";
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
  setThisBrowserDeviceId,
  waitForActiveServiceWorker,
} from "./BrowserPushRegistration";

interface RegisteredBrowser {
  deviceId: string;
  alreadyRegistered: boolean;
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

  const [
    showTestNotificationSuccessModal,
    setShowTestNotificationSuccessModal,
  ] = useState<boolean>(false);

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

      if (deviceId) {
        setThisBrowserDeviceId({ projectId: projectId, deviceId: deviceId });
        setThisBrowserDeviceIdInState(deviceId);
      }

      setShowRegisterDeviceModal(false);
      setTestNotificationError("");
      setRegisteredBrowser({
        deviceId: deviceId,
        alreadyRegistered: result["alreadyRegistered"] === true,
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

  // The error to show, or null once the notification is on its way.
  const sendTestNotification: (
    deviceId: string,
  ) => Promise<string | null> = async (
    deviceId: string,
  ): Promise<string | null> => {
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
        return API.getFriendlyMessage(response);
      }

      return null;
    } catch (err: unknown) {
      return API.getFriendlyMessage(err);
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

      const failure: string | null = await sendTestNotification(
        registeredBrowser.deviceId,
      );

      setIsSendingTestNotification(false);

      if (failure) {
        setTestNotificationError(failure);
        return;
      }

      setRegisteredBrowser(null);
      setShowTestNotificationSuccessModal(true);
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
              const failure: string | null = await sendTestNotification(
                item._id!.toString(),
              );

              onCompleteAction();

              if (failure) {
                onError(new Error(failure));
                return;
              }

              setShowTestNotificationSuccessModal(true);
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
            "Manage devices that will receive push notifications for this project. Push notifications work on modern web browsers.",
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
        noItemsMessage={
          "No devices registered. Click 'Register Device' to enable push notifications on this device."
        }
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
            getElement: (item: UserPush): ReactElement => {
              const isThisBrowser: boolean =
                Boolean(thisBrowserDeviceId) &&
                item._id?.toString() === thisBrowserDeviceId;

              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{item.deviceName}</span>
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
                </div>
              );
            },
          },
          {
            field: {
              isCriticalAlertEnabled: true,
            },
            title: "Critical Alerts",
            description:
              "On-call pages to this device override silent mode and Do Not Disturb. Turned on from the OneUptime On-Call mobile app; browsers cannot override a device's ringer.",
            type: FieldType.Boolean,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Registered At",
            type: FieldType.DateTime,
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

      {showTestNotificationSuccessModal ? (
        <ConfirmModal
          title="Test Notification Sent Successfully"
          description="A test notification has been sent to your device. If you don't see it, please check that notifications are enabled for this browser and that your device is not in Do Not Disturb mode."
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText="Close"
          onSubmit={() => {
            setShowTestNotificationSuccessModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default Push;
