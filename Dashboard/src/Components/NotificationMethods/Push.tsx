import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, VAPID_PUBLIC_KEY } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import User from "Common/UI/Utils/User";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import React, { ReactElement, useEffect, useState } from "react";
import OneUptimeDate from "Common/Types/Date";

const Push: () => JSX.Element = (): ReactElement => {
  const [showRegisterDeviceModal, setShowRegisterDeviceModal] =
    useState<boolean>(false);

  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [showRegistrationSuccessModal, setShowRegistrationSuccessModal] =
    useState<boolean>(false);

  const [
    showTestNotificationSuccessModal,
    setShowTestNotificationSuccessModal,
  ] = useState<boolean>(false);

  function getBrowserName(): string {
    const userAgent: string = navigator.userAgent;
    if (userAgent.includes("Chrome") && !userAgent.includes("Edge")) {
      return "Chrome";
    } else if (userAgent.includes("Firefox")) {
      return "Firefox";
    } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
      return "Safari";
    } else if (userAgent.includes("Edge")) {
      return "Edge";
    } else if (userAgent.includes("Opera")) {
      return "Opera";
    }
    return "Browser";
  }

  useEffect(() => {
    setError("");
  }, [showRegisterDeviceModal]);

  async function registerDeviceForPushNotifications(
    data: JSONObject,
  ): Promise<void> {
    try {
      // Check if VAPID keys are configured
      if (!VAPID_PUBLIC_KEY) {
        setError(
          "VAPID keys are not configured. Please add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables to enable push notifications.",
        );
        return;
      }

      setIsLoading(true);

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setError("Push notifications are not supported in this browser.");
        return;
      }

      // Request notification permission
      const permission: NotificationPermission =
        await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Permission to show notifications was denied.");
        return;
      }

      // Register service worker
      const swRegistration: ServiceWorkerRegistration =
        await navigator.serviceWorker.register("/dashboard/sw.js");

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Ensure the service worker is active
      if (!swRegistration.active) {
        // If service worker is installing, wait for it to become active
        if (swRegistration.installing) {
          await new Promise((resolve: (value?: unknown) => void) => {
            swRegistration.installing!.addEventListener(
              "statechange",
              function () {
                if (this.state === "activated") {
                  resolve(undefined);
                }
              },
            );
          });
        } else {
          throw new Error("Service worker failed to activate");
        }
      }

      // Get push subscription
      const subscription: PushSubscription =
        await swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: VAPID_PUBLIC_KEY,
        });

      // Create device registration through API
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post(
          URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-push/register",
          ),
          {
            projectId: ProjectUtil.getCurrentProjectId()!,
            deviceToken: JSON.stringify(subscription),
            deviceType: "web",
            deviceName:
              (data["deviceName"] as string)?.trim() ||
              `${browserName} on ${platformName}`,
          },
        );

      if (response.isFailure()) {
        const errorMessage: string = API.getFriendlyMessage(response);
        setError(errorMessage);
        return;
      }

      setError(""); // Clear any previous errors
      setShowRegisterDeviceModal(false);
      setShowRegistrationSuccessModal(true);
      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    } catch (err: any) {
      const errorMessage: string = API.getFriendlyMessage(err);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  function handleCloseRegisterModal(): void {
    setShowRegisterDeviceModal(false);
    setError("");
  }

  const browserName: string = getBrowserName();
  const platformName: string = navigator.platform;

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
              try {
                // Send test notification
                const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                  await API.post(
                    URL.fromString(APP_API_URL.toString()).addRoute(
                      "/user-push/" + item._id + "/test-notification",
                    ),
                    {
                      projectId: ProjectUtil.getCurrentProjectId()!,
                    },
                  );

                if (response.isFailure()) {
                  onError(new Error(API.getFriendlyMessage(response)));
                  return;
                }

                // Show success modal
                setShowTestNotificationSuccessModal(true);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        id="user-push-devices"
        name="User Settings > Notification Methods > Push Notifications"
        isDeleteable={true}
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
                setShowRegisterDeviceModal(true);
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
            type: FieldType.Text,
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

      {showRegisterDeviceModal ? (
        <BasicFormModal
          title="Register Device for Push Notifications"
          description="This will register your current browser to receive push notifications from OneUptime. You'll be asked for permission to show notifications."
          isLoading={isLoading}
          submitButtonText="Register Device"
          onClose={() => {
            return handleCloseRegisterModal();
          }}
          onSubmit={(data: JSONObject) => {
            return registerDeviceForPushNotifications(data);
          }}
          formProps={{
            name: "Register Device",
            error: error, // Pass error to BasicForm instead of BasicFormModal
            initialValues: {
              deviceName: `${browserName} on ${platformName}`,
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

      {showRegistrationSuccessModal ? (
        <ConfirmModal
          title="Device Registered Successfully"
          description="Your device has been registered for push notifications. You will now receive notifications for alerts, incidents, and other important events."
          submitButtonType={ButtonStyleType.SUCCESS}
          submitButtonText="Close"
          onSubmit={() => {
            setShowRegistrationSuccessModal(false);
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
