import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Button, {
  BOXED_BUTTON_CLASS_NAME,
  BOXED_BUTTON_HOVER_CLASS_NAMES,
  BOXED_BUTTON_LOOK_CLASS_NAMES,
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import QRCodeElement from "Common/UI/Components/QR/QR";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import prefersTouch from "Common/UI/Utils/PrefersTouch";
import User from "Common/UI/Utils/User";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import React, { ReactElement, useEffect, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Toast from "Common/UI/Utils/Toast";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";
import NotificationChannelOffPanel from "./NotificationChannelOffPanel";
import {
  isAddingOffered,
  ProjectChannelState,
  useProjectChannelState,
} from "./ProjectNotificationChannels";
import {
  ChannelGatedMethodList,
  getChannelGatedMethodList,
  ProjectNotificationChannel,
} from "./ProjectNotificationChannelsCopy";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

interface VerificationInfo {
  verificationCode: string;
  telegramBotUsername: string;
  isVerified: boolean;
  deepLinkUrl: string;
  startCommand: string;
}

/*
 * Open in Telegram: a link - an address the phone hands to its Telegram app,
 * and a person can long-press or copy - drawn as the shared plain button
 * (Button's frame, NORMAL's colours, hover and size), 44px under a finger.
 * It was a hand-drawn indigo button beside the dialog's one primary action,
 * "I've sent the message — check" (#10916).
 */
export const OPEN_IN_TELEGRAM_CLASS_NAME: string = [
  BOXED_BUTTON_CLASS_NAME,
  BOXED_BUTTON_LOOK_CLASS_NAMES[ButtonStyleType.NORMAL],
  BOXED_BUTTON_HOVER_CLASS_NAMES[ButtonStyleType.NORMAL],
  ButtonSize.Normal,
  "transition-colors duration-150 ease-out [@media(pointer:coarse)]:min-h-11",
].join(" ");

const Telegram: () => JSX.Element = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showVerificationModal, setShowVerificationModal] =
    useState<boolean>(false);
  const [verificationInfo, setVerificationInfo] =
    useState<VerificationInfo | null>(null);
  const [verificationError, setVerificationError] = useState<string>("");
  /*
   * The deep link whose QR code could not be drawn (#6653): the code's
   * place then says so, and "Scan on phone" under it would say the
   * opposite. Kept by link, so a new one - after Rotate Code - is drawn and
   * captioned again.
   */
  const [failedQrLink, setFailedQrLink] = useState<string | null>(null);
  /*
   * Whether the reader's main pointer is a finger: a phone or a tablet, as
   * the authenticator app's setup asks (#6651). A phone cannot scan its own
   * screen, so there the dialog leads with Open in Telegram, which opens the
   * app on it, and draws no QR code to scan nor a caption saying to scan it
   * (#10916). A screen worked with a mouse keeps the code, for the phone in
   * the person's hand.
   */
  const [isOnATouchScreen] = useState<boolean>(prefersTouch);
  const [isLoadingVerification, setIsLoadingVerification] =
    useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  const [showResendCodeModal, setShowResendCodeModal] =
    useState<boolean>(false);
  const [resendError, setResendError] = useState<string>("");
  const [isResendLoading, setIsResendLoading] = useState<boolean>(false);

  const [currentItem, setCurrentItem] = useState<UserTelegram | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * Whether the project has Telegram on. While it is off the server refuses
   * a new account, so the list offers no Add button: the panel at its top
   * says so, with the switch itself for those who may turn it on.
   */
  const channelState: ProjectChannelState = useProjectChannelState(
    ProjectNotificationChannel.Telegram,
  );
  const isChannelOff: boolean = channelState === ProjectChannelState.Off;

  useEffect(() => {
    if (!showVerificationModal) {
      setVerificationError("");
      setIsPolling(false);
      // Opened again, the code is drawn again, and captioned until it fails.
      setFailedQrLink(null);
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
          // Said in the corner: it was a dialog to click away (#9120).
          Toast.success(
            translator.translateText("Telegram account verified") ||
              "Telegram account verified",
            {
              description: translator.translateText(
                "You'll now receive OneUptime notifications in Telegram. You can manage event-level toggles under User Settings → Notification Settings.",
              ),
            },
          );
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

  /*
   * Unlinking a Telegram account cascades to every notification rule that
   * messages it, so the confirmation is the impact modal rather than
   * ModelTable's generic one, and the built-in delete is switched off so there
   * is only one way in.
   */
  const deleteGuard: NotificationMethodDeleteGuard<UserTelegram> =
    useNotificationMethodDeleteGuard<UserTelegram>({
      modelType: UserTelegram,
      relationName: "userTelegram",
      singularName: "Telegram Account",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

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
            /*
             * Verifying is what an unverified row is waiting on. Without this
             * the NORMAL-styled code action beside it would take the row's
             * button and bury Verify in the menu.
             */
            placement: ActionButtonPlacement.Primary,
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
          deleteGuard.deleteActionButton,
        ]}
        id="user-telegram"
        name="User Settings > Notification Methods > Telegram"
        isDeleteable={false}
        isEditable={false}
        isCreateable={isAddingOffered(channelState)}
        topContent={
          <NotificationChannelOffPanel
            list={ChannelGatedMethodList.Telegram}
            state={channelState}
          />
        }
        cardProps={{
          title: "Telegram Accounts for Notifications",
          description:
            "Link your Telegram account to receive OneUptime notifications via our bot.",
        }}
        noItemsMessage={
          isChannelOff
            ? getChannelGatedMethodList(ChannelGatedMethodList.Telegram)
                .noItemsWhileOff
            : "No Telegram accounts linked. Add one and scan the QR or open the deep link to connect."
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

      {showVerificationModal && currentItem ? (
        <Modal
          title={"Verify Telegram Account"}
          onClose={() => {
            setShowVerificationModal(false);
          }}
          modalWidth={ModalWidth.Medium}
          closeButtonText="Close"
        >
          <div className="space-y-4">
            {isLoadingVerification && !verificationInfo ? (
              <p className="text-sm text-gray-600">
                {translator.translateText("Loading verification details…")}
              </p>
            ) : null}
            {verificationError ? (
              <p className="text-sm text-red-600">
                <ErrorInSentence
                  message={verificationError}
                  showWhereToLook={true}
                />
              </p>
            ) : null}
            {verificationInfo ? (
              <>
                <p className="text-sm text-gray-700">
                  {translator.translateText(
                    "To verify, message our bot in Telegram. Pick whichever option is easiest:",
                  )}
                </p>
                {/* The code a phone scans: not drawn on the phone itself. */}
                {isOnATouchScreen ? null : (
                  <div
                    className="flex flex-col items-center space-y-2"
                    data-testid="telegram-qr"
                  >
                    <QRCodeElement
                      text={verificationInfo.deepLinkUrl}
                      onError={() => {
                        setFailedQrLink(verificationInfo.deepLinkUrl);
                      }}
                    />
                    {failedQrLink !== verificationInfo.deepLinkUrl ? (
                      <p
                        className="text-xs text-gray-500"
                        data-testid="telegram-qr-caption"
                      >
                        {translator.translateText(
                          "Scan on phone to open Telegram",
                        )}
                      </p>
                    ) : null}
                  </div>
                )}
                <div className="flex flex-col space-y-2">
                  <a
                    href={verificationInfo.deepLinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="telegram-open-link"
                    className={OPEN_IN_TELEGRAM_CLASS_NAME}
                  >
                    <Icon
                      icon={IconProp.ExternalLink}
                      className="me-1 h-5 w-5"
                    />
                    {translator.translateText("Open in Telegram")}
                  </a>
                  {/* Where Telegram opens from a laptop; a phone has the app. */}
                  {isOnATouchScreen ? null : (
                    <p className="text-xs text-gray-500 text-center">
                      {translator.translateText(
                        "Works on desktop if you have Telegram Desktop installed, or via web.telegram.org.",
                      )}
                    </p>
                  )}
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                  <p className="font-medium text-gray-700">
                    {/* "Either" is the code and the link: a phone has only the link. */}
                    {translator.translateText(
                      isOnATouchScreen
                        ? "Can't use the link? Open Telegram manually:"
                        : "Can't use either? Open Telegram manually:",
                    )}
                  </p>
                  {/* The numbers' room at the start: the right, read from the right. */}
                  <ol className="mt-2 list-decimal ps-5 text-gray-600">
                    <li>
                      <TranslatedSentence
                        template="Search for {{botUsername}}"
                        slots={{
                          botUsername: (
                            <span className="font-mono">
                              @{verificationInfo.telegramBotUsername}
                            </span>
                          ),
                        }}
                      />
                    </li>
                    <li>
                      <TranslatedSentence
                        template="Send {{command}}"
                        slots={{
                          command: (
                            <span className="font-mono">
                              {verificationInfo.startCommand}
                            </span>
                          ),
                        }}
                      />
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
            "This makes a new verification code. Earlier QR codes and links stop working, so open the verify screen again."
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
    </>
  );
};

export default Telegram;
