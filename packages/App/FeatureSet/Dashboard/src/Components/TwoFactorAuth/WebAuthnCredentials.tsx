import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import UserUtil from "Common/UI/Utils/User";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import { JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import WebAuthn, {
  WEBAUTHN_ALREADY_REGISTERED,
  WEBAUTHN_NEEDS_SECURE_CONNECTION,
  WEBAUTHN_NOT_SUPPORTED,
  WEBAUTHN_REGISTRATION_CANCELED,
  WEBAUTHN_REGISTRATION_FAILED,
} from "Common/UI/Utils/WebAuthn";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FieldLabel from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input from "Common/UI/Components/Input/Input";
import Modal from "Common/UI/Components/Modal/Modal";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";

type RegistrationStep = "preparing" | "prompt" | "saving";

/*
 * WebAuthn words a registration's errors for a passkey. The security keys
 * card names its own kind, each in a sentence of its own, so the reader's
 * language words the whole sentence.
 */
const SECURITY_KEY_ERRORS: Record<string, string> = {
  [WEBAUTHN_NEEDS_SECURE_CONNECTION]: translationKey(
    "Security keys require a secure connection. Open OneUptime using HTTPS, or sign in with your password.",
  ),
  [WEBAUTHN_NOT_SUPPORTED]: translationKey(
    "This browser does not support security keys. Use a supported browser or sign in with your password.",
  ),
  [WEBAUTHN_REGISTRATION_CANCELED]: translationKey(
    "Security key registration was canceled or timed out. Try again when you are ready.",
  ),
  [WEBAUTHN_ALREADY_REGISTERED]: translationKey(
    "This authenticator is already registered. Choose a different authenticator or use your existing security key.",
  ),
  [WEBAUTHN_REGISTRATION_FAILED]: translationKey(
    "Unable to complete security key registration. Please try again.",
  ),
};

const PASSKEY_WORD: RegExp = /Passkey/g;
const PASSKEY_WORD_IN_SENTENCE: RegExp = /passkey/g;

// A registration error as the card names its kind, in English.
const getRegistrationError: (error: unknown, isPasskey: boolean) => string = (
  error: unknown,
  isPasskey: boolean,
): string => {
  const message: string = WebAuthn.getErrorMessage(error, "registration");

  if (isPasskey) {
    return message;
  }

  return (
    SECURITY_KEY_ERRORS[message] ||
    message
      .replace(PASSKEY_WORD, "Security key")
      .replace(PASSKEY_WORD_IN_SENTENCE, "security key")
  );
};

export interface ComponentProps {
  isPasskey: boolean;
  onBackupCodes: (codes: Array<string>) => void;
}

const WebAuthnCredentials: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isRegisteringPasskey: boolean = props.isPasskey;
  const [credentialCount, setCredentialCount] = React.useState<number | null>(
    null,
  );
  const [tableRefreshToggle, setTableRefreshToggle] =
    React.useState<string>("0");

  const [showWebAuthnRegistrationModal, setShowWebAuthnRegistrationModal] =
    React.useState<boolean>(false);
  const [webAuthnRegistrationError, setWebAuthnRegistrationError] =
    React.useState<string | null>(null);
  const [webAuthnRegistrationStep, setWebAuthnRegistrationStep] =
    React.useState<RegistrationStep | null>(null);
  const [webAuthnRegistrationName, setWebAuthnRegistrationName] =
    React.useState<string>("");
  const [webAuthnRegistrationNameError, setWebAuthnRegistrationNameError] =
    React.useState<string | undefined>(undefined);
  const [webAuthnRegistrationSuccess, setWebAuthnRegistrationSuccess] =
    React.useState<string | null>(null);

  const registrationInProgress: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const registrationSaving: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const registrationController: React.MutableRefObject<AbortController | null> =
    React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      registrationController.current?.abort();
      registrationController.current = null;
    };
  }, []);

  type ReadBackupCodesFunction = (response: HTTPResponse<JSONObject>) => void;

  const readBackupCodesFromResponse: ReadBackupCodesFunction = (
    response: HTTPResponse<JSONObject>,
  ): void => {
    const codes: Array<string> = (
      (response.data["backupCodes"] as Array<unknown> | undefined) || []
    ).map((code: unknown) => {
      return String(code);
    });

    if (codes.length > 0) {
      props.onBackupCodes(codes);
    }
  };

  const openRegistration: () => void = (): void => {
    setWebAuthnRegistrationName("");
    setWebAuthnRegistrationNameError(undefined);
    setWebAuthnRegistrationError(null);
    setWebAuthnRegistrationSuccess(null);
    setShowWebAuthnRegistrationModal(true);
  };

  const closeRegistration: () => void = (): void => {
    // Once verification starts, the server may already have saved the key.
    if (registrationSaving.current) {
      return;
    }
    registrationController.current?.abort();
    registrationController.current = null;
    registrationInProgress.current = false;
    setShowWebAuthnRegistrationModal(false);
    setWebAuthnRegistrationStep(null);
    setWebAuthnRegistrationError(null);
  };

  const registerWebAuthn: () => Promise<void> = async (): Promise<void> => {
    if (registrationInProgress.current) {
      return;
    }

    const name: string = webAuthnRegistrationName.trim();
    if (!name) {
      setWebAuthnRegistrationNameError(
        translator.translateText("Enter a name to recognize this key."),
      );
      return;
    }

    const controller: AbortController = new AbortController();
    registrationController.current = controller;
    registrationInProgress.current = true;
    setWebAuthnRegistrationName(name);
    setWebAuthnRegistrationNameError(undefined);
    setWebAuthnRegistrationError(null);
    setWebAuthnRegistrationStep("preparing");

    try {
      WebAuthn.ensureSupported();
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/user-webauthn/generate-registration-options`,
          ),
          data: { isPasskey: isRegisteringPasskey },
          options: { signal: controller.signal },
        });

      if (controller.signal.aborted) {
        return;
      }
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setWebAuthnRegistrationStep("prompt");
      const credential: JSONObject = await WebAuthn.register(
        response.data["options"] as JSONObject,
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      registrationSaving.current = true;
      setWebAuthnRegistrationStep("saving");
      const verifyResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/user-webauthn/verify-registration`,
          ),
          data: { name: name, credential: credential },
        });

      if (controller.signal.aborted) {
        return;
      }
      if (verifyResponse instanceof HTTPErrorResponse) {
        throw verifyResponse;
      }

      // Enrollment returns the only plaintext copy of these recovery codes.
      readBackupCodesFromResponse(verifyResponse);
      setShowWebAuthnRegistrationModal(false);
      setWebAuthnRegistrationSuccess(
        isRegisteringPasskey
          ? (translator.translateText(
              "Passkey added. Use it the next time you sign in.",
            ) as string)
          : null,
      );
      setTableRefreshToggle((previous: string) => {
        return String(Number(previous) + 1);
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        // OneUptime's own sentences in the reader's words; the server's as sent.
        setWebAuthnRegistrationError(
          translator.translateText(
            getRegistrationError(err, isRegisteringPasskey),
          ) as string,
        );
      }
    } finally {
      if (registrationController.current === controller) {
        registrationController.current = null;
        registrationInProgress.current = false;
        registrationSaving.current = false;
        setWebAuthnRegistrationStep(null);
      }
    }
  };

  return (
    <>
      {webAuthnRegistrationSuccess && (
        <div
          role="status"
          className="mb-5 flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          data-testid="passkey-registration-success"
        >
          <Icon icon={IconProp.CheckCircle} className="h-5 w-5 flex-shrink-0" />
          <span>{webAuthnRegistrationSuccess}</span>
        </div>
      )}
      <ModelTable<UserWebAuthn>
        modelType={UserWebAuthn}
        name={props.isPasskey ? "Passkeys" : "Security keys"}
        id={props.isPasskey ? "passkeys-table" : "security-keys-table"}
        userPreferencesKey={
          props.isPasskey ? "user-passkeys-table" : "user-security-keys-table"
        }
        isDeleteable={true}
        refreshToggle={tableRefreshToggle}
        filters={[]}
        query={{
          userId: UserUtil.getUserId(),
          // Credentials created before purposes were recorded stay manageable.
          isPasskey: new EqualToOrNull(props.isPasskey ? "true" : "false"),
        }}
        onFetchSuccess={(_items: Array<UserWebAuthn>, totalCount: number) => {
          setCredentialCount(totalCount);
        }}
        isEditable={true}
        editButtonText="Rename"
        showRefreshButton={false}
        disableColumnCustomization={true}
        disablePagination={credentialCount !== null && credentialCount <= 10}
        disableUrlState={true}
        isCreateable={false}
        isViewable={false}
        cardProps={{
          title: props.isPasskey ? "Passkeys" : "Security keys",
          description: props.isPasskey
            ? "Sign in without a password using your fingerprint, face, screen lock, or a compatible security key."
            : "Use a security key as the second step after your password, with no code to type.",
          buttons: [
            {
              title: props.isPasskey ? "Add Passkey" : "Add Security Key",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Add,
              onClick: openRegistration,
            },
          ],
        }}
        noItemsMessage={
          <div className="px-4 py-7 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <Icon
                icon={props.isPasskey ? IconProp.Fingerprint : IconProp.Key}
                className="h-6 w-6"
              />
            </span>
            <p className="mt-3 font-medium text-gray-900">
              {props.isPasskey
                ? translator.translateText("No passkeys added yet.")
                : translator.translateText("No security keys added yet.")}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {props.isPasskey
                ? translator.translateText(
                    "Add a passkey for a faster, more secure sign-in.",
                  )
                : translator.translateText(
                    "Add a USB or NFC security key to protect your account.",
                  )}
            </p>
          </div>
        }
        singularName={props.isPasskey ? "passkey" : "security key"}
        pluralName={props.isPasskey ? "passkeys" : "security keys"}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            description: "Choose a name that helps you recognize this key.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            customValidation: (values: FormValues<UserWebAuthn>) => {
              return String(values.name || "").trim()
                ? null
                : (translator.translateText(
                    "Enter a name to recognize this key.",
                  ) as string);
            },
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
            wrapContent: true,
            // A mark beside the name: the name reads its own way, the cell the page's.
            getLineText: drawsItsOwnLines,
            getElement: (item: UserWebAuthn): ReactElement => {
              return (
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                    <Icon
                      icon={
                        props.isPasskey ? IconProp.Fingerprint : IconProp.Key
                      }
                      className="h-5 w-5"
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      <IsolatedText text={item.name || ""} />
                    </p>
                  </div>
                </div>
              );
            },
          },
          {
            field: { isVerified: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: UserWebAuthn): ReactElement => {
              return (
                <span
                  className={
                    item.isVerified
                      ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                      : "inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                  }
                >
                  {item.isVerified ? (
                    <Icon icon={IconProp.CheckCircle} className="h-3.5 w-3.5" />
                  ) : null}
                  {item.isVerified
                    ? translator.translateText("Ready")
                    : translator.translateText("Setup incomplete")}
                </span>
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
      {showWebAuthnRegistrationModal && (
        <Modal
          title={isRegisteringPasskey ? "Add Passkey" : "Add Security Key"}
          description={
            isRegisteringPasskey
              ? "Name your passkey, then follow your browser's instructions to save it."
              : "Name your security key, then follow your browser's instructions to register it."
          }
          submitButtonText={
            isRegisteringPasskey ? "Create Passkey" : "Register Security Key"
          }
          onClose={
            webAuthnRegistrationStep === "saving"
              ? undefined
              : closeRegistration
          }
          isLoading={webAuthnRegistrationStep !== null}
          disableSubmitButton={webAuthnRegistrationStep !== null}
          onSubmit={registerWebAuthn}
        >
          <div>
            <FieldLabel
              title={
                isRegisteringPasskey ? "Passkey name" : "Security key name"
              }
              htmlFor="passkey-registration-name"
              required={true}
            />
            <Input
              id="passkey-registration-name"
              dataTestId="passkey-name"
              placeholder={
                isRegisteringPasskey ? "My laptop" : "My security key"
              }
              value={webAuthnRegistrationName}
              onChange={(value: string) => {
                setWebAuthnRegistrationName(value);
                setWebAuthnRegistrationNameError(undefined);
              }}
              onEnterPress={registerWebAuthn}
              disabled={webAuthnRegistrationStep !== null}
              error={webAuthnRegistrationNameError}
              ariaDescribedby="passkey-name-hint"
              autoComplete="off"
            />
            <p id="passkey-name-hint" className="mt-2 text-sm text-gray-500">
              {isRegisteringPasskey
                ? translator.translateText(
                    "Choose a name you will recognize later, such as your device or password manager.",
                  )
                : translator.translateText(
                    "Choose a name you will recognize later, such as Work YubiKey.",
                  )}
            </p>
            {webAuthnRegistrationError && (
              <Alert
                title={webAuthnRegistrationError}
                type={AlertType.DANGER}
                className="mt-4"
              />
            )}
            {webAuthnRegistrationStep && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 rounded-md bg-indigo-50 p-3 text-sm text-indigo-800"
              >
                {webAuthnRegistrationStep === "preparing"
                  ? translator.translateText("Preparing registration…")
                  : webAuthnRegistrationStep === "prompt"
                    ? translator.translateText(
                        "Follow the prompt from your browser or device. You can cancel and try again.",
                      )
                    : translator.translateText(
                        "Saving your key. Keep this window open for a moment…",
                      )}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default WebAuthnCredentials;
