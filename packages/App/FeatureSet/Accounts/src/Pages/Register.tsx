import { SIGNUP_API_URL } from "../Utils/ApiPaths";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import { fetchIsAwaitingFirstAccount } from "../Utils/FirstAccount";
import {
  isInvitedSignUp,
  shouldAskForCompanyDetails,
} from "../Utils/InvitedSignUp";
import VerifyEmailPending from "../Components/VerifyEmailPending/VerifyEmailPending";
import InvitedSignUpHeader from "../Components/InvitedSignUpHeader/InvitedSignUpHeader";
import InvitedSsoSignIn from "../Components/InvitedSsoSignIn/InvitedSsoSignIn";
import { fetchSignUpInvitation } from "../Utils/SignUpInvitation";
import {
  SIGN_UP_INVITATION_PROJECT_KEY,
  SignUpInvitation,
} from "Common/Types/Accounts/SignUpInvitation";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import {
  UtmPropertyKeys,
  UtmUrlPropertyKey,
} from "Common/Types/Marketing/Attribution";
import {
  RevenueEventName,
  RevenueFunnelStage,
} from "Common/Types/Analytics/RevenueEvent";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelForm, {
  FormType,
  ModelField,
} from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getNewPasswordFields } from "Common/UI/Components/PasswordRequirements/NewPasswordFields";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/Types/Translator";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Link from "Common/UI/Components/Link/Link";
import Captcha from "Common/UI/Components/Captcha/Captcha";
import {
  BILLING_ENABLED,
  DASHBOARD_URL,
  CAPTCHA_ENABLED,
  CAPTCHA_SITE_KEY,
  DISABLE_INSTANCE_CHECK_IN,
  GoogleSignInClientId,
  MicrosoftSignInClientId,
} from "Common/UI/Config";
import GoogleSignInButton from "../Components/GoogleSignInButton/GoogleSignInButton";
import MicrosoftSignInButton from "../Components/MicrosoftSignInButton/MicrosoftSignInButton";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import BaseAPI from "Common/UI/Utils/API/API";
import UiAnalytics from "Common/UI/Utils/Analytics";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import LoginUtil from "Common/UI/Utils/Login";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import Reseller from "Common/Models/DatabaseModels/Reseller";
import User from "Common/Models/DatabaseModels/User";
import React, {
  ComponentType,
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import useAsyncEffect from "use-async-effect";
import { SSO_REQUIRED_SIGN_UP_MESSAGE } from "Common/Types/SSO/SignInMethods";
// Type-only on purpose: the page itself is loaded by the import() below.
import type { ComponentProps as LoginWithSsoPageProps } from "./LoginWithSSO";
import { SignInMethodsRead, useSignInMethods } from "../Utils/SignInMethods";

/*
 * The single sign-on page, drawn in this page's place while the server
 * requires SSO: it loads then, rather than with every sign-up page, as on
 * the sign-in page (packages/Common/Scripts/first-load-budgets.js).
 */
const LoginWithSsoPage: React.LazyExoticComponent<
  ComponentType<LoginWithSsoPageProps>
> = lazy(() => {
  return import("./LoginWithSSO");
});

const RegisterPage: () => JSX.Element = () => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();
  const apiUrl: URL = SIGNUP_API_URL;
  const passwordRequirementsId: string = useId();

  /*
   * Whether the whole server requires single sign-on: an account is then
   * made by signing in with SSO (or by an invitation), never with a
   * password, and the server refuses a sign-up (SsoRequiredSignIn). The page
   * offers SSO in its place - an invitation's sign-up link lands here too.
   */
  const signInMethodsRead: SignInMethodsRead = useSignInMethods();

  const [initialValues, setInitialValues] = React.useState<JSONObject>({});

  /*
   * One visitor is one funnel conversion. A success usually logs the user in
   * and navigates away, but a hosted signup stops at "verify your email", and
   * from there "sign up with a different email" brings the form back for a
   * second account. Both funnel events stay latched across that, so the page
   * still reports a single attempt and a single completion, and sign_up can
   * never outrun signup_started. The corrected address is not lost, though:
   * identifiedEmail remembers who analytics was told about, and a completion
   * under a different address re-identifies the visitor and records
   * accounts/register_email_changed instead of a second conversion.
   */
  const hasCapturedSignupStart: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  // signup_started, once: the form's first submit, or a press of Google or Microsoft.
  const captureSignupStart: () => void = (): void => {
    if (!hasCapturedSignupStart.current) {
      UiAnalytics.captureRevenueEvent(RevenueEventName.SignupStarted, {
        funnel_stage: RevenueFunnelStage.Signup,
      });
      hasCapturedSignupStart.current = true;
    }
  };

  const hasCapturedSignupComplete: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const identifiedEmail: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  const [error, setError] = useState<string>("");

  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const [reseller, setResller] = React.useState<Reseller | undefined>(
    undefined,
  );

  /*
   * A self-hosted server that has no account yet: the account this page
   * creates becomes its admin, and the page says so. OneUptime Cloud never
   * asks. Until the answer lands the page draws nothing of its own, as it
   * does while it reads the sign-in methods: never a "Sign in." link, or a
   * subtitle, that it then swaps for another. The helper answers within a
   * few seconds whatever the server does, so the page always draws.
   */
  const [isAwaitingFirstAccount, setIsAwaitingFirstAccount] =
    React.useState<boolean>(false);

  const [isReadingFirstAccount, setIsReadingFirstAccount] =
    React.useState<boolean>(!BILLING_ENABLED);

  /*
   * The invitation this sign-up link is for (#7471, Utils/SignUpInvitation):
   * which project, who invited them, the name the inviter typed for them.
   * Asked once, with the link's address and token, when the page opens from
   * an invitation; until it answers the page draws nothing of its own, as it
   * does for the first-account answer, so the header never changes under
   * the reader. No invitation - or no answer within a few seconds - is the
   * plain sign-up page.
   */
  const [invitationLink] = React.useState<{
    email: string;
    token: string;
  } | null>(() => {
    const email: string | null = Navigation.getQueryStringByName("email");
    const token: string | null = Navigation.getQueryStringByName("token");

    return isInvitedSignUp({ email, token })
      ? { email: email!.trim(), token: token!.trim() }
      : null;
  });

  const [invitation, setInvitation] = React.useState<SignUpInvitation | null>(
    null,
  );

  const [isReadingInvitation, setIsReadingInvitation] = React.useState<boolean>(
    Boolean(invitationLink),
  );

  React.useEffect(() => {
    if (!invitationLink) {
      return;
    }

    let isCurrent: boolean = true;

    fetchSignUpInvitation(invitationLink)
      .then((found: SignUpInvitation | null) => {
        if (!isCurrent) {
          return;
        }

        setInvitation(found);

        // The name the inviter typed, for them to keep or change.
        if (found?.name) {
          const name: string = found.name;

          setInitialValues((current: JSONObject): JSONObject => {
            return current["name"] ? current : { ...current, name: name };
          });
        }

        setIsReadingInvitation(false);
      })
      .catch(() => {
        // The helper answers none rather than throwing; draw the page anyway.
        if (isCurrent) {
          setIsReadingInvitation(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  /*
   * Creating the account from the invitation joins its project, as the
   * header says: the sign-up names it, and the server accepts it once the
   * token has claimed the account. Someone added already has nothing to
   * accept.
   */
  const joinsProject: boolean = Boolean(invitation && !invitation.isAccepted);

  React.useEffect(() => {
    if (BILLING_ENABLED) {
      return;
    }

    let isCurrent: boolean = true;

    fetchIsAwaitingFirstAccount()
      .then((awaiting: boolean) => {
        if (isCurrent) {
          setIsAwaitingFirstAccount(awaiting);
          setIsReadingFirstAccount(false);
        }
      })
      .catch(() => {
        // The helper answers no rather than throwing; draw the page anyway.
        if (isCurrent) {
          setIsReadingFirstAccount(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  /*
   * Set when the address already had an unclaimed invitation behind it and this
   * request could not prove it owns the mailbox. The API deliberately says the
   * same thing whether or not that was true, so all this page can do -- and all
   * it should do -- is repeat it.
   */
  const [registrationEmailSent, setRegistrationEmailSent] =
    React.useState<boolean>(false);

  /*
   * The address a hosted signup has to verify before it can sign in. Set when
   * the account was created but the API answered `emailVerificationRequired`
   * instead of a session. Kept from the submitted form rather than the
   * response, which deliberately describes no account.
   */
  const [emailAwaitingVerification, setEmailAwaitingVerification] =
    React.useState<string | null>(null);

  const submittedEmail: React.MutableRefObject<Email | null> =
    useRef<Email | null>(null);

  /*
   * The resend credential /signup returned with `emailVerificationRequired`,
   * and how long until the first resend is allowed. Both optional: an older
   * server, or one that could not mint the token, sends neither, and the
   * screen falls back to "sign in to get a new link".
   */
  const [verificationEmailResendToken, setVerificationEmailResendToken] =
    React.useState<string | undefined>(undefined);

  const [
    verificationEmailResendAvailableInSeconds,
    setVerificationEmailResendAvailableInSeconds,
  ] = React.useState<number | undefined>(undefined);

  /*
   * What the visitor typed, kept so "sign up with a different email" can put
   * the form back the way they left it and only the address needs fixing.
   * Deliberately never the password, its confirmation or the captcha token:
   * a secret has no business outliving the request it was typed for, and a
   * captcha answer is single-use anyway.
   */
  const lastSubmittedValues: React.MutableRefObject<JSONObject> =
    useRef<JSONObject>({});

  /*
   * True when the address came in on the link (?email=) -- an invitation, or
   * a marketing page that already asked for it. That address is the one the
   * link was meant for, so it stays read-only, and the "wrong address?"
   * escape hatch is not offered for it.
   */
  const [isEmailLocked, setIsEmailLocked] = React.useState<boolean>(false);

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

  /*
   * "Sign up with a different email" on the verification screen: back to the
   * form, filled in with what was typed last time minus the secrets, with the
   * address editable. Nothing is undone on the server -- the account that
   * was just created cannot be signed into until its address is verified --
   * and the funnel latches above keep this from counting as a new visitor.
   */
  const handleUseDifferentEmail: () => void = (): void => {
    setInitialValues({ ...lastSubmittedValues.current });
    setVerificationEmailResendToken(undefined);
    setVerificationEmailResendAvailableInSeconds(undefined);
    setEmailAwaitingVerification(null);
    setShouldResetCaptcha(false);
  };

  /*
   * A visitor who is already signed in is sent on to the Dashboard -- once,
   * as the page mounts. Not on every render: a signup that signs the account
   * in navigates to the Dashboard itself (LoginUtil.login), and a re-render
   * after that would navigate again and abort the first.
   */
  React.useEffect(() => {
    if (UserUtil.isLoggedIn()) {
      Navigation.navigate(DASHBOARD_URL);
    }
  }, []);

  type FetchResellerFunction = (resellerId: string) => Promise<void>;

  const fetchReseller: FetchResellerFunction = async (
    resellerId: string,
  ): Promise<void> => {
    setIsLoading(true);

    try {
      const reseller: ListResult<Reseller> = await ModelAPI.getList<Reseller>({
        modelType: Reseller,
        query: {
          resellerId: resellerId,
        },
        limit: 1,
        skip: 0,
        select: {
          hidePhoneNumberOnSignup: true,
        },
        sort: {},
        requestOptions: {},
      });

      if (reseller.data.length > 0) {
        setResller(reseller.data[0]);
      }
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    // if promo code is found, please save it in localstorage.
    if (Navigation.getQueryStringByName("promoCode")) {
      LocalStorage.setItem(
        "promoCode",
        Navigation.getQueryStringByName("promoCode"),
      );
    }

    if (Navigation.getQueryStringByName("email")) {
      setInitialValues((current: JSONObject): JSONObject => {
        return {
          ...current,
          email: Navigation.getQueryStringByName("email"),
        };
      });
      setIsEmailLocked(true);
    }

    // if promo code is found, please save it in localstorage.
    if (Navigation.getQueryStringByName("partnerId")) {
      await fetchReseller(Navigation.getQueryStringByName("partnerId")!);
    }
  }, []);

  let formFields: Array<ModelField<User>> = [
    {
      field: {
        email: true,
      },
      fieldType: FormFieldSchemaType.Email,
      sectionTitle: t("Account details"),
      placeholder: "jeff@example.com",
      required: true,
      disabled: isEmailLocked,
      title: t("common.email"),
      dataTestId: "email",
      disableSpellCheck: true,
    },
    {
      field: {
        name: true,
      },
      fieldType: FormFieldSchemaType.Text,
      placeholder: "Jeff Smith",
      required: true,
      title: t("common.fullName"),
      dataTestId: "name",
      disableSpellCheck: true,
    },
  ];

  /*
   * Somebody who was invited is asked for their name and a password only
   * (InvitedSignUp): their project has a company, and a phone number is
   * asked for where it is used, as a notification method.
   */
  const asksForCompanyDetails: boolean = shouldAskForCompanyDetails({
    isInvitedSignUp: isInvitedSignUp({
      email: Navigation.getQueryStringByName("email"),
      token: Navigation.getQueryStringByName("token"),
    }),
  });

  if (BILLING_ENABLED && asksForCompanyDetails) {
    formFields = formFields.concat([
      {
        field: {
          companyName: true,
        },
        fieldType: FormFieldSchemaType.Text,
        placeholder: "Acme, Inc.",
        required: true,
        title: t("common.companyName"),
        dataTestId: "companyName",
        disableSpellCheck: true,
      },
    ]);

    // If reseller wants to hide phone number on sign up, we hide it.
    if (!reseller || !reseller.hidePhoneNumberOnSignup) {
      formFields.push({
        field: {
          companyPhoneNumber: true,
        },
        fieldType: FormFieldSchemaType.Phone,
        required: true,
        placeholder: "+11234567890",
        title: t("common.phoneNumber"),
        dataTestId: "companyPhoneNumber",
      });
    }
  }

  if (!BILLING_ENABLED && asksForCompanyDetails) {
    formFields = formFields.concat([
      {
        overrideField: {
          selfHostedCompanyName: true,
        },
        overrideFieldKey: "selfHostedCompanyName",
        fieldType: FormFieldSchemaType.Text,
        placeholder: "Acme, Inc.",
        required: false,
        title: t("common.companyName"),
        dataTestId: "selfHostedCompanyName",
        showEvenIfPermissionDoesNotExist: true,
        disableSpellCheck: true,
      },
      {
        overrideField: {
          selfHostedPhoneNumber: true,
        },
        overrideFieldKey: "selfHostedPhoneNumber",
        fieldType: FormFieldSchemaType.Phone,
        required: false,
        placeholder: "+11234567890",
        title: t("common.phoneNumber"),
        dataTestId: "selfHostedPhoneNumber",
        showEvenIfPermissionDoesNotExist: true,
      },
    ]);
  }

  formFields = formFields.concat(
    getNewPasswordFields<User>({
      translator: translator,
      requirementsId: passwordRequirementsId,
      passwordTitle: t("common.password"),
      confirmPasswordTitle: t("common.confirmPassword"),
      passwordField: {
        sectionTitle: t("Secure your account"),
        spanFullRow: true,
        dataTestId: "password",
      },
      confirmPasswordField: {
        spanFullRow: true,
        dataTestId: "confirmPassword",
      },
    }) as Array<ModelField<User>>,
  );

  /*
   * With the daily check-in off, this install does not report to
   * oneuptime.com. Both are read from the page's own configuration
   * (Common/UI/Config), not the server's, which would bring the server's
   * whole configuration into the sign-up page.
   */
  if (!BILLING_ENABLED && !DISABLE_INSTANCE_CHECK_IN) {
    formFields = formFields.concat([
      {
        overrideField: {
          notifySelfHosted: true,
        },
        overrideFieldKey: "notifySelfHosted",

        fieldType: FormFieldSchemaType.Checkbox,
        required: false,
        defaultValue: true,
        title: t("register.notifySelfHosted"),
        dataTestId: "notifySelfHosted",
        showEvenIfPermissionDoesNotExist: true,
        spanFullRow: true,
      },
    ]);
  }

  if (isCaptchaEnabled) {
    formFields = formFields.concat([
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

  if (signInMethodsRead.isReading) {
    return <AuthPageSkeleton fields={3} />;
  }

  if (signInMethodsRead.signInMethods?.isSsoRequired) {
    return (
      // While it loads, the shape the single sign-on page draws as it reads.
      <Suspense fallback={<AuthPageSkeleton fields={1} />}>
        <LoginWithSsoPage signInMethods={signInMethodsRead.signInMethods} />
      </Suspense>
    );
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // The form's own header and links wait for the first-account answer too.
  if (isLoading || isReadingFirstAccount || isReadingInvitation) {
    return <AuthPageSkeleton fields={3} />;
  }

  /*
   * An invitation whose person signs in with single sign-on (#9819): their
   * project's providers, in place of a password they could not set.
   */
  if (invitation?.ssoSignIn) {
    return <InvitedSsoSignIn invitation={invitation} />;
  }

  if (emailAwaitingVerification !== null) {
    return (
      <VerifyEmailPending
        email={emailAwaitingVerification}
        resendToken={verificationEmailResendToken}
        resendAvailableInSeconds={verificationEmailResendAvailableInSeconds}
        onUseDifferentEmail={
          isEmailLocked ? undefined : handleUseDifferentEmail
        }
      />
    );
  }

  if (registrationEmailSent) {
    return (
      <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md mx-auto">
          <ProductLogo />
          <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
            {t("register.checkEmailTitle")}
          </h2>
          <p className="mt-2 text-balance text-center text-sm text-gray-600 px-2 sm:px-0">
            {t("register.checkEmailMessage")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col justify-center px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="w-full max-w-md mx-auto lg:max-w-2xl">
        <ProductLogo />
        {/*
         * Opened from an invitation the server could read: which project,
         * and who invited them, in place of the plain sign-up's words.
         */}
        {invitation ? (
          <InvitedSignUpHeader invitation={invitation} />
        ) : (
          <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight text-gray-900 sm:mt-6 sm:text-3xl">
            {t("register.title")}
          </h1>
        )}
        {/*
         * OneUptime Cloud's line asks people to join. A self-hosted server
         * has a line only while it has no account yet: the account made here
         * becomes its admin. Otherwise the title says it all - a line that
         * repeated "create your account" under it was only clutter.
         */}
        {!invitation && (BILLING_ENABLED || isAwaitingFirstAccount) ? (
          <p
            className="mx-auto mt-3 max-w-md text-balance text-center text-sm leading-6 text-gray-600"
            data-testid="register-subtitle"
          >
            {BILLING_ENABLED
              ? t("register.subtitle")
              : t("register.firstAccountSubtitle")}
          </p>
        ) : (
          <></>
        )}
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto lg:max-w-2xl">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 shadow-sm sm:px-8 sm:py-8">
          <ModelForm<User>
            modelType={User}
            id="register-form"
            showAsColumns={reseller ? 1 : 2}
            name="Register"
            initialValues={initialValues}
            maxPrimaryButtonWidth={true}
            fields={formFields}
            createOrUpdateApiUrl={apiUrl}
            onBeforeCreate={(
              item: User,
              miscDataProps: JSONObject,
            ): Promise<User> => {
              captureSignupStart();

              submittedEmail.current = item.email || null;

              /*
               * Plain strings, so the form can be prefilled with them later.
               * Never password, confirmPassword or captchaToken -- see
               * lastSubmittedValues.
               */
              const valuesToKeep: Array<[string, string | undefined]> = [
                ["email", item.email?.toString()],
                ["name", item.name?.toString()],
                ["companyName", item.companyName?.toString()],
                ["companyPhoneNumber", item.companyPhoneNumber?.toString()],
                [
                  "selfHostedCompanyName",
                  miscDataProps["selfHostedCompanyName"]?.toString(),
                ],
                [
                  "selfHostedPhoneNumber",
                  miscDataProps["selfHostedPhoneNumber"]?.toString(),
                ],
              ];

              const keptValues: JSONObject = {};

              for (const [key, value] of valuesToKeep) {
                if (value) {
                  keptValues[key] = value;
                }
              }

              lastSubmittedValues.current = keptValues;
              if (isCaptchaEnabled) {
                const captchaToken: string | undefined = (
                  miscDataProps["captchaToken"] as string | undefined
                )
                  ?.toString()
                  .trim();

                if (!captchaToken) {
                  throw new Error(t("captcha.errorOnSignUp"));
                }

                miscDataProps["captchaToken"] = captchaToken;
                setShouldResetCaptcha(true);
              }

              /*
               * Carried straight through from the invitation link. Read here
               * rather than held in state so a token that arrives with the URL
               * cannot be lost to a stale closure, and passed as a miscDataProp
               * rather than a User field because it authorizes the request --
               * it is not part of the account being created.
               */
              const registrationToken: string | null =
                Navigation.getQueryStringByName("token");

              if (registrationToken) {
                miscDataProps["registrationToken"] = registrationToken;
              }

              // The project the header said creating the account joins.
              if (joinsProject && invitation) {
                miscDataProps[SIGN_UP_INVITATION_PROJECT_KEY] =
                  invitation.projectId;
              }

              const utmParams: Dictionary<string> = UserUtil.getUtmParams();

              if (utmParams && Object.keys(utmParams).length > 0) {
                /*
                 * Driven from the shared contract rather than hand-listed. A
                 * UTM key added to Common/Types/Marketing/Attribution.ts is
                 * captured by the marketing site, whitelisted by the server
                 * door and stored here without this file having to be
                 * remembered — which is how utm_id and its three siblings were
                 * silently dropped at signup while travelling everywhere else.
                 */
                const fields: JSONObject = item as unknown as JSONObject;

                for (const propertyKey of [
                  ...UtmPropertyKeys,
                  UtmUrlPropertyKey,
                ]) {
                  fields[propertyKey] = utmParams[propertyKey] || "";
                }

                UiAnalytics.capture("utm_event", utmParams);
              }

              /*
               * Ad platform click IDs (gclid, fbclid, ...) for offline
               * conversion uploads, and the visitor's first attributed touch.
               */
              const clickIds: JSONObject | null =
                UserUtil.getAttributionClickIds();

              if (clickIds) {
                item.clickIds = clickIds;
              }

              const firstTouch: JSONObject | null =
                UserUtil.getFirstTouchAttribution();

              if (firstTouch) {
                item.firstTouchAttribution = firstTouch;
              }

              return Promise.resolve(item);
            }}
            formType={FormType.Create}
            submitButtonText={
              joinsProject
                ? t("register.joinButton")
                : t("register.submitButton")
            }
            onSubmitError={(message: string) => {
              /*
               * The server came to require SSO after this page read that it
               * did not: read again, and the page offers SSO instead.
               */
              if (message === SSO_REQUIRED_SIGN_UP_MESSAGE) {
                signInMethodsRead.readAgain();
              }
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
            onSuccess={(value: User, miscData: JSONObject | undefined) => {
              /*
               * No account was created or claimed: a link went to the address
               * instead. There is no session to start, and nothing here counts
               * as a completed signup, so this returns before the analytics and
               * the login below.
               */
              if (miscData && miscData["registrationEmailSent"]) {
                setRegistrationEmailSent(true);
                return;
              }

              /*
               * A completed sign-up for the funnel, with no session yet. A
               * server that proves addresses by email answers every address
               * alike (#9816), so this counts sign-ups people finished, an
               * address that already had an account included - its owner
               * was emailed instead; the server's own server/user_created
               * counts the accounts made. The response carries no account to
               * read the address from.
               */
              const isEmailVerificationRequired: boolean = Boolean(
                miscData && miscData["emailVerificationRequired"],
              );

              const signedUpEmail: Email | null =
                value?.email ||
                (isEmailVerificationRequired ? submittedEmail.current : null);

              if (signedUpEmail && !hasCapturedSignupComplete.current) {
                hasCapturedSignupComplete.current = true;
                identifiedEmail.current = signedUpEmail.toString();
                UiAnalytics.userAuth(signedUpEmail);
                UiAnalytics.capture("accounts/register");
                UiAnalytics.captureRevenueEvent(
                  RevenueEventName.SignupCompleted,
                  { funnel_stage: RevenueFunnelStage.Signup },
                );
              } else if (
                signedUpEmail &&
                identifiedEmail.current !== signedUpEmail.toString()
              ) {
                /*
                 * The same visitor, signing up again under a corrected
                 * address. Not a second conversion; analytics just follows
                 * them to the address they actually use.
                 */
                identifiedEmail.current = signedUpEmail.toString();
                UiAnalytics.userAuth(signedUpEmail);
                UiAnalytics.capture("accounts/register_email_changed");
              }

              if (isEmailVerificationRequired) {
                /*
                 * Only what the screen can use: a non-empty string and a
                 * finite number. Anything else -- including an older server
                 * that sends neither -- leaves the screen on its "sign in to
                 * get a new link" fallback.
                 */
                const resendToken: unknown = miscData
                  ? miscData["verificationEmailResendToken"]
                  : undefined;
                const resendAvailableInSeconds: unknown = miscData
                  ? miscData["verificationEmailResendAvailableInSeconds"]
                  : undefined;

                setVerificationEmailResendToken(
                  typeof resendToken === "string" && resendToken
                    ? resendToken
                    : undefined,
                );
                setVerificationEmailResendAvailableInSeconds(
                  typeof resendAvailableInSeconds === "number" &&
                    Number.isFinite(resendAvailableInSeconds)
                    ? resendAvailableInSeconds
                    : undefined,
                );
                setEmailAwaitingVerification(
                  submittedEmail.current?.toString() || "",
                );
                return;
              }

              LoginUtil.login({
                user: value,
                token: miscData ? miscData["token"] : undefined,
              });
            }}
          />
          {/*
           * The other ways to sign up, where this server offers them -
           * Google, then Microsoft: under "or", drawn as the sign-in page
           * draws its other ways in. Pressing one starts a sign-up, as the
           * form's first submit does; the account is made on the way back.
           */}
          {GoogleSignInClientId || MicrosoftSignInClientId ? (
            <div data-testid="sign-up-options">
              <LabelledDivider
                label={t("common.or")}
                className="my-5"
                dataTestId="sign-up-options-divider"
              />
              <div className="space-y-3">
                {GoogleSignInClientId ? (
                  <GoogleSignInButton
                    title={t("common.continueWithGoogle")}
                    onPress={captureSignupStart}
                  />
                ) : (
                  <></>
                )}
                {MicrosoftSignInClientId ? (
                  <MicrosoftSignInButton
                    title={t("register.signUpWithMicrosoft")}
                    onPress={captureSignupStart}
                  />
                ) : (
                  <></>
                )}
              </div>
            </div>
          ) : (
            <></>
          )}
          {/* Only OneUptime Cloud takes payment: a self-hosted server never asks for a card. */}
          {BILLING_ENABLED ? (
            <p
              className="mt-4 text-center text-xs leading-5 text-gray-500"
              data-testid="register-no-credit-card"
            >
              {t("register.noCreditCard")}
            </p>
          ) : (
            <></>
          )}
        </div>
        {/* A server with no account yet has nobody to sign in as. */}
        {isAwaitingFirstAccount ? (
          <></>
        ) : (
          <div
            className="mt-4 sm:mt-5 text-center text-gray-500"
            data-testid="register-have-account"
          >
            <p className="text-sm text-gray-600">
              {t("register.haveAccountPrompt")}{" "}
              <Link
                to={new Route("/accounts/login")}
                className="font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                {t("register.loginLink")}
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegisterPage;
