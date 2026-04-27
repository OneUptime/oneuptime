import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import QRCodeElement from "Common/UI/Components/QR/QR";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import User from "Common/UI/Utils/User";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import React, { ReactElement, useEffect, useState } from "react";
import OneUptimeDate from "Common/Types/Date";

interface VerificationInfo {
  verificationCode: string;
  telegramBotUsername: string;
  isVerified: boolean;
  deepLinkUrl: string;
  startCommand: string;
}

const Telegram: () => JSX.Element = (): ReactElement => {
  const [showVerificationModal, setShowVerificationModal] =
    useState<boolean>(false);
  const [verificationInfo, setVerificationInfo] =
    useState<VerificationInfo | null>(null);
  const [verificationError, setVerificationError] = useState<string>("");
  const [isLoadingVerification, setIsLoadingVerification] =
    useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  const [showResendCodeModal, setShowResendCodeModal] =
    useState<boolean>(false);
  const [resendError, setResendError] = useState<string>("");
  const [isResendLoading, setIsResendLoading] = useState<boolean>(false);

  const [showVerifiedModal, setShowVerifiedModal] = useState<boolean>(false);

  const [currentItem, setCurrentItem] = useState<UserTelegram | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  useEffect(() => {
    if (!showVerificationModal) {
      setVerificationError("");
      setIsPolling(false);
    }
  }, [showVerificationModal]);

  useEffect(() => {
    if (!showResendCodeModal) {
      setResendError("");
    }
  }, [showResendCodeModal]);

  const fetchVerificationInfo: (item: UserTelegram) => Promise<void> = async (
    item: UserTelegram,
  ): Promise<void> => {
    setIsLoadingVerification(true);
    setVerificationError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-telegram/verification-info",
          ),
          data: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            itemId: item["_id"],
          },
        });

      if (response.isFailure()) {
        setVerificationError(API.getFriendlyMessage(response));
        setVerificationInfo(null);
      } else {
        const data: JSONObject = response.data as JSONObject;
        setVerificationInfo({
          verificationCode: data["verificationCode"] as string,
          telegramBotUsername: data["telegramBotUsername"] as string,
          isVerified: data["isVerified"] as boolean,
          deepLinkUrl: data["deepLinkUrl"] as string,
          startCommand: data["startCommand"] as string,
        });
      }
    } catch (err) {
      setVerificationError(API.getFriendlyMessage(err));
      setVerificationInfo(null);
    }
    setIsLoadingVerification(false);
  };

  const pollForVerification: () => Promise<void> = async (): Promise<void> => {
    if (!currentItem || !currentItem["_id"]) {
      return;
    }
    setIsPolling(true);
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-telegram/verification-info",
          ),
          data: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            itemId: currentItem["_id"],
          },
        });

      if (!response.isFailure()) {
        const data: JSONObject = response.data as JSONObject;
        if (data["isVerified"]) {
          setShowVerificationModal(false);
          setShowVerifiedModal(true);
          setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
        } else {
          setVerificationError(
            "Still waiting — please send /start to the bot in Telegram.",
          );
        }
      }
    } catch (err) {
      setVerificationError(API.getFriendlyMessage(err));
    }
    setIsPolling(false);
  };

  return (
    <>
      <ModelTable<UserTelegram>
        modelType={UserTelegram}
        userPreferencesKey={"user-telegram-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserTelegram): Promise<UserTelegram> => {
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
            isVisible: (item: UserTelegram): boolean => {
              return !item["isVerified"];
            },
            onClick: async (
              item: UserTelegram,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentItem(item);
                setShowVerificationModal(true);
                await fetchVerificationInfo(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          {
            title: "Rotate Code",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            isVisible: (item: UserTelegram): boolean => {
              return !item["isVerified"];
            },
            onClick: async (
              item: UserTelegram,
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
        ]}
        id="user-telegram"
        name="User Settings > Notification Methods > Telegram"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        cardProps={{
          title: "Telegram Accounts for Notifications",
          description:
            "Link your Telegram account to receive OneUptime notifications via our bot.",
        }}
        noItemsMessage={
          "No Telegram accounts linked. Add one and scan the QR or open the deep link to connect."
        }
        formFields={[
          {
            field: {
              telegramUserHandle: true,
            },
            title: "Telegram Handle (optional)",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "@alice",
            description:
              "Only for your own reference. The actual chat is captured automatically when you verify.",
          },
        ]}
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              telegramUserHandle: true,
            },
            title: "Handle",
            type: FieldType.Text,
            noValueMessage: "-",
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

      {showVerificationModal && currentItem ? (
        <Modal
          title={"Verify Telegram Account"}
          onClose={() => {
            setShowVerificationModal(false);
          }}
          modalWidth={ModalWidth.Medium}
          submitButtonText={"Close"}
          onSubmit={() => {
            setShowVerificationModal(false);
          }}
        >
          <div className="space-y-4">
            {isLoadingVerification && !verificationInfo ? (
              <p className="text-sm text-gray-600">
                Loading verification details…
              </p>
            ) : null}
            {verificationError ? (
              <p className="text-sm text-red-600">{verificationError}</p>
            ) : null}
            {verificationInfo ? (
              <>
                <p className="text-sm text-gray-700">
                  To verify, message our bot in Telegram. Pick whichever option
                  is easiest:
                </p>
                <div className="flex flex-col items-center space-y-2">
                  <QRCodeElement text={verificationInfo.deepLinkUrl} />
                  <p className="text-xs text-gray-500">
                    Scan on phone to open Telegram
                  </p>
                </div>
                <div className="flex flex-col space-y-2">
                  <a
                    href={verificationInfo.deepLinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-center inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    Open in Telegram
                  </a>
                  <p className="text-xs text-gray-500 text-center">
                    Works on desktop if you have Telegram Desktop installed, or
                    via web.telegram.org.
                  </p>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                  <p className="font-medium text-gray-700">
                    Can&apos;t use either? Open Telegram manually:
                  </p>
                  <ol className="mt-2 list-decimal pl-5 text-gray-600">
                    <li>
                      Search for{" "}
                      <span className="font-mono">
                        @{verificationInfo.telegramBotUsername}
                      </span>
                    </li>
                    <li>
                      Send{" "}
                      <span className="font-mono">
                        {verificationInfo.startCommand}
                      </span>
                    </li>
                  </ol>
                </div>
                <div className="flex justify-center">
                  <Button
                    title={
                      isPolling ? "Checking…" : "I've sent the message — check"
                    }
                    buttonStyle={ButtonStyleType.PRIMARY}
                    onClick={pollForVerification}
                    disabled={isPolling}
                  />
                </div>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {showResendCodeModal && currentItem ? (
        <ConfirmModal
          title={`Rotate Verification Code`}
          error={resendError}
          description={
            "This generates a new verification code. Any QR or deep link you opened previously will stop working — you'll need to re-open the verify screen after rotating."
          }
          submitButtonText={"Rotate Code"}
          onClose={() => {
            setShowResendCodeModal(false);
            setResendError("");
          }}
          isLoading={isResendLoading}
          onSubmit={async () => {
            setIsResendLoading(true);
            setResendError("");
            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/user-telegram/resend-verification-code",
                  ),
                  data: {
                    projectId: ProjectUtil.getCurrentProjectId()!,
                    itemId: currentItem["_id"],
                  },
                });

              if (response.isFailure()) {
                setResendError(API.getFriendlyMessage(response));
                setIsResendLoading(false);
              } else {
                setIsResendLoading(false);
                setShowResendCodeModal(false);
                setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
              }
            } catch (err) {
              setResendError(API.getFriendlyMessage(err));
              setIsResendLoading(false);
            }
          }}
        />
      ) : null}

      {showVerifiedModal ? (
        <ConfirmModal
          title={`Telegram account verified`}
          description={
            "You'll now receive OneUptime notifications in Telegram. You can manage event-level toggles under User Settings → Notification Settings."
          }
          submitButtonText={"Great"}
          onSubmit={async () => {
            setShowVerifiedModal(false);
          }}
        />
      ) : null}
    </>
  );
};

export default Telegram;
