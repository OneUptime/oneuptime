import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_ROUTE,
  REAUTHENTICATION_WEBAUTHN_OPTIONS_ROUTE,
  ReauthenticationMethods,
  ReauthenticationStatus,
  ReauthenticationWebAuthnKind,
} from "Common/Types/Accounts/Reauthentication";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import FieldLabel from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ACCOUNTS_URL, APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Reauthentication from "Common/UI/Utils/Reauthentication";
import SessionEndReturn from "Common/UI/Utils/SessionEndReturn";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import UserUtil from "Common/UI/Utils/User";
import WebAuthn from "Common/UI/Utils/WebAuthn";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/*
 * CONFIRM IT'S YOU (#10155, Common/Types/Accounts/Reauthentication).
 *
 * A change to how a person signs in - a new password or email address, a
 * passkey, a security key or an authenticator app added or removed, unused
 * backup codes replaced, two-factor authentication turned off - waits until
 * their session confirms it's theirs. This is the one prompt that asks,
 * mounted once in App.tsx: the API client hands it every such refusal
 * (Common/UI/Utils/Reauthentication) and sends the change again once the
 * person has confirmed, so no page asks on its own and nothing they typed
 * is lost.
 *
 * It asks for what signs the account in, in one dialog:
 *
 *   - the password, and - while two-factor authentication is on - the
 *     second step beside it: a code from the authenticator app, the
 *     security key, or a backup code, each one link away from the others;
 *     Use a Passkey instead, where the account has one;
 *   - a passkey, for an account with no password;
 *   - Sign In Again, for an account that signs in with neither (single
 *     sign-on, Google, Microsoft): it signs out and comes back to the page
 *     once the person has signed in.
 *
 * A wrong answer says what was wrong under its field, in the reader's
 * words; too many in one session sign it out (the server decides, and the
 * API client takes the browser to the sign-in page). Cancel answers the
 * change with its refusal, which says what to do.
 */

export const REAUTHENTICATION_PROMPT_COPY: {
  title: string;
  signInAgainTitle: string;
  password: string;
  passwordAndCode: string;
  passwordAndSecurityKey: string;
  passwordAndBackupCode: string;
  passkey: string;
  signInAgain: string;
  notAskedAgain: { one: string; other: string };
  passwordLabel: string;
  codeLabel: string;
  backupCodeLabel: string;
  useAuthenticatorApp: string;
  useSecurityKey: string;
  useBackupCode: string;
  usePasskey: string;
  confirm: string;
  enterCode: string;
  enterBackupCode: string;
} = {
  title: translationKey("Confirm It's You"),
  signInAgainTitle: translationKey("Sign In Again"),
  password: translationKey("Enter your password to change how you sign in."),
  passwordAndCode: translationKey(
    "Enter your password and a code from your authenticator app to change how you sign in.",
  ),
  passwordAndSecurityKey: translationKey(
    "Enter your password, then use your security key, to change how you sign in.",
  ),
  passwordAndBackupCode: translationKey(
    "Enter your password and one of your backup codes to change how you sign in.",
  ),
  passkey: translationKey("Use your passkey to change how you sign in."),
  signInAgain: translationKey(
    "To change how you sign in, sign in again first. You'll come back to this page.",
  ),
  // A plural: its two forms, as every count is worded (translatePlural).
  notAskedAgain: {
    one: "You won't be asked again for {{count}} minute.",
    other: "You won't be asked again for {{count}} minutes.",
  },
  passwordLabel: translationKey("Password"),
  codeLabel: translationKey("Authenticator code"),
  backupCodeLabel: translationKey("Backup code"),
  useAuthenticatorApp: translationKey("Use your authenticator app instead"),
  useSecurityKey: translationKey("Use your security key instead"),
  useBackupCode: translationKey("Use a backup code instead"),
  usePasskey: translationKey("Use a Passkey"),
  confirm: translationKey("Confirm"),
  enterCode: translationKey(
    "Enter the 6-digit code from your authenticator app.",
  ),
  enterBackupCode: translationKey("Enter one of your backup codes."),
};

// An authenticator app's code: six digits.
const AUTHENTICATOR_CODE: RegExp = /^\d{6}$/;

// Which second step the prompt asks for beside the password.
export enum SecondStepWay {
  AuthenticatorApp = "AuthenticatorApp",
  SecurityKey = "SecurityKey",
  BackupCode = "BackupCode",
}

// The second step a prompt starts with: the app, then the key, then a code.
export const getFirstSecondStepWay: (
  methods: ReauthenticationMethods,
) => SecondStepWay | null = (
  methods: ReauthenticationMethods,
): SecondStepWay | null => {
  if (!methods.secondStep) {
    return null;
  }

  if (methods.secondStep.authenticatorApp) {
    return SecondStepWay.AuthenticatorApp;
  }

  if (methods.secondStep.securityKey) {
    return SecondStepWay.SecurityKey;
  }

  return SecondStepWay.BackupCode;
};

// The account's other second steps, offered as links beside the one asked.
export const getOtherSecondStepWays: (
  methods: ReauthenticationMethods,
  way: SecondStepWay | null,
) => Array<SecondStepWay> = (
  methods: ReauthenticationMethods,
  way: SecondStepWay | null,
): Array<SecondStepWay> => {
  if (!methods.secondStep || !way) {
    return [];
  }

  const ways: Array<SecondStepWay> = [];

  if (methods.secondStep.authenticatorApp) {
    ways.push(SecondStepWay.AuthenticatorApp);
  }

  if (methods.secondStep.securityKey) {
    ways.push(SecondStepWay.SecurityKey);
  }

  if (methods.secondStep.backupCode) {
    ways.push(SecondStepWay.BackupCode);
  }

  return ways.filter((other: SecondStepWay): boolean => {
    return other !== way;
  });
};

const SWITCH_TO_WAY: Record<SecondStepWay, string> = {
  [SecondStepWay.AuthenticatorApp]:
    REAUTHENTICATION_PROMPT_COPY.useAuthenticatorApp,
  [SecondStepWay.SecurityKey]: REAUTHENTICATION_PROMPT_COPY.useSecurityKey,
  [SecondStepWay.BackupCode]: REAUTHENTICATION_PROMPT_COPY.useBackupCode,
};

// What the prompt says it is asking for.
export const getPromptDescription: (
  methods: ReauthenticationMethods,
  way: SecondStepWay | null,
) => string = (
  methods: ReauthenticationMethods,
  way: SecondStepWay | null,
): string => {
  if (methods.signInAgain) {
    return REAUTHENTICATION_PROMPT_COPY.signInAgain;
  }

  if (!methods.password) {
    return REAUTHENTICATION_PROMPT_COPY.passkey;
  }

  if (way === SecondStepWay.AuthenticatorApp) {
    return REAUTHENTICATION_PROMPT_COPY.passwordAndCode;
  }

  if (way === SecondStepWay.SecurityKey) {
    return REAUTHENTICATION_PROMPT_COPY.passwordAndSecurityKey;
  }

  if (way === SecondStepWay.BackupCode) {
    return REAUTHENTICATION_PROMPT_COPY.passwordAndBackupCode;
  }

  return REAUTHENTICATION_PROMPT_COPY.password;
};

// Where a refusal is said: under its field, or over the dialog.
export enum PromptErrorPlace {
  Password = "Password",
  SecondStep = "SecondStep",
  Dialog = "Dialog",
}

export interface PromptError {
  place: PromptErrorPlace;
  message: string;
}

const PASSWORD_MESSAGES: ReadonlyArray<string> = [
  REAUTHENTICATION_MESSAGES.wrongPassword,
  REAUTHENTICATION_MESSAGES.passwordRequired,
];

const SECOND_STEP_MESSAGES: ReadonlyArray<string> = [
  REAUTHENTICATION_MESSAGES.wrongCode,
  REAUTHENTICATION_MESSAGES.wrongBackupCode,
  REAUTHENTICATION_MESSAGES.secondStepRequired,
];

// Where the server's refusal of a confirmation is said.
export const placePromptError: (message: string) => PromptError = (
  message: string,
): PromptError => {
  if (PASSWORD_MESSAGES.includes(message)) {
    return { place: PromptErrorPlace.Password, message: message };
  }

  if (SECOND_STEP_MESSAGES.includes(message)) {
    return { place: PromptErrorPlace.SecondStep, message: message };
  }

  return { place: PromptErrorPlace.Dialog, message: message };
};

// The question the prompt is open for, and how it is answered.
interface OpenPrompt {
  methods: ReauthenticationMethods;
  windowInMinutes: number;
  resolve: (isConfirmed: boolean) => void;
}

const ReauthenticationPrompt: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [prompt, setPrompt] = useState<OpenPrompt | null>(null);
  const [password, setPassword] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [backupCode, setBackupCode] = useState<string>("");
  const [way, setWay] = useState<SecondStepWay | null>(null);
  const [error, setError] = useState<PromptError | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const passwordId: string = useId();
  const secondStepId: string = useId();
  const promptRef: React.MutableRefObject<OpenPrompt | null> =
    useRef<OpenPrompt | null>(null);
  // One confirmation at a time, whatever pressed it: Enter, or a button.
  const busyRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const setBusy: (busy: boolean) => void = (busy: boolean): void => {
    busyRef.current = busy;
    setIsBusy(busy);
  };

  const open: (
    resolve: (isConfirmed: boolean) => void,
  ) => Promise<void> = async (
    resolve: (isConfirmed: boolean) => void,
  ): Promise<void> => {
    const status: ReauthenticationStatus | null =
      await Reauthentication.getStatus();

    // Confirmed meanwhile, in another tab: nothing to ask.
    if (status?.isConfirmed) {
      resolve(true);
      return;
    }

    // Unreadable: the change keeps its refusal, which says what to do.
    if (!status) {
      resolve(false);
      return;
    }

    const opened: OpenPrompt = {
      methods: status.methods,
      windowInMinutes: status.windowInMinutes,
      resolve: resolve,
    };

    promptRef.current = opened;
    setPassword("");
    setCode("");
    setBackupCode("");
    setError(null);
    setBusy(false);
    setWay(getFirstSecondStepWay(status.methods));
    setPrompt(opened);
  };

  const close: (isConfirmed: boolean) => void = (
    isConfirmed: boolean,
  ): void => {
    const current: OpenPrompt | null = promptRef.current;

    promptRef.current = null;
    setPrompt(null);
    setPassword("");
    setCode("");
    setBackupCode("");
    setError(null);
    setBusy(false);

    current?.resolve(isConfirmed);
  };

  // The API client's way to ask, while the prompt is mounted.
  useEffect(() => {
    Reauthentication.setAsker((): Promise<boolean> => {
      return new Promise<boolean>(
        (resolve: (isConfirmed: boolean) => void): void => {
          void open(resolve);
        },
      );
    });

    return () => {
      Reauthentication.setAsker(null);
      promptRef.current?.resolve(false);
      promptRef.current = null;
    };
  }, []);

  // A key's answer to its prompt, for options made for this session.
  const askKey: (
    kind: ReauthenticationWebAuthnKind,
  ) => Promise<JSONObject> = async (
    kind: ReauthenticationWebAuthnKind,
  ): Promise<JSONObject> => {
    WebAuthn.ensureSupported();

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          REAUTHENTICATION_WEBAUTHN_OPTIONS_ROUTE,
        ),
        data: { [REAUTHENTICATION_FIELDS.webAuthnKind]: kind },
        options: { skipReauthentication: true },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    try {
      return await WebAuthn.authenticate(
        response.data["options"] as JSONObject,
      );
    } catch {
      // The browser's prompt was closed, or the key refused: our words for it.
      throw new Error(
        kind === ReauthenticationWebAuthnKind.Passkey
          ? REAUTHENTICATION_MESSAGES.passkeyNotAccepted
          : REAUTHENTICATION_MESSAGES.securityKeyNotAccepted,
      );
    }
  };

  // Sends a confirmation, and closes the prompt once the server took it.
  const sendConfirmation: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          REAUTHENTICATION_ROUTE,
        ),
        data: data,
        options: { skipReauthentication: true },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    close(true);
  };

  const showError: (err: unknown) => void = (err: unknown): void => {
    if (err instanceof HTTPErrorResponse && err.message) {
      setError(placePromptError(err.message));
      return;
    }

    if (!(err instanceof HTTPErrorResponse) && err instanceof Error) {
      if (err.message) {
        setError({ place: PromptErrorPlace.Dialog, message: err.message });
        return;
      }
    }

    setError({
      place: PromptErrorPlace.Dialog,
      message: API.getFriendlyMessage(err),
    });
  };

  const confirmWithPasskey: () => Promise<void> = async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const credential: JSONObject = await askKey(
        ReauthenticationWebAuthnKind.Passkey,
      );

      await sendConfirmation({
        [REAUTHENTICATION_FIELDS.passkeyCredential]: credential,
      });
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  const confirmWithPassword: () => Promise<void> = async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }

    if (!password) {
      setError({
        place: PromptErrorPlace.Password,
        message: REAUTHENTICATION_MESSAGES.passwordRequired,
      });
      return;
    }

    if (
      way === SecondStepWay.AuthenticatorApp &&
      !AUTHENTICATOR_CODE.test(code)
    ) {
      setError({
        place: PromptErrorPlace.SecondStep,
        message: REAUTHENTICATION_PROMPT_COPY.enterCode,
      });
      return;
    }

    if (way === SecondStepWay.BackupCode && !backupCode.trim()) {
      setError({
        place: PromptErrorPlace.SecondStep,
        message: REAUTHENTICATION_PROMPT_COPY.enterBackupCode,
      });
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const data: JSONObject = {
        [REAUTHENTICATION_FIELDS.password]: password,
      };

      if (way === SecondStepWay.AuthenticatorApp) {
        data[REAUTHENTICATION_FIELDS.code] = code;
      }

      if (way === SecondStepWay.BackupCode) {
        data[REAUTHENTICATION_FIELDS.backupCode] = backupCode.trim();
      }

      if (way === SecondStepWay.SecurityKey) {
        data[REAUTHENTICATION_FIELDS.securityKeyCredential] = await askKey(
          ReauthenticationWebAuthnKind.SecurityKey,
        );
      }

      await sendConfirmation(data);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  /*
   * Signs out and back in, coming back to this page (SessionEndReturn), as
   * a session that ended does - through the identity provider's sign-out
   * first where the person's organization asks for it, as Sign Out does,
   * so the provider asks who they are again too.
   */
  const signInAgain: () => Promise<void> = async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }

    setBusy(true);
    SessionEndReturn.rememberCurrentPage(UserUtil.getUserId().toString());

    const identityProviderSignOutUrl: URL | null = await UserUtil.logout();

    close(false);
    Navigation.navigate(identityProviderSignOutUrl || ACCOUNTS_URL);
  };

  if (!prompt) {
    return <></>;
  }

  const methods: ReauthenticationMethods = prompt.methods;
  const isSignInAgain: boolean = methods.signInAgain;
  const isPasskeyOnly: boolean = !methods.signInAgain && !methods.password;
  const email: Email | null = UserUtil.getEmail();
  const otherWays: Array<SecondStepWay> = getOtherSecondStepWays(methods, way);

  const submit: () => void = (): void => {
    if (isSignInAgain) {
      void signInAgain();
      return;
    }

    if (isPasskeyOnly) {
      void confirmWithPasskey();
      return;
    }

    void confirmWithPassword();
  };

  return (
    <Modal
      title={
        isSignInAgain
          ? REAUTHENTICATION_PROMPT_COPY.signInAgainTitle
          : REAUTHENTICATION_PROMPT_COPY.title
      }
      description={getPromptDescription(methods, way)}
      modalWidth={ModalWidth.Normal}
      submitButtonText={
        isSignInAgain
          ? REAUTHENTICATION_PROMPT_COPY.signInAgainTitle
          : isPasskeyOnly
            ? REAUTHENTICATION_PROMPT_COPY.usePasskey
            : REAUTHENTICATION_PROMPT_COPY.confirm
      }
      onSubmit={submit}
      onClose={
        isBusy
          ? undefined
          : () => {
              close(false);
            }
      }
      isLoading={isBusy}
      disableCloseOnBackdropClick={true}
      error={
        error?.place === PromptErrorPlace.Dialog ? error.message : undefined
      }
      secondaryButton={
        methods.passkey && methods.password && !isSignInAgain
          ? {
              title: REAUTHENTICATION_PROMPT_COPY.usePasskey,
              onClick: () => {
                void confirmWithPasskey();
              },
              disabled: isBusy,
              dataTestId: "reauthentication-use-passkey",
            }
          : undefined
      }
    >
      <div data-testid="reauthentication-prompt">
        {isSignInAgain || isPasskeyOnly ? (
          <></>
        ) : (
          <form
            className="space-y-4"
            /*
             * A form, for a password manager to fill; sent by Enter in a
             * field and by the dialog's Confirm, never by the browser.
             */
            onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
            }}
          >
            {/* The account's address, for a password manager to pick its entry. */}
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={email?.toString() || ""}
              readOnly={true}
              hidden={true}
              aria-hidden={true}
              tabIndex={-1}
            />
            <div>
              <FieldLabel
                title={REAUTHENTICATION_PROMPT_COPY.passwordLabel}
                htmlFor={passwordId}
                hideOptionalLabel={true}
              />
              {/*
               * The password the person signs in with, so their password
               * manager may fill it: the one Dashboard field that asks for
               * it (PasswordManagerCredentialFields).
               */}
              <Input
                id={passwordId}
                type={InputType.PASSWORD}
                isOwnCredential={true}
                value={password}
                autoComplete="current-password"
                autoFocus={true}
                disabled={isBusy}
                dataTestId="reauthentication-password"
                error={
                  error?.place === PromptErrorPlace.Password
                    ? error.message
                    : undefined
                }
                onChange={(value: string) => {
                  setPassword(value);
                  setError(null);
                }}
                onEnterPress={submit}
              />
            </div>
            {way === SecondStepWay.AuthenticatorApp ? (
              <div>
                <FieldLabel
                  title={REAUTHENTICATION_PROMPT_COPY.codeLabel}
                  htmlFor={secondStepId}
                  hideOptionalLabel={true}
                />
                <Input
                  id={secondStepId}
                  type={InputType.TEXT}
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  readsLeftToRight={true}
                  disabled={isBusy}
                  dataTestId="reauthentication-code"
                  error={
                    error?.place === PromptErrorPlace.SecondStep
                      ? error.message
                      : undefined
                  }
                  onChange={(value: string) => {
                    setCode(value.replace(/\D/g, "").slice(0, 6));
                    setError(null);
                  }}
                  onEnterPress={submit}
                />
              </div>
            ) : (
              <></>
            )}
            {way === SecondStepWay.BackupCode ? (
              <div>
                <FieldLabel
                  title={REAUTHENTICATION_PROMPT_COPY.backupCodeLabel}
                  htmlFor={secondStepId}
                  hideOptionalLabel={true}
                />
                <Input
                  id={secondStepId}
                  type={InputType.TEXT}
                  value={backupCode}
                  autoComplete="off"
                  readsLeftToRight={true}
                  disableSpellCheck={true}
                  disabled={isBusy}
                  dataTestId="reauthentication-backup-code"
                  error={
                    error?.place === PromptErrorPlace.SecondStep
                      ? error.message
                      : undefined
                  }
                  onChange={(value: string) => {
                    setBackupCode(value);
                    setError(null);
                  }}
                  onEnterPress={submit}
                />
              </div>
            ) : (
              <></>
            )}
            {way === SecondStepWay.SecurityKey &&
            error?.place === PromptErrorPlace.SecondStep ? (
              <FieldError message={error.message} />
            ) : (
              <></>
            )}
            {otherWays.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {otherWays.map((other: SecondStepWay) => {
                  return (
                    <Button
                      key={other}
                      title={SWITCH_TO_WAY[other]}
                      buttonStyle={ButtonStyleType.LINK}
                      disabled={isBusy}
                      dataTestId={`reauthentication-use-${other}`}
                      onClick={() => {
                        setWay(other);
                        setError(null);
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <></>
            )}
          </form>
        )}
        {isSignInAgain ? (
          <></>
        ) : (
          <p
            className={`text-sm text-gray-500 ${isPasskeyOnly ? "" : "mt-4"}`}
            data-testid="reauthentication-window"
          >
            {translator.translatePlural(
              REAUTHENTICATION_PROMPT_COPY.notAskedAgain,
              prompt.windowInMinutes,
            )}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default ReauthenticationPrompt;
