import PageComponentProps from "../../PageComponentProps";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import BackupCodes from "../../../Components/TwoFactorAuth/BackupCodes";
import WebAuthnCredentials from "../../../Components/TwoFactorAuth/WebAuthnCredentials";
import TwoFactorStatus from "../../../Components/TwoFactorAuth/TwoFactorStatus";
import { getSecondStepDeleteDisabledReason } from "../../../Components/TwoFactorAuth/TwoFactorAuthSetupState";
import { LocalSignInSettings } from "../../../Components/UserProfile/SignInManagement";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { TwoFactorAuthSetup } from "Common/Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "Common/Types/TwoFactorAuthStatus";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "Common/UI/Utils/User";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import AuthenticatorAppSetupCode from "Common/UI/Components/AuthenticatorAppSetupCode/AuthenticatorAppSetupCode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CardSelect from "Common/UI/Components/CardSelect/CardSelect";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Modal from "Common/UI/Components/Modal/Modal";
import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";

/*
 * ENABLE STARTS WITH A SECOND STEP (issue #9666).
 *
 * Enable used to switch two-factor authentication on whatever stood behind
 * it. With nothing set up, it now opens a short guided setup instead: pick
 * an authenticator app (scan a QR code, type its code) or a security key
 * (follow the browser's prompt), and two-factor authentication is turned on
 * only once that step works. The same setup finishes an account that is on
 * with nothing behind it (Setup needed). Each step is the one its own card
 * uses, so there is one way to add an app and one way to add a key.
 */
type SecondStep = "authenticator-app" | "security-key";

export const SECOND_STEP_SETUP_COPY: {
  title: string;
  description: string;
  authenticatorApp: string;
  authenticatorAppDescription: string;
  securityKey: string;
  securityKeyDescription: string;
  done: string;
} = {
  title: translationKey("Set up two-factor authentication"),
  description: translationKey(
    "Choose your second step. You can add more later.",
  ),
  authenticatorApp: translationKey("Authenticator app"),
  authenticatorAppDescription: translationKey(
    "Get a one-time code from an app such as 1Password, Google Authenticator, or Microsoft Authenticator.",
  ),
  securityKey: translationKey("Security key"),
  securityKeyDescription: translationKey(
    "Use a security key as the second step after your password, with no code to type.",
  ),
  done: translationKey("Two-factor authentication is on."),
};

const TwoFactorAuth: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [selectedTotpAuth, setSelectedTotpAuth] =
    React.useState<UserTotpAuth | null>(null);
  const [showVerificationModal, setShowVerificationModal] =
    React.useState<boolean>(false);
  const [verificationError, setVerificationError] = React.useState<string>("");
  const [verificationLoading, setVerificationLoading] =
    React.useState<boolean>(false);
  const [setupLoading, setSetupLoading] = React.useState<boolean>(false);
  const [verificationCode, setVerificationCode] = React.useState<string>("");
  const [verificationSuccess, setVerificationSuccess] =
    React.useState<string>("");
  const [tableRefreshToggle, setTableRefreshToggle] =
    React.useState<string>("0");
  const [authenticatorCount, setAuthenticatorCount] = React.useState<
    number | null
  >(null);
  // Enrollment responses contain the only plaintext copy of recovery codes.
  const [enrolmentBackupCodes, setEnrolmentBackupCodes] = React.useState<
    Array<string>
  >([]);

  /*
   * Where the person stands (TwoFactorStatus reads it), read again whenever
   * a second step is added or removed or the switch is flipped.
   */
  const [statusRefresh, setStatusRefresh] = React.useState<number>(0);
  const [setup, setSetup] = React.useState<TwoFactorAuthSetup | null>(null);

  // The guided setup: its choice, and whether to turn it on at the end.
  const [showSecondStepChooser, setShowSecondStepChooser] =
    React.useState<boolean>(false);
  const [secondStep, setSecondStep] =
    React.useState<SecondStep>("authenticator-app");
  const [isStartingSecondStep, setIsStartingSecondStep] =
    React.useState<boolean>(false);
  const [secondStepError, setSecondStepError] = React.useState<string>("");
  const [securityKeyRegistrationRequest, setSecurityKeyRegistrationRequest] =
    React.useState<number>(0);
  const turnOnAfterSetup: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);

  const verificationInProgress: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const setupController: React.MutableRefObject<AbortController | null> =
    React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      setupController.current?.abort();
    };
  }, []);

  const refreshStatus: () => void = (): void => {
    setStatusRefresh((value: number) => {
      return value + 1;
    });
  };

  const readBackupCodesFromResponse: (
    response: HTTPResponse<JSONObject>,
  ) => void = (response: HTTPResponse<JSONObject>): void => {
    const codes: Array<string> = (
      (response.data["backupCodes"] as Array<unknown> | undefined) || []
    ).map((code: unknown) => {
      return String(code);
    });
    if (codes.length > 0) {
      setEnrolmentBackupCodes(codes);
    }
  };

  /*
   * The end of the guided setup: the second step works, so two-factor
   * authentication is turned on - unless it is on already (Setup needed),
   * when the step that was missing is all it needed. Never fatal: the step
   * is saved either way, and the card offers Enable again if this fails.
   */
  const finishGuidedSetup: () => Promise<void> = async (): Promise<void> => {
    if (!turnOnAfterSetup.current) {
      return;
    }

    turnOnAfterSetup.current = false;

    try {
      if (setup?.status === TwoFactorAuthStatus.NotEnabled) {
        await ModelAPI.updateById<User>({
          modelType: User,
          id: UserUtil.getUserId(),
          data: { enableTwoFactorAuth: true },
        });
      }

      setVerificationSuccess(
        translator.translateText(SECOND_STEP_SETUP_COPY.done) as string,
      );
    } catch (error) {
      setSecondStepError(API.getFriendlyMessage(error));
    } finally {
      refreshStatus();
    }
  };

  const openVerification: (item: UserTotpAuth) => Promise<void> = async (
    item: UserTotpAuth,
  ): Promise<void> => {
    setupController.current?.abort();
    const controller: AbortController = new AbortController();
    setupController.current = controller;
    setSelectedTotpAuth(item);
    setVerificationCode("");
    setVerificationError("");
    setVerificationSuccess("");
    setShowVerificationModal(true);

    if (item.twoFactorOtpUrl) {
      setSetupLoading(false);
      return;
    }

    setSetupLoading(true);
    try {
      if (!item.id) {
        throw new Error(
          translator.translateText(
            "This authenticator could not be loaded. Close this window and choose Finish setup to try again.",
          ),
        );
      }
      const authenticator: UserTotpAuth | null =
        await ModelAPI.getItem<UserTotpAuth>({
          modelType: UserTotpAuth,
          id: item.id,
          select: { _id: true, name: true, twoFactorOtpUrl: true },
          requestOptions: { apiRequestOptions: { signal: controller.signal } },
        });
      if (!authenticator?.twoFactorOtpUrl) {
        throw new Error(
          translator.translateText(
            "This authenticator could not be loaded. Close this window and choose Finish setup to try again.",
          ),
        );
      }
      if (!controller.signal.aborted) {
        setSelectedTotpAuth(authenticator);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setVerificationError(API.getFriendlyMessage(error));
      }
    } finally {
      if (!controller.signal.aborted) {
        setSetupLoading(false);
      }
    }
  };

  /*
   * The guided setup's authenticator app: the one left unfinished last time,
   * so a QR code already scanned still works, or a new one named after its
   * kind (renamed from its card at any time).
   */
  const startAuthenticatorApp: () => Promise<void> =
    async (): Promise<void> => {
      const unfinished: ListResult<UserTotpAuth> =
        await ModelAPI.getList<UserTotpAuth>({
          modelType: UserTotpAuth,
          query: { userId: UserUtil.getUserId(), isVerified: false },
          select: { _id: true, name: true },
          sort: { createdAt: SortOrder.Descending },
          limit: 1,
          skip: 0,
        });

      let authenticator: UserTotpAuth | undefined = unfinished.data[0];

      if (!authenticator) {
        const newAuthenticator: UserTotpAuth = new UserTotpAuth();
        newAuthenticator.name = translator.translateText(
          SECOND_STEP_SETUP_COPY.authenticatorApp,
        ) as string;

        const response: HTTPResponse<
          JSONObject | JSONArray | UserTotpAuth | Array<UserTotpAuth>
        > = await ModelAPI.create<UserTotpAuth>({
          model: newAuthenticator,
          modelType: UserTotpAuth,
        });

        authenticator = response.data as UserTotpAuth;
        setTableRefreshToggle((previous: string) => {
          return String(Number(previous) + 1);
        });
      }

      await openVerification(authenticator);
    };

  const startSecondStep: () => Promise<void> = async (): Promise<void> => {
    if (isStartingSecondStep) {
      return;
    }

    setSecondStepError("");

    if (secondStep === "security-key") {
      turnOnAfterSetup.current = true;
      setShowSecondStepChooser(false);
      setSecurityKeyRegistrationRequest((value: number) => {
        return value + 1;
      });
      return;
    }

    setIsStartingSecondStep(true);
    try {
      turnOnAfterSetup.current = true;
      await startAuthenticatorApp();
      setShowSecondStepChooser(false);
    } catch (error) {
      turnOnAfterSetup.current = false;
      setSecondStepError(API.getFriendlyMessage(error));
    } finally {
      setIsStartingSecondStep(false);
    }
  };

  const verifyAuthenticator: () => Promise<void> = async (): Promise<void> => {
    if (
      verificationInProgress.current ||
      !selectedTotpAuth?.twoFactorOtpUrl ||
      !selectedTotpAuth.id
    ) {
      return;
    }
    if (!verificationCode.match(/^\d{6}$/)) {
      setVerificationError(
        translator.translateText(
          "Enter the 6-digit code from your authenticator app.",
        ) as string,
      );
      return;
    }

    verificationInProgress.current = true;
    setVerificationLoading(true);
    setVerificationError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-totp-auth/validate",
          ),
          data: { code: verificationCode, id: selectedTotpAuth.id.toString() },
        });
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
      // Preserve the codes before refreshing or dismissing setup.
      readBackupCodesFromResponse(response);
      setShowVerificationModal(false);
      setSelectedTotpAuth(null);
      setVerificationCode("");
      setVerificationSuccess(
        translator.translateText(
          "Authenticator app added. It is ready to use for two-factor authentication.",
        ) as string,
      );
      setTableRefreshToggle((previous: string) => {
        return String(Number(previous) + 1);
      });
      refreshStatus();
      await finishGuidedSetup();
    } catch (error) {
      setVerificationError(API.getFriendlyMessage(error));
    } finally {
      verificationInProgress.current = false;
      setVerificationLoading(false);
    }
  };

  const getDeleteDisabledReason: (item: {
    isVerified?: boolean | undefined;
  }) => string | undefined = (item: {
    isVerified?: boolean | undefined;
  }): string | undefined => {
    return getSecondStepDeleteDisabledReason({
      setup: setup,
      isVerified: item.isVerified,
    });
  };

  return (
    <div className="w-full min-w-0">
      <LocalSignInSettings>
        <TwoFactorStatus
          refreshToggle={statusRefresh}
          onSetupLoaded={setSetup}
          onStartSetup={() => {
            setSecondStepError("");
            setSecondStep("authenticator-app");
            setShowSecondStepChooser(true);
          }}
        />
        {secondStepError && !showSecondStepChooser && (
          <Alert
            title={secondStepError}
            type={AlertType.DANGER}
            className="mb-5"
          />
        )}
        <WebAuthnCredentials
          isPasskey={false}
          onBackupCodes={setEnrolmentBackupCodes}
          registrationRequest={securityKeyRegistrationRequest}
          onRegistered={() => {
            refreshStatus();
            void finishGuidedSetup();
          }}
          onRegistrationClosed={() => {
            turnOnAfterSetup.current = false;
          }}
          getDeleteDisabledReason={(item: UserWebAuthn) => {
            return getDeleteDisabledReason(item);
          }}
          onDeleted={refreshStatus}
        />
        {verificationSuccess && (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            <Icon
              icon={IconProp.CheckCircle}
              className="h-5 w-5 flex-shrink-0"
            />
            <span>{verificationSuccess}</span>
          </div>
        )}
        <ModelTable<UserTotpAuth>
          modelType={UserTotpAuth}
          name="Authenticator apps"
          id="totp-auth-table"
          userPreferencesKey="user-authenticator-apps-table"
          isDeleteable={true}
          getDeleteDisabledReason={(item: UserTotpAuth) => {
            return getDeleteDisabledReason(item);
          }}
          onItemDeleted={refreshStatus}
          refreshToggle={tableRefreshToggle}
          filters={[]}
          query={{ userId: UserUtil.getUserId() }}
          isEditable={true}
          editButtonText="Rename"
          showRefreshButton={false}
          disableColumnCustomization={true}
          disableUrlState={true}
          disablePagination={
            authenticatorCount !== null && authenticatorCount <= 10
          }
          onFetchSuccess={(_items: Array<UserTotpAuth>, totalCount: number) => {
            setAuthenticatorCount(totalCount);
          }}
          isCreateable={true}
          createVerb="Add"
          isViewable={false}
          cardProps={{
            title: "Authenticator apps",
            description:
              "Get a one-time code from an app such as 1Password, Google Authenticator, or Microsoft Authenticator.",
          }}
          noItemsMessage={
            <div className="px-4 py-7 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                <Icon icon={IconProp.DevicePhoneMobile} className="h-6 w-6" />
              </span>
              <p className="mt-3 font-medium text-gray-900">
                {translator.translateText("No authenticator apps added yet.")}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {translator.translateText(
                  "Add an app, scan the QR code, and enter a code to finish setup.",
                )}
              </p>
            </div>
          }
          singularName="authenticator app"
          pluralName="authenticator apps"
          onCreateSuccess={async (
            item: UserTotpAuth,
            modalType?: ModalType,
          ): Promise<UserTotpAuth> => {
            if (modalType === ModalType.Create) {
              await openVerification(item);
            }
            return item;
          }}
          actionButtons={[
            {
              title: "Finish setup",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Check,
              isVisible: (item: UserTotpAuth) => {
                return !item.isVerified;
              },
              onClick: async (
                item: UserTotpAuth,
                onCompleteAction: () => void,
              ) => {
                await openVerification(item);
                onCompleteAction();
              },
            },
          ]}
          formFields={[
            {
              field: { name: true },
              title: "App name",
              description:
                "Choose a name that helps you recognize this authenticator.",
              placeholder: "My authenticator app",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              customValidation: (values: FormValues<UserTotpAuth>) => {
                return String(values.name || "").trim()
                  ? null
                  : (translator.translateText(
                      "Enter a name for your authenticator app.",
                    ) as string);
              },
            },
          ]}
          selectMoreFields={{ twoFactorOtpUrl: true }}
          columns={[
            {
              field: { name: true },
              title: "Name",
              type: FieldType.Text,
              wrapContent: true,
              // A mark beside the name: the name reads its own way, the cell the page's.
              getLineText: drawsItsOwnLines,
              getElement: (item: UserTotpAuth): ReactElement => {
                return (
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                      <Icon
                        icon={IconProp.DevicePhoneMobile}
                        className="h-5 w-5"
                      />
                    </span>
                    <span className="font-medium text-gray-900">
                      <IsolatedText text={item.name || ""} />
                    </span>
                  </div>
                );
              },
            },
            {
              field: { isVerified: true },
              title: "Status",
              type: FieldType.Boolean,
              getElement: (item: UserTotpAuth): ReactElement => {
                return (
                  <Pill
                    text={item.isVerified ? "Ready" : "Setup incomplete"}
                    tone={item.isVerified ? PillTone.Success : PillTone.Warning}
                    icon={item.isVerified ? IconProp.CheckCircle : undefined}
                  />
                );
              },
            },
            {
              field: { createdAt: true },
              title: "Date added",
              type: FieldType.DateTime,
              hideOnMobile: true,
            },
          ]}
        />
        <BackupCodes
          codesFromEnrolment={enrolmentBackupCodes}
          onEnrolmentCodesAcknowledged={() => {
            setEnrolmentBackupCodes([]);
          }}
        />
      </LocalSignInSettings>
      {showSecondStepChooser && (
        <Modal
          title={SECOND_STEP_SETUP_COPY.title}
          description={SECOND_STEP_SETUP_COPY.description}
          submitButtonText="Continue"
          isLoading={isStartingSecondStep}
          disableSubmitButton={isStartingSecondStep}
          error={secondStepError || undefined}
          onClose={
            isStartingSecondStep
              ? undefined
              : () => {
                  setShowSecondStepChooser(false);
                  setSecondStepError("");
                }
          }
          onSubmit={() => {
            void startSecondStep();
          }}
        >
          <CardSelect
            dataTestId="second-step-choice"
            layout="list"
            value={secondStep}
            onChange={(value: string) => {
              setSecondStep(value as SecondStep);
            }}
            options={[
              {
                value: "authenticator-app",
                title: SECOND_STEP_SETUP_COPY.authenticatorApp,
                description: SECOND_STEP_SETUP_COPY.authenticatorAppDescription,
                icon: IconProp.DevicePhoneMobile,
              },
              {
                value: "security-key",
                title: SECOND_STEP_SETUP_COPY.securityKey,
                description: SECOND_STEP_SETUP_COPY.securityKeyDescription,
                icon: IconProp.Key,
              },
            ]}
          />
        </Modal>
      )}
      {showVerificationModal && selectedTotpAuth && (
        <Modal
          title={translator.translateTemplate("Set up {{name}}", {
            name:
              selectedTotpAuth.name ||
              translatableTerm("authenticator app", { inSentence: true }),
          })}
          isTitleTranslated={true}
          description="Scan the QR code with your authenticator app, then enter its 6-digit code to finish setup."
          submitButtonText="Verify and finish"
          isLoading={verificationLoading}
          disableSubmitButton={
            verificationLoading ||
            setupLoading ||
            !selectedTotpAuth.twoFactorOtpUrl
          }
          onClose={
            verificationLoading
              ? undefined
              : () => {
                  setupController.current?.abort();
                  turnOnAfterSetup.current = false;
                  setShowVerificationModal(false);
                  setSelectedTotpAuth(null);
                  setVerificationCode("");
                  setVerificationError("");
                }
          }
          onSubmit={verifyAuthenticator}
        >
          <div>
            {setupLoading ? (
              <DetailListSkeleton fields={2} columns={1} />
            ) : selectedTotpAuth.twoFactorOtpUrl ? (
              <>
                {/*
                 * The code and, for whoever cannot scan it, its setup key
                 * (issue #6638).
                 */}
                <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
                  <AuthenticatorAppSetupCode
                    otpUrl={selectedTotpAuth.twoFactorOtpUrl}
                  />
                </div>
                <label
                  htmlFor="authenticator-verification-code"
                  className="mb-2 block text-sm font-medium text-gray-900"
                >
                  {translator.translateText("Verification code")}
                </label>
                <input
                  id="authenticator-verification-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={verificationCode}
                  disabled={verificationLoading}
                  aria-describedby="authenticator-code-hint"
                  aria-invalid={Boolean(verificationError)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-3 text-center font-mono text-xl tracking-widest text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setVerificationCode(
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    );
                    setVerificationError("");
                  }}
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === "Enter") {
                      void verifyAuthenticator();
                    }
                  }}
                />
                <p
                  id="authenticator-code-hint"
                  className="mt-2 text-sm text-gray-500"
                >
                  {translator.translateText(
                    "Codes refresh every 30 seconds. Use the current code shown in your app.",
                  )}
                </p>
              </>
            ) : null}
            {verificationError && (
              <Alert
                title={verificationError}
                type={AlertType.DANGER}
                className="mt-4"
              />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default TwoFactorAuth;
