import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import {
  REAUTHENTICATE_QUERY_PARAM,
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_ROUTE,
  REAUTHENTICATION_WEBAUTHN_OPTIONS_ROUTE,
  ReauthenticationMethods,
  ReauthenticationPurpose,
  ReauthenticationSignInAgain,
  ReauthenticationStatus,
  ReauthenticationWebAuthnKind,
  SignInAgainProvider,
  SignInAgainRefusal,
} from "../../../Types/Accounts/Reauthentication";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Alert, { AlertType } from "../Alerts/Alert";
import Button, { ButtonStyleType } from "../Button/Button";
import FieldError from "../Forms/Fields/FieldError";
import FieldLabel from "../Forms/Fields/FieldLabel";
import Input, { InputType } from "../Input/Input";
import Modal, { ModalWidth } from "../Modal/Modal";
import { ACCOUNTS_URL, APP_API_URL, IDENTITY_URL } from "../../Config";
import API from "../../Utils/API/API";
import Navigation from "../../Utils/Navigation";
import Reauthentication from "../../Utils/Reauthentication";
import SessionEndReturn from "../../Utils/SessionEndReturn";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import UserUtil from "../../Utils/User";
import WebAuthn from "../../Utils/WebAuthn";
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
 * A change that waits until the person's session confirms it's theirs - a
 * change to how they sign in, deleting their own account (#10220), or a
 * master admin's change to how someone else signs in, or to the server's
 * (#10216) - is asked here. One prompt, mounted once in the Dashboard's and
 * the Admin Dashboard's App.tsx: the API client hands it every such refusal
 * (Common/UI/Utils/Reauthentication), with what it is for, and sends the
 * change again once the person has confirmed, so no page asks on its own
 * and nothing they typed is lost.
 *
 * It asks for what signs the account in, in one dialog, and says what for:
 *
 *   - the password, and - while two-factor authentication is on - the
 *     second step beside it: a code from the authenticator app, the
 *     security key, or a backup code, each one link away from the others;
 *     Use a Passkey instead, where the account has one;
 *   - a passkey, for an account with no password;
 *   - Sign In Again, for an account that signs in with neither (single
 *     sign-on, Google, Microsoft, a sign-in link): it signs out and back in
 *     through the session's own sign-in, asking the identity provider to
 *     authenticate the person again (#10217), and comes back to the page.
 *     When the last one did not confirm it's them - the provider used a
 *     session it had, or did not say when they signed in - it says so, with
 *     what their administrator can change, and offers Sign In Another Way
 *     where an emailed sign-in link can stand in. A session that signed in
 *     with Vercel, which can never confirm it's them (#10331), is told so
 *     at once, with what does: Sign In Another Way and an emailed link, or
 *     a password set with Forgot password?.
 *
 * A wrong answer says what was wrong under its field, in the reader's
 * words; too many in one session sign it out (the server decides, and the
 * API client takes the browser to the sign-in page). Cancel answers the
 * change with its refusal, which says what to do.
 */

// What the prompt says it asks for, one sentence for each way of confirming.
export interface PromptDescriptions {
  password: string;
  passwordAndCode: string;
  passwordAndSecurityKey: string;
  passwordAndBackupCode: string;
  passkey: string;
  signInAgain: string;
}

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
  signInAnotherWay: string;
  signInAgainReusedSession: string;
  signInAgainNoSignInTime: string;
  signInAgainHintReusedSession: string;
  signInAgainHintNoSignInTime: string;
  signInAgainHintMicrosoft: string;
  signInAgainHintGoogle: string;
  signInAgainWithLink: string;
  signInAgainVercel: string;
  signInAgainVercelWithLink: string;
  signInAgainVercelWithoutLink: string;
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
  // Signs out, to the sign-in page: an emailed sign-in link stands in.
  signInAnotherWay: translationKey("Sign In Another Way"),
  // Why the last Sign In Again did not confirm it's you (#10217).
  signInAgainReusedSession: translationKey(
    "{{provider}} signed you in with a session it already had, without asking for your password, so it did not confirm it's you. Sign out of {{provider}} first, then click Sign In Again.",
  ),
  signInAgainNoSignInTime: translationKey(
    "{{provider}} did not say when you signed in, so it did not confirm it's you.",
  ),
  // What the person's administrator can change, for each.
  signInAgainHintReusedSession: translationKey(
    "If this keeps happening, ask your administrator to set {{provider}} to honor requests to sign in again, such as Honor Force Authentication in Okta.",
  ),
  signInAgainHintNoSignInTime: translationKey(
    "Ask your administrator to set {{provider}} to send the time you signed in, such as the auth_time claim in Microsoft Entra ID.",
  ),
  signInAgainHintMicrosoft: translationKey(
    "Ask your server's admin to add the auth_time claim to the ID token of the server's Microsoft sign-in app.",
  ),
  signInAgainHintGoogle: translationKey(
    "Ask your server's admin to turn on Session age claims for the server's Google sign-in app.",
  ),
  signInAgainWithLink: translationKey(
    "You can also choose Sign In Another Way, and sign in with a link emailed to you.",
  ),
  /*
   * Sign in with Vercel, which can never confirm it's you (#10331,
   * SignInAgainProvider.Vercel): why, then what does instead - an emailed
   * sign-in link where the server allows one, else a password of their
   * own, which Forgot password? sets.
   */
  signInAgainVercel: translationKey(
    "You signed in with Vercel, which cannot confirm it's you: Vercel cannot be asked to have you sign in again, and does not say when you signed in.",
  ),
  signInAgainVercelWithLink: translationKey(
    "Choose Sign In Another Way, and sign in with a link emailed to you instead.",
  ),
  signInAgainVercelWithoutLink: translationKey(
    "Set a password with Forgot password? on the sign-in page, then confirm it's you with it instead.",
  ),
};

/*
 * What the prompt says, for what the confirmation is for: a change to how
 * you sign in (the words above), deleting your own account, or a master
 * admin's change to how someone else signs in, or to the server's.
 */
export const REAUTHENTICATION_PROMPT_DESCRIPTIONS: Record<
  ReauthenticationPurpose,
  PromptDescriptions
> = {
  [ReauthenticationPurpose.OwnSignIn]: {
    password: REAUTHENTICATION_PROMPT_COPY.password,
    passwordAndCode: REAUTHENTICATION_PROMPT_COPY.passwordAndCode,
    passwordAndSecurityKey: REAUTHENTICATION_PROMPT_COPY.passwordAndSecurityKey,
    passwordAndBackupCode: REAUTHENTICATION_PROMPT_COPY.passwordAndBackupCode,
    passkey: REAUTHENTICATION_PROMPT_COPY.passkey,
    signInAgain: REAUTHENTICATION_PROMPT_COPY.signInAgain,
  },
  [ReauthenticationPurpose.DeleteAccount]: {
    password: translationKey("Enter your password to delete your account."),
    passwordAndCode: translationKey(
      "Enter your password and a code from your authenticator app to delete your account.",
    ),
    passwordAndSecurityKey: translationKey(
      "Enter your password, then use your security key, to delete your account.",
    ),
    passwordAndBackupCode: translationKey(
      "Enter your password and one of your backup codes to delete your account.",
    ),
    passkey: translationKey("Use your passkey to delete your account."),
    signInAgain: translationKey(
      "To delete your account, sign in again first. You'll come back to this page.",
    ),
  },
  [ReauthenticationPurpose.AdminChange]: {
    password: translationKey("Enter your password to make this change."),
    passwordAndCode: translationKey(
      "Enter your password and a code from your authenticator app to make this change.",
    ),
    passwordAndSecurityKey: translationKey(
      "Enter your password, then use your security key, to make this change.",
    ),
    passwordAndBackupCode: translationKey(
      "Enter your password and one of your backup codes to make this change.",
    ),
    passkey: translationKey("Use your passkey to make this change."),
    signInAgain: translationKey(
      "To make this change, sign in again first. You'll come back to this page.",
    ),
  },
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

// What the prompt says it is asking for, and what for.
export const getPromptDescription: (
  methods: ReauthenticationMethods,
  way: SecondStepWay | null,
  purpose?: ReauthenticationPurpose | undefined,
) => string = (
  methods: ReauthenticationMethods,
  way: SecondStepWay | null,
  purpose?: ReauthenticationPurpose | undefined,
): string => {
  const descriptions: PromptDescriptions =
    REAUTHENTICATION_PROMPT_DESCRIPTIONS[
      purpose || ReauthenticationPurpose.OwnSignIn
    ] ||
    REAUTHENTICATION_PROMPT_DESCRIPTIONS[ReauthenticationPurpose.OwnSignIn];

  if (methods.signInAgain) {
    return descriptions.signInAgain;
  }

  if (!methods.password) {
    return descriptions.passkey;
  }

  if (way === SecondStepWay.AuthenticatorApp) {
    return descriptions.passwordAndCode;
  }

  if (way === SecondStepWay.SecurityKey) {
    return descriptions.passwordAndSecurityKey;
  }

  if (way === SecondStepWay.BackupCode) {
    return descriptions.passwordAndBackupCode;
  }

  return descriptions.password;
};

// Why the last Sign In Again did not confirm it's you, and what can change it.
export interface SignInAgainNotice {
  // The English templates, each with {{provider}}: why, then what to do.
  reason: string;
  hint: string | null;
  // Whether to add that an emailed sign-in link stands in.
  offersSignInLink: boolean;
}

/*
 * What the prompt says of a Sign In Again that did not confirm it's you
 * (#10217), or null when the last one did not try, or when it is not known
 * whom it went through. The hint names what the person's administrator can
 * change: their identity provider's setting for a single sign-on; for
 * Microsoft and Google, the server's own app's. Google cannot be asked to
 * ask again at all, so it has no hint for a reused session.
 *
 * A session that signed in with Vercel is told before it tries (#10331):
 * Vercel cannot confirm it's anyone, so the notice says so, and what does
 * instead - an emailed sign-in link where the server allows one, else a
 * password set with Forgot password?.
 */
export const getSignInAgainNotice: (
  signInAgain: ReauthenticationSignInAgain | null,
) => SignInAgainNotice | null = (
  signInAgain: ReauthenticationSignInAgain | null,
): SignInAgainNotice | null => {
  if (signInAgain?.provider === SignInAgainProvider.Vercel) {
    return {
      reason: REAUTHENTICATION_PROMPT_COPY.signInAgainVercel,
      hint: signInAgain.canUseSignInLink
        ? REAUTHENTICATION_PROMPT_COPY.signInAgainVercelWithLink
        : REAUTHENTICATION_PROMPT_COPY.signInAgainVercelWithoutLink,
      // The hint is the way: nothing to add "also".
      offersSignInLink: false,
    };
  }

  if (!signInAgain?.refusal || !signInAgain.providerName) {
    return null;
  }

  const isReused: boolean =
    signInAgain.refusal === SignInAgainRefusal.ReusedSession;

  let hint: string | null = null;

  if (signInAgain.provider === SignInAgainProvider.SingleSignOn) {
    hint = isReused
      ? REAUTHENTICATION_PROMPT_COPY.signInAgainHintReusedSession
      : REAUTHENTICATION_PROMPT_COPY.signInAgainHintNoSignInTime;
  } else if (
    !isReused &&
    signInAgain.provider === SignInAgainProvider.Microsoft
  ) {
    hint = REAUTHENTICATION_PROMPT_COPY.signInAgainHintMicrosoft;
  } else if (!isReused && signInAgain.provider === SignInAgainProvider.Google) {
    hint = REAUTHENTICATION_PROMPT_COPY.signInAgainHintGoogle;
  }

  return {
    reason: isReused
      ? REAUTHENTICATION_PROMPT_COPY.signInAgainReusedSession
      : REAUTHENTICATION_PROMPT_COPY.signInAgainNoSignInTime,
    hint: hint,
    offersSignInLink: signInAgain.canUseSignInLink,
  };
};

/*
 * Where Sign In Again takes the browser: the session's own sign-in, under
 * Identity's address, asking its provider to authenticate the person again
 * (REAUTHENTICATE_QUERY_PARAM); null for the sign-in page.
 */
export const getSignInAgainUrl: (
  signInAgain: ReauthenticationSignInAgain | null,
) => URL | null = (
  signInAgain: ReauthenticationSignInAgain | null,
): URL | null => {
  if (!signInAgain?.route) {
    return null;
  }

  return URL.fromString(IDENTITY_URL.toString())
    .addRoute(signInAgain.route)
    .addQueryParam(REAUTHENTICATE_QUERY_PARAM, "true");
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
  purpose: ReauthenticationPurpose;
  signInAgain: ReauthenticationSignInAgain | null;
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
    purpose: ReauthenticationPurpose,
    resolve: (isConfirmed: boolean) => void,
  ) => Promise<void> = async (
    purpose: ReauthenticationPurpose,
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
      purpose: purpose,
      signInAgain: status.signInAgain,
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
    Reauthentication.setAsker(
      (purpose: ReauthenticationPurpose): Promise<boolean> => {
        return new Promise<boolean>(
          (resolve: (isConfirmed: boolean) => void): void => {
            void open(purpose, resolve);
          },
        );
      },
    );

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
   * a session that ended does.
   *
   * Through the session's own sign-in when the server names it (#10217):
   * its start asks the identity provider to authenticate the person again,
   * and keeps when it sent them, for the sign-in to be held to. Signing out
   * of the provider first would lose that, and the provider is asked to ask
   * again anyway. Otherwise - a sign-in link, a session that does not say,
   * Sign In Another Way - to the sign-in page, through the identity
   * provider's sign-out first where the person's organization asks for it,
   * as Sign Out does.
   */
  const signInAgain: (options: {
    isAnotherWay: boolean;
  }) => Promise<void> = async (options: {
    isAnotherWay: boolean;
  }): Promise<void> => {
    if (busyRef.current) {
      return;
    }

    setBusy(true);
    SessionEndReturn.rememberCurrentPage(UserUtil.getUserId().toString());

    const ownSignIn: URL | null = options.isAnotherWay
      ? null
      : getSignInAgainUrl(promptRef.current?.signInAgain || null);

    const identityProviderSignOutUrl: URL | null = await UserUtil.logout();

    close(false);
    Navigation.navigate(
      ownSignIn || identityProviderSignOutUrl || ACCOUNTS_URL,
    );
  };

  if (!prompt) {
    return <></>;
  }

  const methods: ReauthenticationMethods = prompt.methods;
  const isSignInAgain: boolean = methods.signInAgain;
  const isPasskeyOnly: boolean = !methods.signInAgain && !methods.password;
  const email: Email | null = UserUtil.getEmail();
  const otherWays: Array<SecondStepWay> = getOtherSecondStepWays(methods, way);
  const signInAgainNotice: SignInAgainNotice | null = isSignInAgain
    ? getSignInAgainNotice(prompt.signInAgain)
    : null;
  const providerName: string = prompt.signInAgain?.providerName || "";

  /*
   * Signed in with Vercel, which cannot confirm it's anyone (#10331): its
   * one way is the sign-in page, where an emailed link confirms - named
   * Sign In Another Way where the server allows one, and offered once.
   */
  const isSignedInWithVercel: boolean =
    isSignInAgain &&
    prompt.signInAgain?.provider === SignInAgainProvider.Vercel;
  const isSignInAnotherWayTheWay: boolean =
    isSignedInWithVercel && Boolean(prompt.signInAgain?.canUseSignInLink);

  const submit: () => void = (): void => {
    if (isSignInAgain) {
      void signInAgain({ isAnotherWay: isSignInAnotherWayTheWay });
      return;
    }

    if (isPasskeyOnly) {
      void confirmWithPasskey();
      return;
    }

    void confirmWithPassword();
  };

  const secondaryButton:
    | {
        title: string;
        onClick: () => void;
        disabled: boolean;
        dataTestId: string;
      }
    | undefined =
    methods.passkey && methods.password && !isSignInAgain
      ? {
          title: REAUTHENTICATION_PROMPT_COPY.usePasskey,
          onClick: () => {
            void confirmWithPasskey();
          },
          disabled: isBusy,
          dataTestId: "reauthentication-use-passkey",
        }
      : isSignInAgain &&
          prompt.signInAgain?.canUseSignInLink &&
          !isSignedInWithVercel
        ? {
            title: REAUTHENTICATION_PROMPT_COPY.signInAnotherWay,
            onClick: () => {
              void signInAgain({ isAnotherWay: true });
            },
            disabled: isBusy,
            dataTestId: "reauthentication-sign-in-another-way",
          }
        : undefined;

  return (
    <Modal
      title={
        isSignInAgain
          ? REAUTHENTICATION_PROMPT_COPY.signInAgainTitle
          : REAUTHENTICATION_PROMPT_COPY.title
      }
      description={getPromptDescription(methods, way, prompt.purpose)}
      modalWidth={ModalWidth.Normal}
      submitButtonText={
        isSignInAnotherWayTheWay
          ? REAUTHENTICATION_PROMPT_COPY.signInAnotherWay
          : isSignInAgain
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
      secondaryButton={secondaryButton}
    >
      <div data-testid="reauthentication-prompt">
        {signInAgainNotice ? (
          <Alert
            type={AlertType.WARNING}
            dataTestId="reauthentication-sign-in-again-notice"
            title={
              <div className="space-y-2">
                <p data-testid="reauthentication-sign-in-again-reason">
                  {translator.translateTemplate(signInAgainNotice.reason, {
                    provider: providerName,
                  })}
                </p>
                {signInAgainNotice.hint ? (
                  <p data-testid="reauthentication-sign-in-again-hint">
                    {translator.translateTemplate(signInAgainNotice.hint, {
                      provider: providerName,
                    })}
                  </p>
                ) : (
                  <></>
                )}
                {signInAgainNotice.offersSignInLink ? (
                  <p data-testid="reauthentication-sign-in-again-link">
                    {translator.translateText(
                      REAUTHENTICATION_PROMPT_COPY.signInAgainWithLink,
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            }
          />
        ) : (
          <></>
        )}
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
               * manager may fill it: the one field of each app that asks
               * for it (PasswordManagerCredentialFields).
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
