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

const WhatsApp: () => JSX.Element = (): ReactElement => {
  const [showVerificationCodeModal, setShowVerificationCodeModal] =
    useState<boolean>(false);

  const [showResendCodeModal, setShowResendCodeModal] =
    useState<boolean>(false);

  const [error, setError] = useState<string>("");
  const [currentItem, setCurrentItem] = useState<UserWhatsApp | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [showVerificationCodeResentModal, setShowVerificationCodeResentModal] =
    useState<boolean>(false);

  useEffect(() => {
    setError("");
  }, [showVerificationCodeModal]);

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
                setShowResendCodeModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        id="user-whatsapp"
        name="User Settings > Notification Methods > WhatsApp"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        cardProps={{
          title: "Phone Numbers for WhatsApp Notifications",
          description:
            "Manage Phone Numbers that will receive WhatsApp notifications for this project.",
        }}
        noItemsMessage={
          "No phone numbers found. Please add one to receive notifications."
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
                await API.post(
                  URL.fromString(APP_API_URL.toString()).addRoute(
                    "/user-whatsapp/verify",
                  ),
                  {
                    code: item["code"],
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    itemId: currentItem["_id"],
                  },
                );

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
                description: `We have sent a WhatsApp message with your verification code. Please check your WhatsApp.`,
                field: {
                  code: true,
                },
                placeholder: "123456",
                required: true,
                validation: {
                  minLength: 6,
                  maxLength: 6,
                },
                fieldType: FormFieldSchemaType.Number,
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
                await API.post(
                  URL.fromString(APP_API_URL.toString()).addRoute(
                    "/user-whatsapp/resend-verification-code",
                  ),
                  {
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    itemId: currentItem["_id"],
                  },
                );

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
          description={`We have sent a verification code via WhatsApp. Please check your WhatsApp messages.`}
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

export default WhatsApp;