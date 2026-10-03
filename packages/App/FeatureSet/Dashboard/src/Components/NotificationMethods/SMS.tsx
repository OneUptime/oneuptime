import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import User from "Common/UI/Utils/User";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import React, { ReactElement, useEffect, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";
import NotificationChannelOffPanel from "./NotificationChannelOffPanel";
import {
  isAddingOffered,
  isCodeResendOffered,
  ProjectChannelState,
  useProjectChannelState,
} from "./ProjectNotificationChannels";
import {
  ChannelGatedMethodList,
  getChannelGatedMethodList,
  ProjectNotificationChannel,
} from "./ProjectNotificationChannelsCopy";

const SMS: () => JSX.Element = (): ReactElement => {
  const [showVerificationCodeModal, setShowVerificationCodeModal] =
    useState<boolean>(false);

  const [showResendCodeModal, setShowResendCodeModal] =
    useState<boolean>(false);

  const [error, setError] = useState<string>("");
  const [currentItem, setCurrentItem] = useState<UserSMS | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [showVerificationCodeResentModal, setShowVerificationCodeResentModal] =
    useState<boolean>(false);

  /*
   * Whether the project has SMS on. While it is off the server refuses a
   * new number and a code sent again, so the list offers neither: the panel
   * at its top says so, with the switch itself for those who may turn it on.
   */
  const channelState: ProjectChannelState = useProjectChannelState(
    ProjectNotificationChannel.SMS,
  );
  const isChannelOff: boolean = channelState === ProjectChannelState.Off;

  useEffect(() => {
    setError("");
  }, [showVerificationCodeModal]);

  /*
   * Deleting a phone number cascades to every notification rule that uses it,
   * so the confirmation is the impact modal rather than ModelTable's generic
   * one, and the built-in delete is switched off so there is only one way in.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserSMS> =
    useNotificationMethodDeleteGuard<UserSMS>({
      modelType: UserSMS,
      relationName: "userSms",
      singularName: "Phone Number",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  return (
    <>
      <ModelTable<UserSMS>
        modelType={UserSMS}
        userPreferencesKey={"user-sms-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserSMS): Promise<UserSMS> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        createVerb={"Add"}
        actionButtons={[
          {
            title: "Verify",
            buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
            icon: IconProp.Check,
            /*
             * Entering the code is what an unverified row is waiting for, so
             * Verify is the row's button and Resend Code (styled NORMAL, which
             * would otherwise win) goes in the ⋯ menu.
             */
            placement: ActionButtonPlacement.Primary,
            isVisible: (item: UserSMS): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            onClick: async (
              item: UserSMS,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentItem(item);
                setShowVerificationCodeModal(true);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          {
            title: "Resend Code",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.SMS,
            isVisible: (item: UserSMS): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              // The server refuses to send a code while SMS is off.
              return isCodeResendOffered(
                ProjectNotificationChannel.SMS,
                channelState,
              );
            },
            onClick: async (
              item: UserSMS,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentItem(item);
                setShowResendCodeModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          deleteGuard.deleteActionButton,
        ]}
        id="user-sms"
        name="User Settings > Notification Methods > SMS"
        isDeleteable={false}
        isEditable={false}
        isCreateable={isAddingOffered(channelState)}
        topContent={
          <NotificationChannelOffPanel
            list={ChannelGatedMethodList.SMS}
            state={channelState}
          />
        }
        cardProps={{
          title: "Phone Numbers for SMS Notifications",
          description:
            "Manage Phone Numbers that will receive SMS notifications for this project.",
        }}
        noItemsMessage={
          isChannelOff
            ? getChannelGatedMethodList(ChannelGatedMethodList.SMS)
                .noItemsWhileOff
            : "No phone numbers found. Please add one to receive notifications."
        }
        formFields={[
          {
            field: {
              phone: true,
            },
            title: "Phone Number",
            fieldType: FormFieldSchemaType.Phone,
            required: true,
            placeholder: "+11234567890",
            validation: {
              minLength: 2,
            },
            disableSpellCheck: true,
          },
        ]}
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              phone: true,
            },
            title: "Phone Number",
            type: FieldType.Phone,
          },
          {
            field: {
              isVerified: true,
            },
            title: "Verified",
            type: FieldType.Boolean,
          },
        ]}
      />

      {deleteGuard.deletionModal}

      {showVerificationCodeModal && currentItem ? (
        <BasicFormModal
          title={"Verify Phone Number"}
          onClose={() => {
            setShowVerificationCodeModal(false);
          }}
          isLoading={isLoading}
          submitButtonText={"Verify"}
          onSubmit={async (item: JSONObject) => {
            setIsLoading(true);
            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/user-sms/verify",
                  ),
                  data: {
                    code: item["code"],
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    itemId: currentItem["_id"],
                  },
                });

              if (response.isFailure()) {
                setError(API.getFriendlyMessage(response));
                setIsLoading(false);
              } else {
                setIsLoading(false);
                setShowVerificationCodeModal(false);
                setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
              }
            } catch (e) {
              setError(API.getFriendlyMessage(e));
              setIsLoading(false);
            }
          }}
          formProps={{
            name: "Verify Phone Number",
            error: error || "",
            fields: [
              {
                title: "Verification Code",
                description: `We have sent a SMS with your verification code. Please don't forget to check your spam.`,
                field: {
                  code: true,
                },
                placeholder: "123456",
                required: true,
                validation: {
                  minLength: 6,
                  maxLength: 6,
                },
                /*
                 * Text, not Number. A verification code is a six-character
                 * string that happens to be digits, and one in ten of them
                 * starts with a zero — which a numeric input silently eats,
                 * turning "012345" into "12345". That was always wrong; it
                 * matters more now that a code only gets five attempts before
                 * it is burned, so a mangled entry costs the user their
                 * budget for a mistake the form made.
                 */
                fieldType: FormFieldSchemaType.Text,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {showResendCodeModal && currentItem ? (
        <ConfirmModal
          title={`Resend Code`}
          error={error}
          description={"Are you sure you want to resend verification code?"}
          submitButtonText={"Resend Code"}
          onClose={() => {
            setShowResendCodeModal(false);
            setError("");
          }}
          isLoading={isLoading}
          onSubmit={async () => {
            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/user-sms/resend-verification-code",
                  ),
                  data: {
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    itemId: currentItem["_id"],
                  },
                });

              if (response.isFailure()) {
                setError(API.getFriendlyMessage(response));
                setIsLoading(false);
              } else {
                setIsLoading(false);
                setShowResendCodeModal(false);
                setShowVerificationCodeResentModal(true);
              }
            } catch (err) {
              setError(API.getFriendlyMessage(err));
              setIsLoading(false);
            }
          }}
        />
      ) : (
        <></>
      )}

      {showVerificationCodeResentModal ? (
        <ConfirmModal
          title={`Code sent successfully`}
          error={error}
          description={`We have sent a verification code via SMS. Please don't forget to check your spam.`}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowVerificationCodeResentModal(false);
            setError("");
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SMS;
