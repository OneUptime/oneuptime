import {
  LOGIN_API_URL,
  VERIFY_TOTP_AUTH_API_URL,
  VERIFY_TOTP_ENROLMENT_API_URL,
  VERIFY_BACKUP_CODE_API_URL,
  GENERATE_BACKUP_CODES_API_URL,
  GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL,
  VERIFY_WEBAUTHN_AUTH_API_URL,
} from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ModelForm, {
  FormType,
  ModelField,
} from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Captcha from "Common/UI/Components/Captcha/Captcha";
import {
  DASHBOARD_URL,
  CAPTCHA_ENABLED,
  CAPTCHA_SITE_KEY,
} from "Common/UI/Config";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import UiAnalytics from "Common/UI/Utils/Analytics";
import LoginUtil from "Common/UI/Utils/Login";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React from "react";
import { useTranslation } from "react-i18next";
import useAsyncEffect from "use-async-effect";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Base64 from "Common/Utils/Base64";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import QRCodeElement from "Common/UI/Components/QR/QR";

/*
 * The misc bag travels on the wire under `_miscData` — the key
 * Response.sendEntityResponse sets. ModelAPI renames it to `miscData` while
 * parsing a response, but the two factor verify calls below post through API
 * directly and bypass that rename, so they read the wire key themselves.
 */
type GetMiscDataFunction = (response: HTTPResponse<JSONObject>) => JSONObject;

const getMiscData: GetMiscDataFunction = (
  response: HTTPResponse<JSONObject>,
): JSONObject => {
  return ((response.data as JSONObject)["_miscData"] as JSONObject) || {};
};

/*
 * How long "Skip for now" means. A week: long enough that the prompt is not a
 * daily toll, short enough that an account with no way back in is reminded
 * again before the phone it depends on is lost.
 */
const BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS: number = 7 * 24 * 60 * 60 * 1000;

const BACKUP_CODE_OFFER_SKIPPED_KEY: string = "backup-code-offer-skipped-at";

const LoginPage: () => JSX.Element = () => {
  const { t } = useTranslation();
  const apiUrl: URL = LOGIN_API_URL;

  if (UserUtil.isLoggedIn()) {
    Navigation.navigate(DASHBOARD_URL);
  }

  const [initialValues, setInitialValues] = React.useState<JSONObject>({});

  const [showTwoFactorAuth, setShowTwoFactorAuth] =
    React.useState<boolean>(false);

  const [totpAuthList, setTotpAuthList] = React.useState<UserTotpAuth[]>([]);

  const [webAuthnList, setWebAuthnList] = React.useState<UserWebAuthn[]>([]);

  const [selectedTotpAuth, setSelectedTotpAuth] = React.useState<
    UserTotpAuth | undefined
  >(undefined);

  const [selectedWebAuthn, setSelectedWebAuthn] = React.useState<
    UserWebAuthn | undefined
  >(undefined);

  /*
   * How many unused recovery codes the account has, as reported by /login
   * alongside the list of factors.
   *
   * It decides what the recovery screen SAYS, never whether that screen can be
   * reached. It used to decide both, and the result was the bug this file was
   * reworked for: because nothing minted codes at setup time, the count was
   * zero for very nearly every account, so the only recovery affordance on the
   * page rendered for very nearly nobody. A user who had lost their phone got
   * a list of one method they could not use and no other text of any kind --
   * indistinguishable from a build where the feature had never shipped.
   *
   * A dead end is worse than a form that refuses: the form at least names the
   * thing they are missing and tells them who can reset it.
   */
  const [backupCodeCount, setBackupCodeCount] = React.useState<number | null>(
    null,
  );

  /*
   * Whether we POSITIVELY KNOW this account has no recovery codes.
   *
   * Deliberately not `!backupCodeCount`. The server OMITS the count when it
   * could not read it, and null therefore means "unknown", not "none" --
   * treating the two the same would tell a user holding ten printed codes
   * that they have none and should go and find an administrator, at the exact
   * moment a transient database fault made the count unreadable. Unknown has
   * to behave like "there may be codes", which is the same rule the profile
   * card applies to the same question.
   */
  const isKnownToHaveNoBackupCodes: boolean = backupCodeCount === 0;

  /*
   * True once the user has chosen to sign in with a recovery code instead of
   * the factor they cannot reach. Kept separate from `selectedTotpAuth` /
   * `selectedWebAuthn` rather than folded in as a third "method", because it
   * is not one -- there is no row to select, and the screen it opens posts to
   * a different endpoint.
   */
  const [isUsingBackupCode, setIsUsingBackupCode] =
    React.useState<boolean>(false);

  /*
   * An authenticated user whose sign-in is finished on the server but is being
   * held here for one more screen: either "save the codes we just minted for
   * you" or "you have no codes, want some?".
   *
   * Held rather than redirected because both screens are about material the
   * dashboard cannot show them later -- the plaintext of a backup code exists
   * exactly once, in the response that carried it. Redirecting first and
   * nagging afterwards would mean nagging with nothing to hand over.
   */
  type PendingLogin = {
    user: User;
    miscData: JSONObject;
  };

  const [pendingLogin, setPendingLogin] = React.useState<
    PendingLogin | undefined
  >(undefined);

  /*
   * Recovery codes to show exactly once, then never again. Either minted by
   * the server as part of a forced enrolment, or generated on request from the
   * screen below.
   */
  const [codesToSave, setCodesToSave] = React.useState<Array<string>>([]);

  /*
   * The user has to tick "I have saved these" before "Continue" will take
   * them to the dashboard. Not ceremony: continuing without saving is
   * unrecoverable, which is the one mistake on this screen that trying again
   * cannot fix.
   */
  const [hasSavedCodes, setHasSavedCodes] = React.useState<boolean>(false);

  const [isGeneratingBackupCodes, setIsGeneratingBackupCodes] =
    React.useState<boolean>(false);
  const [generateBackupCodesError, setGenerateBackupCodesError] =
    React.useState<string>("");

  /*
   * Set when the server answers a password login with "this account is
   * required to use two factor auth and has nothing set up yet". Holding it
   * means the user is mid-enrolment: they have proved their password but they
   * have NO session, and they will not get one until they type a code that
   * verifies against the secret behind this QR code. See
   * App/FeatureSet/Identity/API/Authentication.ts.
   */
  type TotpEnrolment = {
    twoFactorAuthId: string;
    twoFactorOtpUrl: string;
  };

  const [totpEnrolment, setTotpEnrolment] = React.useState<
    TotpEnrolment | undefined
  >(undefined);

  type TwoFactorMethod = {
    type: "totp" | "webauthn";
    item: UserTotpAuth | UserWebAuthn;
  };

  const twoFactorMethods: TwoFactorMethod[] = [
    ...totpAuthList.map((item: UserTotpAuth) => {
      return { type: "totp" as const, item };
    }),
    ...webAuthnList.map((item: UserWebAuthn) => {
      return { type: "webauthn" as const, item };
    }),
  ];

  const [isTwoFactorAuthLoading, setIsTwoFactorAuthLoading] =
    React.useState<boolean>(false);
  const [twofactorAuthError, setTwoFactorAuthError] =
    React.useState<string>("");

  const isCaptchaEnabled: boolean =
    CAPTCHA_ENABLED && Boolean(CAPTCHA_SITE_KEY);

  const [shouldResetCaptcha, setShouldResetCaptcha] =
    React.useState<boolean>(false);
  const [captchaResetSignal, setCaptchaResetSignal] = React.useState<number>(0);

  const handleCaptchaReset: () => void = React.useCallback(() => {
    setCaptchaResetSignal((current: number) => {
      return current + 1;
    });
  }, []);
  let loginFields: Array<ModelField<User>> = [
    {
      field: {
        email: true,
      },
      fieldType: FormFieldSchemaType.Email,
      placeholder: "jeff@example.com",
      required: true,
      disabled: Boolean(initialValues && initialValues["email"]),
      title: t("common.email"),
      dataTestId: "email",
      disableSpellCheck: true,
    },
    {
      field: {
        password: true,
      },
      title: t("common.password"),
      required: true,
      validation: {
        minLength: 6,
      },
      fieldType: FormFieldSchemaType.Password,
      sideLink: {
        text: t("login.forgotPassword"),
        url: new Route("/accounts/forgot-password"),
        openLinkInNewTab: false,
      },
      dataTestId: "password",
      disableSpellCheck: true,
    },
  ];

  if (isCaptchaEnabled) {
    loginFields = loginFields.concat([
      {
        overrideField: {
          captchaToken: true,
        },
        overrideFieldKey: "captchaToken",
        fieldType: FormFieldSchemaType.CustomComponent,
        title: t("captcha.title"),
        description: t("captcha.description"),
        required: true,
        showEvenIfPermissionDoesNotExist: true,
        getCustomElement: (
          _values: FormValues<User>,
          customProps: CustomElementProps,
        ) => {
          return (
            <Captcha
              siteKey={CAPTCHA_SITE_KEY}
              resetSignal={captchaResetSignal}
              error={customProps.error}
              onTokenChange={(token: string) => {
                customProps.onChange?.(token);
              }}
              onBlur={customProps.onBlur}
            />
          );
        },
      },
    ]);
  }

  useAsyncEffect(async () => {
    if (Navigation.getQueryStringByName("email")) {
      setInitialValues({
        email: Navigation.getQueryStringByName("email"),
      });
    }
  }, []);

  useAsyncEffect(async () => {
    if (selectedWebAuthn) {
      setIsTwoFactorAuthLoading(true);
      try {
        const result: HTTPResponse<JSONObject> = await API.post({
          url: GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL,
          data: {
            data: {
              email: initialValues["email"],
            },
          },
        });

        if (result instanceof HTTPErrorResponse) {
          throw result;
        }

        const data: any = result.data as any;

        // Convert base64url strings back to Uint8Array
        data.options.challenge = Base64.base64UrlToUint8Array(
          data.options.challenge,
        );
        if (data.options.allowCredentials) {
          data.options.allowCredentials.forEach((cred: any) => {
            cred.id = Base64.base64UrlToUint8Array(cred.id);
          });
        }

        // Use WebAuthn API
        const credential: PublicKeyCredential =
          (await navigator.credentials.get({
            publicKey: data.options,
          })) as PublicKeyCredential;

        const assertionResponse: AuthenticatorAssertionResponse =
          credential.response as AuthenticatorAssertionResponse;

        // Verify
        const verifyResult: HTTPResponse<JSONObject> = await API.post({
          url: VERIFY_WEBAUTHN_AUTH_API_URL,
          data: {
            data: {
              ...initialValues,
              credential: {
                id: credential.id,
                rawId: Base64.uint8ArrayToBase64Url(
                  new Uint8Array(credential.rawId),
                ),
                response: {
                  authenticatorData: Base64.uint8ArrayToBase64Url(
                    new Uint8Array(assertionResponse.authenticatorData),
                  ),
                  clientDataJSON: Base64.uint8ArrayToBase64Url(
                    new Uint8Array(assertionResponse.clientDataJSON),
                  ),
                  signature: Base64.uint8ArrayToBase64Url(
                    new Uint8Array(assertionResponse.signature),
                  ),
                  userHandle: assertionResponse.userHandle
                    ? Base64.uint8ArrayToBase64Url(
                        new Uint8Array(assertionResponse.userHandle),
                      )
                    : null,
                },
                type: credential.type,
              },
            },
          },
        });

        if (verifyResult instanceof HTTPErrorResponse) {
          throw verifyResult;
        }

        const user: User = User.fromJSON(
          verifyResult.data as JSONObject,
          User,
        ) as User;
        const miscData: JSONObject = getMiscData(verifyResult);

        completeTwoFactorLogin(
          user as User,
          miscData,
          isKnownToHaveNoBackupCodes,
        );
      } catch (error) {
        setTwoFactorAuthError(API.getFriendlyErrorMessage(error as Error));
      }
      setIsTwoFactorAuthLoading(false);
    }
  }, [selectedWebAuthn]);

  type LoginFunction = (user: User, miscData: JSONObject) => void;

  const login: LoginFunction = (user: User, miscData: JSONObject): void => {
    if (user instanceof User && user && user.email) {
      UiAnalytics.userAuth(user.email);
      UiAnalytics.capture("accounts/login");
    }

    LoginUtil.login({
      user: user,
      token: miscData ? miscData["token"] : undefined,
    });
  };

  type ReadBackupCodesFunction = (miscData: JSONObject) => Array<string>;

  /*
   * The plaintext codes a forced enrolment minted, if it minted any.
   *
   * Only the enrolment response ever carries them, and it carries them once:
   * the server stores keyed digests, so this array is the only copy that will
   * ever exist anywhere. Read defensively -- an older server that does not
   * send the key must leave the flow exactly as it was.
   */
  const readBackupCodes: ReadBackupCodesFunction = (
    miscData: JSONObject,
  ): Array<string> => {
    const codes: unknown = miscData["backupCodes"];

    if (!Array.isArray(codes)) {
      return [];
    }

    return codes.map((code: unknown) => {
      return String(code);
    });
  };

  type BackupCodeOfferSuppressedFunction = (user: User) => boolean;

  /*
   * Whether this browser has recently been told to stop asking THIS account to
   * set recovery codes up.
   *
   * The offer below interrupts a sign-in that has already succeeded, which is
   * defensible once and is a tax if it happens on every login for the rest of
   * the account's life. It is worst on an instance where the generate route is
   * failing: a button that cannot work and a link that says "later", every
   * time, with no way to mean it.
   *
   * Bounded rather than permanent. Having no recovery codes is a state that
   * matters and a user who dismisses it today should be asked again -- just
   * not tomorrow. Scoped to the user id so a shared machine does not silence
   * the prompt for the next person to sign in on it.
   *
   * Best effort by design: this is a nag, not a control, so a browser with no
   * usable storage simply gets asked every time rather than failing anything.
   */
  const isBackupCodeOfferSuppressed: BackupCodeOfferSuppressedFunction = (
    user: User,
  ): boolean => {
    try {
      const skippedAt: JSONValue = LocalStorage.getItem(
        `${BACKUP_CODE_OFFER_SKIPPED_KEY}:${user.id?.toString() || ""}`,
      );

      if (!skippedAt) {
        return false;
      }

      const skippedAtMilliseconds: number = Number(skippedAt);

      if (!Number.isFinite(skippedAtMilliseconds)) {
        return false;
      }

      return (
        Date.now() - skippedAtMilliseconds <
        BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS
      );
    } catch {
      return false;
    }
  };

  type SuppressBackupCodeOfferFunction = (user: User) => void;

  const suppressBackupCodeOffer: SuppressBackupCodeOfferFunction = (
    user: User,
  ): void => {
    try {
      LocalStorage.setItem(
        `${BACKUP_CODE_OFFER_SKIPPED_KEY}:${user.id?.toString() || ""}`,
        Date.now().toString(),
      );
    } catch {
      /*
       * Private browsing, a full quota, storage disabled by policy. The user
       * still gets past this screen -- `login()` is called either way -- they
       * are simply asked again next time.
       */
    }
  };

  type CompleteTwoFactorLoginFunction = (
    user: User,
    miscData: JSONObject,
    accountHasNoCodes: boolean,
  ) => void;

  /*
   * Where every SECOND STEP ends -- the TOTP challenge, the security key, the
   * backup code, and the forced enrolment.
   *
   * The server has already signed the user in by the time this runs. What it
   * decides is whether there is one more screen to show before the redirect,
   * and there are exactly two reasons there might be:
   *
   *  - the enrolment just minted a set of recovery codes. They are in this
   *    response and nowhere else, ever, so they get shown before anything
   *    navigates away from them;
   *  - the account signed in with a second factor and has NO recovery codes.
   *    This is the population the whole issue was about: everybody who set two
   *    factor auth up before codes existed, and everybody an admin has just
   *    reset. They are one lost phone from a support ticket and nothing in the
   *    product has ever told them so. The offer is skippable -- being unable
   *    to finish signing in would be a worse bug than the one being fixed --
   *    but it is made at the one moment the user is demonstrably thinking
   *    about their second factor.
   *
   * The plain password login does NOT come through here. An account with no
   * two factor auth at all has no recovery codes to be missing, and prompting
   * it for some would be prompting for a credential to a lock it does not have.
   */
  const completeTwoFactorLogin: CompleteTwoFactorLoginFunction = (
    user: User,
    miscData: JSONObject,
    accountHasNoCodes: boolean,
  ): void => {
    const mintedCodes: Array<string> = readBackupCodes(miscData);

    if (mintedCodes.length > 0) {
      setHasSavedCodes(false);
      setCodesToSave(mintedCodes);
      setPendingLogin({ user: user, miscData: miscData });
      return;
    }

    if (accountHasNoCodes && !isBackupCodeOfferSuppressed(user)) {
      setGenerateBackupCodesError("");
      setPendingLogin({ user: user, miscData: miscData });
      return;
    }

    login(user, miscData);
  };

  type GenerateBackupCodesFunction = () => Promise<void>;

  /*
   * Mint a set for the signed-in user and put it on screen.
   *
   * The session cookie `finalizeUserLogin` set a moment ago is what
   * authenticates this, which is why it can only be offered AFTER the second
   * step and never on the challenge screen itself. The route is the same one
   * the profile card uses.
   */
  const generateBackupCodes: GenerateBackupCodesFunction =
    async (): Promise<void> => {
      setIsGeneratingBackupCodes(true);
      setGenerateBackupCodesError("");

      try {
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post<JSONObject>({
            url: GENERATE_BACKUP_CODES_API_URL,
            data: {},
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const codes: Array<string> = (
          (response.data["codes"] as Array<unknown>) || []
        ).map((code: unknown) => {
          return String(code);
        });

        /*
         * An empty set would leave the user staring at a screen with nothing
         * on it and a Continue button they cannot press, so it is reported as
         * the failure it is rather than rendered.
         */
        if (codes.length === 0) {
          throw new Error(t("login.backupCodes.generateFailed"));
        }

        setHasSavedCodes(false);
        setCodesToSave(codes);
      } catch (error) {
        setGenerateBackupCodesError(
          API.getFriendlyErrorMessage(error as Error),
        );
      }

      setIsGeneratingBackupCodes(false);
    };

  type DownloadBackupCodesFunction = () => void;

  /*
   * Hand the codes over as a file.
   *
   * Offered alongside the on-screen list because the two failure modes are
   * different people: somebody who reads a grid of ten codes and clicks on
   * without copying any of them, and somebody who saves the file and never
   * opens it. Mirrors what the profile card does with the same set, down to
   * the file name, so a user who has both does not end up with two differently
   * named files and no idea which is current.
   */
  const downloadBackupCodes: DownloadBackupCodesFunction = (): void => {
    if (codesToSave.length === 0) {
      return;
    }

    const content: string = [
      t("login.backupCodes.fileHeading"),
      "",
      t("login.backupCodes.fileInstruction"),
      "",
      ...codesToSave,
      "",
    ].join("\n");

    const blob: Blob = new Blob([content], {
      type: "text/plain;charset=utf-8;",
    });
    const url: string = window.URL.createObjectURL(blob);
    const anchor: HTMLAnchorElement = document.createElement("a");
    anchor.href = url;
    anchor.download = "oneuptime-backup-codes.txt";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <img
          className="mx-auto h-10 w-auto sm:h-12"
          src={OneUptimeLogo}
          alt="OneUptime"
        />
        <div className="mt-4 flex justify-center">
          <EditionLabel />
        </div>
        {/*
         * The heading is the only thing on screen that names which of the six
         * states the card below is in, so `pendingLogin` has to come FIRST and
         * every other branch has to exclude it. Without that, somebody being
         * shown the recovery codes their enrolment just minted would read
         * "Select two factor authentication method" over the top of them.
         */}
        {pendingLogin && (
          <>
            <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
              {codesToSave.length > 0
                ? t("login.backupCodes.title")
                : t("login.backupCodes.setUpTitle")}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
              {codesToSave.length > 0
                ? t("login.backupCodes.subtitle")
                : t("login.backupCodes.setUpSubtitle")}
            </p>
          </>
        )}

        {!pendingLogin && !showTwoFactorAuth && !totpEnrolment && (
          <>
            <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
              {t("login.title")}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
              {t("login.subtitle")}
            </p>
          </>
        )}

        {!pendingLogin && showTwoFactorAuth && (
          <>
            <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
              {t("login.twoFactor.title")}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
              {/*
               * "Select two factor authentication method" is true of exactly
               * one of the four screens this heading sits over, and it used to
               * be printed over all four -- including the recovery form, where
               * it tells somebody who has already told us they cannot use
               * their method to go and pick one. It is also wrong on the
               * commonest account there is, the one with a single factor,
               * where nothing is being selected at all.
               */}
              {isUsingBackupCode
                ? t("login.twoFactor.recoverySubtitle")
                : !selectedTotpAuth &&
                    !selectedWebAuthn &&
                    twoFactorMethods.length > 1
                  ? t("login.twoFactor.subtitle")
                  : t("login.twoFactor.confirmSubtitle")}
            </p>
          </>
        )}

        {!pendingLogin && !showTwoFactorAuth && totpEnrolment && (
          <>
            <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
              {t("login.twoFactorEnrolment.title")}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
              {t("login.twoFactorEnrolment.subtitle")}
            </p>
          </>
        )}
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow sm:rounded-lg sm:py-8 sm:px-10 rounded-lg">
          {/*
           * SHOWN ONCE, AND ONLY ONCE.
           *
           * These strings are stored as keyed digests and nothing can produce
           * them again -- not this page after a refresh, not the dashboard,
           * not a master admin, not somebody holding a database dump. So the
           * only way out is "Continue", it is disabled until the checkbox is
           * ticked, and there is deliberately no dismiss, no Escape and no
           * backdrop: every one of those is a way to lose ten codes by reflex,
           * on the screen whose entire purpose is that they are not lost.
           */}
          {pendingLogin && codesToSave.length > 0 && (
            <div className="space-y-4">
              <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-800">
                <span className="font-medium">
                  {t("login.backupCodes.showOnceStrong")}
                </span>{" "}
                {t("login.backupCodes.showOnce")}
              </div>

              <div
                className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4"
                data-testid="backup-codes-list"
              >
                {codesToSave.map((code: string, index: number) => {
                  return (
                    <div
                      key={index}
                      className="font-mono text-sm tracking-wider text-gray-900"
                      data-testid="backup-code-value"
                    >
                      {code}
                    </div>
                  );
                })}
              </div>

              <div>
                <Link
                  onClick={() => {
                    downloadBackupCodes();
                  }}
                  className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                >
                  {t("login.backupCodes.download")}
                </Link>
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="backup-codes-saved-checkbox"
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600"
                  checked={hasSavedCodes}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setHasSavedCodes(event.target.checked);
                  }}
                />
                <span className="text-sm text-gray-700">
                  {t("login.backupCodes.savedConfirmation")}
                </span>
              </label>

              <Button
                title={t("login.backupCodes.continue")}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId="backup-codes-continue"
                disabled={!hasSavedCodes}
                onClick={() => {
                  const finished: PendingLogin = pendingLogin;

                  setCodesToSave([]);
                  setHasSavedCodes(false);
                  setPendingLogin(undefined);

                  login(finished.user, finished.miscData);
                }}
              />
            </div>
          )}

          {/*
           * The offer made to everybody who set two factor auth up before
           * recovery codes existed, and to everybody an admin has just reset.
           * They are signed in at this point; the only thing standing between
           * them and a support ticket is the next lost phone, and this is the
           * one moment in the product where they are demonstrably thinking
           * about their second factor.
           *
           * Skippable, and that is not a hedge. A prompt that could wedge a
           * completed sign-in would be a worse bug than the one being fixed.
           */}
          {pendingLogin && codesToSave.length === 0 && (
            <div className="space-y-4">
              <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-800">
                <span className="font-medium">
                  {t("login.backupCodes.noneStrong")}
                </span>{" "}
                {t("login.backupCodes.none")}
              </div>

              {generateBackupCodesError && (
                <ErrorMessage message={generateBackupCodesError} />
              )}

              <Button
                title={t("login.backupCodes.generate")}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId="generate-backup-codes"
                isLoading={isGeneratingBackupCodes}
                disabled={isGeneratingBackupCodes}
                onClick={() => {
                  generateBackupCodes().catch(() => {
                    /* Surfaced through `generateBackupCodesError` above. */
                  });
                }}
              />

              <div className="text-center">
                <Link
                  onClick={() => {
                    const finished: PendingLogin = pendingLogin;

                    /*
                     * Recorded BEFORE the redirect. `login()` navigates away,
                     * so anything after it in this handler is running in a
                     * page that is being torn down.
                     */
                    suppressBackupCodeOffer(finished.user);

                    setPendingLogin(undefined);
                    login(finished.user, finished.miscData);
                  }}
                  className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                >
                  {t("login.backupCodes.skip")}
                </Link>
              </div>
            </div>
          )}

          {!pendingLogin && !showTwoFactorAuth && !totpEnrolment && (
            <ModelForm<User>
              modelType={User}
              id="login-form"
              name="Login"
              fields={loginFields}
              createOrUpdateApiUrl={apiUrl}
              formType={FormType.Create}
              submitButtonText={t("login.submitButton")}
              onBeforeCreate={(data: User, miscDataProps: JSONObject) => {
                if (isCaptchaEnabled) {
                  const captchaToken: string | undefined = (
                    miscDataProps["captchaToken"] as string | undefined
                  )
                    ?.toString()
                    .trim();

                  if (!captchaToken) {
                    throw new Error(t("captcha.errorOnSignIn"));
                  }

                  miscDataProps["captchaToken"] = captchaToken;
                  setShouldResetCaptcha(true);
                }

                setInitialValues(User.toJSON(data, User));
                return Promise.resolve(data);
              }}
              onLoadingChange={(loading: boolean) => {
                if (!isCaptchaEnabled) {
                  return;
                }

                if (!loading && shouldResetCaptcha) {
                  setShouldResetCaptcha(false);
                  handleCaptchaReset();
                }
              }}
              onSuccess={(
                value: User | JSONObject,
                miscData: JSONObject | undefined,
              ) => {
                /*
                 * Checked BEFORE the two-factor-method lists below, and the
                 * order is load-bearing rather than stylistic. A user being
                 * forced to enrol has ZERO methods set up, so that condition
                 * is false for them -- putting this second would let control
                 * fall straight through to login() and a redirect into a
                 * dashboard the server never authorised, with no session
                 * behind it.
                 */
                if (miscData && miscData["twoFactorEnrolmentRequired"]) {
                  setTotpEnrolment({
                    twoFactorAuthId: miscData["twoFactorAuthId"] as string,
                    twoFactorOtpUrl: miscData["twoFactorOtpUrl"] as string,
                  });
                  return;
                }

                if (
                  miscData &&
                  ((((miscData as JSONObject)["totpAuthList"] as JSONArray)
                    ?.length || 0) > 0 ||
                    (((miscData as JSONObject)["webAuthnList"] as JSONArray)
                      ?.length || 0) > 0)
                ) {
                  const totpAuthList: Array<UserTotpAuth> =
                    UserTotpAuth.fromJSONArray(
                      (miscData as JSONObject)["totpAuthList"] as JSONArray,
                      UserTotpAuth,
                    );
                  const webAuthnList: Array<UserWebAuthn> =
                    UserWebAuthn.fromJSONArray(
                      (miscData as JSONObject)["webAuthnList"] as JSONArray,
                      UserWebAuthn,
                    );
                  setTotpAuthList(totpAuthList);
                  setWebAuthnList(webAuthnList);
                  /*
                   * Absent means "the server could not count them", which is
                   * not the same as zero -- see `isKnownToHaveNoBackupCodes`.
                   */
                  const reportedBackupCodeCount: unknown = (
                    miscData as JSONObject
                  )["backupCodeCount"];

                  setBackupCodeCount(
                    typeof reportedBackupCodeCount === "number"
                      ? reportedBackupCodeCount
                      : null,
                  );
                  setShowTwoFactorAuth(true);
                  return;
                }

                login(value as User, miscData as JSONObject);
              }}
              maxPrimaryButtonWidth={true}
              footer={
                <div className="actions text-center mt-4 hover:underline fw-semibold">
                  <div>
                    <Link to={new Route("/accounts/sso")}>
                      <div className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm">
                        {t("login.useSso")}
                      </div>
                    </Link>
                  </div>
                </div>
              }
            />
          )}

          {!pendingLogin &&
            showTwoFactorAuth &&
            !selectedTotpAuth &&
            !selectedWebAuthn &&
            !isUsingBackupCode && (
              <div className="space-y-4">
                {twoFactorMethods.map(
                  (method: TwoFactorMethod, index: number) => {
                    return (
                      <div
                        key={index}
                        className="cursor-pointer p-4 border border-gray-300 rounded-lg hover:bg-gray-50"
                        onClick={() => {
                          if (method.type === "totp") {
                            setSelectedTotpAuth(method.item as UserTotpAuth);
                          } else {
                            setSelectedWebAuthn(method.item as UserWebAuthn);
                          }
                        }}
                      >
                        <div className="font-medium">
                          {(method.item as any).name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {method.type === "totp"
                            ? t("login.twoFactor.authenticatorApp")
                            : t("login.twoFactor.securityKey")}
                        </div>
                      </div>
                    );
                  },
                )}

                {/*
                 * The recovery link used to live here, gated on the account
                 * having codes. It now lives in the footer below, ungated, so
                 * that it is on the code-entry screen and the security-key
                 * screen too -- see the note there.
                 */}
              </div>
            )}

          {/*
           * THE DEAD END, AND WHAT REPLACED IT.
           *
           * A user who cannot reach their second factor and has no recovery
           * codes used to be shown nothing whatsoever -- the recovery link was
           * hidden from them, and the text explaining what to do instead was
           * never written. They were left on a screen listing the one method
           * they had just told us they could not use.
           *
           * The route out of that is real and has existed all along: an
           * administrator can reset two factor auth on the account, after
           * which the next sign-in enrols a fresh factor. The only thing
           * missing was saying so, to the one person who needs to hear it.
           */}
          {!pendingLogin &&
            showTwoFactorAuth &&
            isUsingBackupCode &&
            isKnownToHaveNoBackupCodes && (
              <div className="space-y-4" data-testid="no-backup-codes">
                <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-800">
                  <span className="font-medium">
                    {t("login.twoFactor.noBackupCodesStrong")}
                  </span>{" "}
                  {t("login.twoFactor.noBackupCodes")}
                </div>

                <p className="text-sm text-gray-600">
                  {t("login.twoFactor.noBackupCodesInstruction")}
                </p>
              </div>
            )}

          {!pendingLogin &&
            showTwoFactorAuth &&
            isUsingBackupCode &&
            !isKnownToHaveNoBackupCodes && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  {t("login.twoFactor.backupCodeInstruction")}
                </p>

                <BasicForm
                  id="two-factor-backup-code-form"
                  name="Two Factor Backup Code"
                  fields={[
                    {
                      field: {
                        backupCode: true,
                      },
                      title: t("login.twoFactor.backupCodeFieldTitle"),
                      description: t(
                        "login.twoFactor.backupCodeFieldDescription",
                      ),
                      required: true,
                      dataTestId: "backup-code",
                      fieldType: FormFieldSchemaType.Text,
                      disableSpellCheck: true,
                    },
                  ]}
                  submitButtonText={t("login.submitButton")}
                  maxPrimaryButtonWidth={true}
                  isLoading={isTwoFactorAuthLoading}
                  error={twofactorAuthError}
                  onSubmit={async (data: JSONObject) => {
                    setIsTwoFactorAuthLoading(true);
                    setTwoFactorAuthError("");

                    try {
                      /*
                       * `initialValues` still holds the email and password from
                       * a moment ago: there is no session to authenticate this
                       * with, and the server re-checks both before it looks at
                       * the code -- exactly as the TOTP challenge above does.
                       *
                       * The code is sent as typed. Hyphens, spacing and case are
                       * normalized server-side, so nothing here has to guess at
                       * the formatting the user's password manager pasted in.
                       */
                      const result:
                        | HTTPErrorResponse
                        | HTTPResponse<JSONObject> = await API.post({
                        url: VERIFY_BACKUP_CODE_API_URL,
                        data: {
                          data: {
                            ...initialValues,
                            backupCode: data["backupCode"] as string,
                          },
                        },
                      });

                      if (result instanceof HTTPErrorResponse) {
                        throw result;
                      }

                      const user: User = User.fromJSON(
                        result["data"] as JSONObject,
                        User,
                      ) as User;
                      const miscData: JSONObject = getMiscData(result);

                      /*
                       * The code they just typed is gone -- single use is the
                       * whole point of it -- so the count the challenge reported
                       * is now one too high. Signing in WITH a recovery code and
                       * having none left afterwards is the clearest "you are one
                       * lost phone from a support ticket" moment this page has,
                       * and passing the stale count would sail straight past it:
                       * this screen is only reachable when the count was above
                       * zero, so the flag would always be false here.
                       *
                       * Unknown stays unknown. A count the server could not read
                       * must not become a claim that the account has nothing.
                       */
                      completeTwoFactorLogin(
                        user,
                        miscData,
                        backupCodeCount !== null && backupCodeCount <= 1,
                      );
                    } catch (error) {
                      setTwoFactorAuthError(
                        API.getFriendlyErrorMessage(error as Error),
                      );
                    }

                    setIsTwoFactorAuthLoading(false);
                  }}
                />
              </div>
            )}

          {!pendingLogin &&
            showTwoFactorAuth &&
            selectedWebAuthn &&
            !isUsingBackupCode && (
              <div className="text-center">
                <div className="text-lg font-medium mb-4">
                  {t("login.twoFactor.authenticatingWithSecurityKey")}
                </div>
                <div className="text-sm text-gray-500 mb-4">
                  {t("login.twoFactor.securityKeyInstructions")}
                </div>
                {isTwoFactorAuthLoading && <ComponentLoader />}
                {twofactorAuthError && (
                  <ErrorMessage message={twofactorAuthError} />
                )}
              </div>
            )}

          {!pendingLogin &&
            showTwoFactorAuth &&
            selectedTotpAuth &&
            !isUsingBackupCode && (
              <BasicForm
                id="two-factor-auth-form"
                name="Two Factor Auth"
                fields={[
                  {
                    field: {
                      code: true,
                    },
                    title: t("common.code"),
                    description: t("login.twoFactor.codeFieldDescription"),
                    required: true,
                    dataTestId: "code",
                    fieldType: FormFieldSchemaType.Text,
                  },
                ]}
                submitButtonText={t("login.submitButton")}
                maxPrimaryButtonWidth={true}
                isLoading={isTwoFactorAuthLoading}
                error={twofactorAuthError}
                onSubmit={async (data: JSONObject) => {
                  setIsTwoFactorAuthLoading(true);

                  try {
                    const code: string = data["code"] as string;
                    const twoFactorAuthId: string =
                      selectedTotpAuth!.id?.toString() as string;

                    const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
                      await API.post({
                        url: VERIFY_TOTP_AUTH_API_URL,
                        data: {
                          data: {
                            ...initialValues,
                            code: code,
                            twoFactorAuthId: twoFactorAuthId,
                          },
                        },
                      });

                    if (result instanceof HTTPErrorResponse) {
                      throw result;
                    }

                    const user: User = User.fromJSON(
                      result["data"] as JSONObject,
                      User,
                    ) as User;
                    const miscData: JSONObject = getMiscData(result);

                    completeTwoFactorLogin(
                      user as User,
                      miscData,
                      isKnownToHaveNoBackupCodes,
                    );
                  } catch (error) {
                    setTwoFactorAuthError(
                      API.getFriendlyErrorMessage(error as Error),
                    );
                  }

                  setIsTwoFactorAuthLoading(false);
                }}
              />
            )}

          {!pendingLogin && !showTwoFactorAuth && totpEnrolment && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {t("login.twoFactorEnrolment.scanInstruction")}
              </p>

              {/*
               * Rendered as a plain element, deliberately NOT as a `required`
               * CustomComponent field of the form below. A QR code collects
               * nothing, so making it a field means inventing a fake value to
               * keep validation happy -- and a form whose validity depends on
               * a decoration is a form that fails for reasons nobody can see.
               */}
              <div className="flex justify-center">
                <QRCodeElement text={totpEnrolment.twoFactorOtpUrl} />
              </div>

              <BasicForm
                id="two-factor-enrolment-form"
                name="Two Factor Auth Enrolment"
                fields={[
                  {
                    field: {
                      code: true,
                    },
                    title: t("common.code"),
                    description: t(
                      "login.twoFactorEnrolment.codeFieldDescription",
                    ),
                    required: true,
                    dataTestId: "enrolment-code",
                    fieldType: FormFieldSchemaType.Text,
                  },
                ]}
                submitButtonText={t("login.twoFactorEnrolment.submitButton")}
                maxPrimaryButtonWidth={true}
                isLoading={isTwoFactorAuthLoading}
                error={twofactorAuthError}
                onSubmit={async (data: JSONObject) => {
                  setIsTwoFactorAuthLoading(true);
                  setTwoFactorAuthError("");

                  try {
                    /*
                     * `initialValues` still holds the email and password the
                     * user submitted a moment ago, because there is no session
                     * to authenticate this request with -- the server issues
                     * one only if the code below verifies. It re-checks the
                     * password and the email verification exactly as /login
                     * did.
                     */
                    const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
                      await API.post({
                        url: VERIFY_TOTP_ENROLMENT_API_URL,
                        data: {
                          data: {
                            ...initialValues,
                            code: data["code"] as string,
                            twoFactorAuthId: totpEnrolment.twoFactorAuthId,
                          },
                        },
                      });

                    if (result instanceof HTTPErrorResponse) {
                      throw result;
                    }

                    const user: User = User.fromJSON(
                      result["data"] as JSONObject,
                      User,
                    ) as User;

                    /*
                     * The misc bag is read here now, where it used to be
                     * discarded with a literal `{}`. It carries the recovery
                     * codes the server minted behind this enrolment, and that
                     * response is the only copy of them there will ever be --
                     * dropping it would sign the user in with ten codes on
                     * their account that nobody has ever seen.
                     */
                    const enrolmentMiscData: JSONObject = getMiscData(result);

                    /*
                     * The challenge response never happened on this path --
                     * /login answered with a QR code -- so there is no count to
                     * read and `backupCodeCount` is still null. The server says
                     * it directly instead: `hasBackupCodes` is sent only when
                     * the enrolment found a set already on the account and so
                     * minted none. Its absence therefore means the account
                     * genuinely has nothing to fall back on, whether that is
                     * because the codes are in this response or because minting
                     * them failed.
                     */
                    completeTwoFactorLogin(
                      user,
                      enrolmentMiscData,
                      enrolmentMiscData["hasBackupCodes"] !== true,
                    );
                  } catch (error) {
                    setTwoFactorAuthError(
                      API.getFriendlyErrorMessage(error as Error),
                    );
                  }

                  setIsTwoFactorAuthLoading(false);
                }}
              />
            </div>
          )}
        </div>
        <div className="mt-6 sm:mt-10 text-center">
          {/*
           * `!showTwoFactorAuth` as well as the three screen flags. Somebody
           * standing at a two factor challenge has an account -- offering them
           * "Don't have an account? Register." was, until the link below
           * existed, the ONLY other thing on the screen for a user who had
           * just lost their phone.
           */}
          {!pendingLogin &&
            !showTwoFactorAuth &&
            !selectedTotpAuth &&
            !selectedWebAuthn &&
            !totpEnrolment &&
            !isUsingBackupCode && (
              <div className="text-muted mb-0 text-gray-500 text-sm sm:text-base">
                {t("login.noAccountPrompt")}{" "}
                <Link
                  to={new Route("/accounts/register")}
                  className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                >
                  {t("login.registerLink")}
                </Link>
              </div>
            )}

          {/*
           * THE LINK THE ISSUE WAS FILED ABOUT.
           *
           * Rendered under EVERY two factor challenge screen -- the method
           * picker, the code entry and the security key -- and rendered
           * whether or not the account has any codes to spend. Both of those
           * are corrections.
           *
           * It used to live inside the method picker only, so the screen the
           * issue actually named (code entry) never carried it: a user staring
           * at a box asking for a code they cannot produce was offered nothing
           * but "select a different method", which returns them to a list of
           * the methods they already cannot use.
           *
           * And it used to be hidden from accounts with no codes, which -- for
           * as long as nothing minted codes at setup time -- meant hidden from
           * essentially everybody. What is behind it for those accounts is not
           * a form that refuses them; it is the sentence naming who can reset
           * their two factor auth, which is the only true answer to their
           * question and one nothing in the product was saying.
           */}
          {!pendingLogin && showTwoFactorAuth && !isUsingBackupCode && (
            <div className="text-muted mb-0 text-gray-500">
              <Link
                onClick={() => {
                  setIsUsingBackupCode(true);
                  setTwoFactorAuthError("");
                }}
                className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
              >
                {/*
                 * "Authenticator" is the wrong noun for somebody whose
                 * hardware key is the thing that is gone, and an affordance a
                 * locked-out user does not recognise as addressed to them is
                 * the same failure the issue was filed about.
                 */}
                {selectedWebAuthn
                  ? t("login.twoFactor.lostAccessSecurityKey")
                  : t("login.twoFactor.lostAccess")}
              </Link>
            </div>
          )}

          {!pendingLogin &&
          (selectedTotpAuth || selectedWebAuthn || isUsingBackupCode) ? (
            <div className="text-muted mb-0 text-gray-500">
              <Link
                onClick={() => {
                  setSelectedTotpAuth(undefined);
                  setSelectedWebAuthn(undefined);

                  /*
                   * Cleared alongside the two selections so this one link
                   * returns the user to the method picker from ANY of the
                   * three challenge screens. Leaving it set would strand
                   * somebody who opened the backup code form by mistake -- the
                   * picker is hidden while it is true, so "go back" would
                   * appear to do nothing.
                   */
                  setIsUsingBackupCode(false);
                  setTwoFactorAuthError("");
                }}
                className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
              >
                {t("login.twoFactor.selectDifferentMethod")}
              </Link>
            </div>
          ) : (
            <></>
          )}

          {/*
           * Without this the enrolment screen is a dead end: the login form is
           * hidden, the register prompt is hidden, and somebody who typed the
           * wrong address has nowhere to go but the browser's back button.
           *
           * It clears the submitted credentials as well as the enrolment,
           * because those are the email and password the next step would
           * re-submit -- leaving them behind would let the previous account's
           * password ride along into a fresh attempt.
           */}
          {!pendingLogin && totpEnrolment ? (
            <div className="text-muted mb-0 text-gray-500">
              <Link
                onClick={() => {
                  setTotpEnrolment(undefined);
                  setTwoFactorAuthError("");
                  setInitialValues({});
                }}
                className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
              >
                {t("login.twoFactorEnrolment.backToSignIn")}
              </Link>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
