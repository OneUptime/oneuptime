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
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
import React, { ReactElement, useEffect, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";

const WhatsApp: () => JSX.Element = (): ReactElement => {
  const [showVerificationCodeModal, setShowVerificationCodeModal] =
    useState<boolean>(false);

  const [showResendCodeModal, setShowResendCodeModal] =
    useState<boolean>(false);

  const [verificationError, setVerificationError] = useState<string>("");
  const [resendError, setResendError] = useState<string>("");
  const [currentItem, setCurrentItem] = useState<UserWhatsApp | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [showVerificationCodeResentModal, setShowVerificationCodeResentModal] =
    useState<boolean>(false);

  useEffect(() => {
    setVerificationError("");
  }, [showVerificationCodeModal]);

  useEffect(() => {
    if (!showResendCodeModal) {
      setResendError("");
    }
  }, [showResendCodeModal]);

  /*
   * Deleting a WhatsApp number cascades to every notification rule that uses
   * it, so the confirmation is the impact modal rather than ModelTable's
   * generic one, and the built-in delete is switched off so there is only one
   * way in.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserWhatsApp> =
    useNotificationMethodDeleteGuard<UserWhatsApp>({
      modelType: UserWhatsApp,
      relationName: "userWhatsApp",
      singularName: "WhatsApp Number",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  return (
    <>
      <ModelTable<UserWhatsApp>
        modelType={UserWhatsApp}
        userPreferencesKey={"user-whatsapp-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserWhatsApp): Promise<UserWhatsApp> => {
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
            isVisible: (item: UserWhatsApp): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            onClick: async (
              item: UserWhatsApp,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentItem(item);
                setShowVerificationCodeModal(true);
                setVerificationError("");
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
            isVisible: (item: UserWhatsApp): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            onClick: async (
              item: UserWhatsApp,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentItem(item);
                setResendError("");
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
        id="user-whatsapp"
        name="User Settings > Notification Methods > WhatsApp"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        cardProps={{
          title: "WhatsApp Numbers for Notifications",
          description:
            "Manage WhatsApp numbers that will receive notifications for this project.",
        }}
        noItemsMessage={
          "No WhatsApp numbers found. Please add one to receive notifications."
        }
        formFields={[
          {
            field: {
              phone: true,
            },
            title: "WhatsApp Number",
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
            title: "WhatsApp Number",
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
          title={"Verify WhatsApp Number"}
          onClose={() => {
            setShowVerificationCodeModal(false);
          }}
          error={verificationError}
          isLoading={isLoading}
          submitButtonText={"Verify"}
          onSubmit={async (item: JSONObject) => {
            setIsLoading(true);
            setVerificationError("");
            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/user-whatsapp/verify",
                  ),
                  data: {
                    code: item["code"],
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    itemId: currentItem["_id"],
                  },
                });

              if (response.isFailure()) {
                setVerificationError(API.getFriendlyMessage(response));
                setIsLoading(false);
              } else {
                setIsLoading(false);
                setShowVerificationCodeModal(false);
                setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
              }
            } catch (e) {
              setVerificationError(API.getFriendlyMessage(e));
              setIsLoading(false);
            }
          }}
          formProps={{
            name: "Verify WhatsApp Number",

            fields: [
              {
                title: "Verification Code",
                description:
                  "We have sent a WhatsApp message with your verification code.",
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
          error={resendError}
          description={
            "Are you sure you want to resend the WhatsApp verification code?"
          }
          submitButtonText={"Resend Code"}
          onClose={() => {
            setShowResendCodeModal(false);
            setResendError("");
          }}
          isLoading={isLoading}
          onSubmit={async () => {
            setIsLoading(true);
            setResendError("");
            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/user-whatsapp/resend-verification-code",
                  ),
                  data: {
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    itemId: currentItem["_id"],
                  },
                });

              if (response.isFailure()) {
                setResendError(API.getFriendlyMessage(response));
                setIsLoading(false);
              } else {
                setIsLoading(false);
                setShowResendCodeModal(false);
                setShowVerificationCodeResentModal(true);
              }
            } catch (err) {
              setResendError(API.getFriendlyMessage(err));
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
          error={resendError}
          description={`We have sent a verification code via WhatsApp.`}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowVerificationCodeResentModal(false);
            setResendError("");
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default WhatsApp;
