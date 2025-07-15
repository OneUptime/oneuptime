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
import { APP_API_URL } from "Common/UI/Config";
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

  useEffect(() => {
    setError("");
  }, [showRegisterDeviceModal]);

  const registerDeviceForPushNotifications = async (): Promise<void> => {
    try {
      setIsLoading(true);

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setError("Push notifications are not supported in this browser.");
        return;
      }

      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Permission to show notifications was denied.");
        return;
      }

      // Register service worker
      const swRegistration = await navigator.serviceWorker.register("/sw.js");
      
      // Get push subscription
      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env["REACT_APP_VAPID_PUBLIC_KEY"] || "",
      });

      // Detect device type
      const userAgent = navigator.userAgent;
      let deviceType: "web" | "android" | "ios" = "web";
      
      if (/android/i.test(userAgent)) {
        deviceType = "android";
      } else if (/iPad|iPhone|iPod/.test(userAgent)) {
        deviceType = "ios";
      }

      // Create device registration through API
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
        URL.fromString(APP_API_URL.toString()).addRoute("/user-push/register"),
        {
          projectId: ProjectUtil.getCurrentProjectId()!,
          deviceToken: JSON.stringify(subscription),
          deviceType: deviceType,
          deviceName: `${navigator.platform} - ${navigator.userAgent.split(" ")[0]}`,
        },
      );

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        return;
      }

      setShowRegistrationSuccessModal(true);
      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    } catch (err: any) {
      setError(err.message || "Failed to register device for push notifications");
    } finally {
      setIsLoading(false);
    }
  };

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
        createVerb={"Register Device"}
        onBeforeCreate={async (_model: UserPush): Promise<UserPush> => {
          // Instead of normal create, trigger our custom registration flow
          setShowRegisterDeviceModal(true);
          throw new Error("Use custom registration flow");
        }}
        actionButtons={[
          {
            title: "Test Notification",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Bell,
            isVisible: (item: UserPush): boolean => {
              return item.isVerified === true;
            },
            onClick: async (
              item: UserPush,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                // Send test notification
                const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
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
            "Manage devices that will receive push notifications for this project. Push notifications work on modern browsers and mobile devices.",
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
              deviceType: true,
            },
            title: "Type",
            type: FieldType.Text,
          },
          {
            field: {
              lastUsedAt: true,
            },
            title: "Last Used",
            type: FieldType.DateTime,
          },
          {
            field: {
              isVerified: true,
            },
            title: "Status",
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

      {showRegisterDeviceModal ? (
        <BasicFormModal
          title="Register Device for Push Notifications"
          description="This will register your current device to receive push notifications from OneUptime. You'll be asked for permission to show notifications."
          isLoading={isLoading}
          submitButtonText="Register Device"
          onClose={() => {
            setShowRegisterDeviceModal(false);
            setError("");
          }}
          onSubmit={registerDeviceForPushNotifications}
          formProps={{
            name: "Register Device",
            error: error || "",
            fields: [
              {
                field: {
                  info: true,
                },
                title: "Push Notification Support",
                description: "Push notifications will work on modern web browsers (Chrome, Firefox, Safari, Edge) and mobile devices through your browser.",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                placeholder: "",
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
    </>
  );
};

export default Push;
