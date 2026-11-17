import { RESET_PASSWORD_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  RESET_LINK_MESSAGES,
  isResetLinkRefusal,
} from "Common/Types/Accounts/SignInMessages";
import { SET_PASSWORD_LINK_EXPIRY_DAYS } from "Common/Types/Accounts/SetPasswordLink";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/Types/Translator";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon, { IconType, ThickProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { getNewPasswordFields } from "Common/UI/Components/PasswordRequirements/NewPasswordFields";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import AuthPage, {
  AUTH_PAGE_LINK_CLASS,
} from "Common/UI/Components/AuthPage/AuthPage";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import useTranslator from "Common/UI/Utils/UseTranslator";
import User from "Common/Models/DatabaseModels/User";
import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * Where a reset ends (#9123). It used to end in a sentence and nothing to
 * click: "Your password has been updated. Please sign in." over a link that
 * still asked "Know your password?", and, for a dead link, the server's
 * "Expired link. Please go to forgot password page again" with no way there.
 * Each now ends in the one button that leads on.
 */
enum ResetOutcome {
  // The form, before a reset or after a refused password.
  Form = "Form",
  Reset = "Reset",
  LinkExpired = "LinkExpired",
  // Used already, never sent, or only part of it reached OneUptime.
  LinkInvalid = "LinkInvalid",
}

const BUTTON_CLASS_NAME: string =
  "inline-flex w-full cursor-pointer justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700";

type PageWord =
  | "title"
  | "subtitle"
  | "submitButton"
  | "successTitle"
  | "successDescription"
  | "linkExpiredTitle"
  | "linkExpiredDescription"
  | "linkInvalidTitle"
  | "linkInvalidDescription";

export interface ComponentProps {
  /*
   * The first password of an account a master admin created (Admin
   * Dashboard > Users > Create User, #9139): the link in the "Set your
   * password" email, /accounts/set-password/<token>
   * (Common/Types/Accounts/SetPasswordLink). The same form, the same rule and
   * the same endpoint as a reset - only the words differ, and a dead link
   * cannot be replaced from Forgot password, which asks for an account with
   * a password: whoever created the account sends a new one.
   */
  isSettingFirstPassword?: boolean | undefined;
}

const ResetPasswordPage: (props: ComponentProps) => JSX.Element = (
  props: ComponentProps,
) => {
  const { t } = useTranslation();
  // The page's words: a first password's, or a reset's.
  const words: Record<PageWord, string> = props.isSettingFirstPassword
    ? {
        title: t("setPassword.title"),
        subtitle: t("setPassword.subtitle"),
        submitButton: t("setPassword.submitButton"),
        successTitle: t("setPassword.successTitle"),
        successDescription: t("setPassword.successDescription"),
        linkExpiredTitle: t("setPassword.linkExpiredTitle"),
        linkExpiredDescription: t("setPassword.linkExpiredDescription", {
          days: SET_PASSWORD_LINK_EXPIRY_DAYS,
        }),
        linkInvalidTitle: t("setPassword.linkInvalidTitle"),
        linkInvalidDescription: t("setPassword.linkInvalidDescription"),
      }
    : {
        title: t("resetPassword.title"),
        subtitle: t("resetPassword.subtitle"),
        submitButton: t("resetPassword.submitButton"),
        successTitle: t("resetPassword.successTitle"),
        successDescription: t("resetPassword.successDescription"),
        linkExpiredTitle: t("resetPassword.linkExpiredTitle"),
        linkExpiredDescription: t("resetPassword.linkExpiredDescription"),
        linkInvalidTitle: t("resetPassword.linkInvalidTitle"),
        linkInvalidDescription: t("resetPassword.linkInvalidDescription"),
      };
  const translator: Translator = useTranslator();
  const apiUrl: URL = RESET_PASSWORD_API_URL;
  const passwordRequirementsId: string = useId();
  const [outcome, setOutcome] = useState<ResetOutcome>(ResetOutcome.Form);
  const headingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);

  // The form is gone: focus goes to what replaced it, or a screen reader is left nowhere.
  useEffect(() => {
    if (outcome !== ResetOutcome.Form) {
      headingRef.current?.focus();
    }
  }, [outcome]);

  const knowPasswordLine: JSX.Element = (
    <>
      {t("resetPassword.knowPasswordPrompt")}{" "}
      <Link to={new Route("/accounts/login")} className={AUTH_PAGE_LINK_CLASS}>
        {t("resetPassword.loginLink")}
      </Link>
    </>
  );

  if (outcome === ResetOutcome.Reset) {
    return (
      <AuthPage
        logo={<ProductLogo />}
        cardClassName="text-center"
        cardTestId="reset-password-success"
      >
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50">
            <Icon
              icon={IconProp.Check}
              type={IconType.Success}
              thick={ThickProp.Thick}
              className="h-8 w-8"
            />
          </div>
        </div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-gray-900 focus:outline-none sm:text-2xl"
        >
          {words.successTitle}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600 sm:text-base">
          {words.successDescription}
        </p>
        <div className="mt-6">
          <Link
            to={new Route("/accounts/login")}
            className={BUTTON_CLASS_NAME}
            dataTestId="reset-password-sign-in"
          >
            {t("resetPassword.signInButton")}
          </Link>
        </div>
      </AuthPage>
    );
  }

  if (
    outcome === ResetOutcome.LinkExpired ||
    outcome === ResetOutcome.LinkInvalid
  ) {
    const isExpired: boolean = outcome === ResetOutcome.LinkExpired;

    return (
      <AuthPage
        logo={<ProductLogo />}
        cardClassName="text-center"
        cardTestId="reset-password-link-problem"
        footer={knowPasswordLine}
      >
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 ring-8 ring-amber-50">
            <Icon
              icon={IconProp.Clock}
              type={IconType.Warning}
              thick={ThickProp.Thick}
              className="h-8 w-8"
            />
          </div>
        </div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-gray-900 focus:outline-none sm:text-2xl"
        >
          {isExpired ? words.linkExpiredTitle : words.linkInvalidTitle}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600 sm:text-base">
          {isExpired
            ? words.linkExpiredDescription
            : words.linkInvalidDescription}
        </p>
        {/*
         * A first password's dead link is replaced by whoever created the
         * account, as the words above say: Forgot password would refuse an
         * account with no password. A link already used most likely set it,
         * so that card leads to signing in.
         */}
        {props.isSettingFirstPassword ? (
          isExpired ? (
            <></>
          ) : (
            <div className="mt-6">
              <Link
                to={new Route("/accounts/login")}
                className={BUTTON_CLASS_NAME}
                dataTestId="set-password-sign-in"
              >
                {t("resetPassword.signInButton")}
              </Link>
            </div>
          )
        ) : (
          <div className="mt-6">
            <Link
              to={new Route("/accounts/forgot-password")}
              className={BUTTON_CLASS_NAME}
              dataTestId="reset-password-request-new-link"
            >
              {t("resetPassword.requestNewLinkButton")}
            </Link>
          </div>
        )}
      </AuthPage>
    );
  }

  return (
    <AuthPage
      logo={<ProductLogo />}
      title={words.title}
      subtitle={words.subtitle}
      footer={knowPasswordLine}
    >
      <ModelForm<User>
        modelType={User}
        id="register-form"
        name="Reset Password"
        onBeforeCreate={(item: User): Promise<User> => {
          /*
           * Not a route param: the head bootstrap moves the token out of
           * the path before any third-party tag can report the URL. See
           * Common/UI/Utils/SensitiveUrlToken.
           */
          item.resetPasswordToken = SensitiveUrlToken.read();
          return Promise.resolve(item);
        }}
        showAsColumns={1}
        maxPrimaryButtonWidth={true}
        fields={getNewPasswordFields<User>({
          translator: translator,
          requirementsId: passwordRequirementsId,
          passwordTitle: t("common.newPassword"),
          confirmPasswordTitle: t("common.confirmPassword"),
        })}
        createOrUpdateApiUrl={apiUrl}
        formType={FormType.Create}
        submitButtonText={words.submitButton}
        onSubmitError={(error: string) => {
          /*
           * A dead link is fixed by a new one, never by another password:
           * the page says so and offers the link. A refused password
           * stays on the form, under its field.
           */
          if (!isResetLinkRefusal(error)) {
            return;
          }

          setOutcome(
            error === RESET_LINK_MESSAGES.expired
              ? ResetOutcome.LinkExpired
              : ResetOutcome.LinkInvalid,
          );
        }}
        onSuccess={() => {
          /*
           * Only on success. A rejected reset (expired token, refused
           * password) has to keep the stash so the retry still has a
           * token to submit.
           */
          SensitiveUrlToken.clear();
          setOutcome(ResetOutcome.Reset);
        }}
      />
    </AuthPage>
  );
};

export default ResetPasswordPage;
