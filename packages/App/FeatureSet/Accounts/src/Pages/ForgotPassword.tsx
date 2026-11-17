import { FORGOT_PASSWORD_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import AuthPage, {
  AUTH_PAGE_LINK_CLASS,
} from "Common/UI/Components/AuthPage/AuthPage";
import User from "Common/Models/DatabaseModels/User";
import { useServerCanSendEmail } from "Common/UI/Utils/ServerSending";
import CannotEmailNotice from "../Components/CannotEmailNotice/CannotEmailNotice";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

export const FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID: string =
  "forgot-password-cannot-email";

/*
 * "Forgot your password": an email address, then "we have emailed you the
 * link". A server that cannot send email yet - a fresh self-hosted one, until
 * its admin sets email up - says so before anyone types, and who can let
 * them in instead (GET /global-config/vars' canSendEmail). That is a fact
 * about the server, the same for everyone who opens the page, so it says
 * nothing about any account; the API refuses every address alike too.
 */
const ForgotPassword: () => JSX.Element = () => {
  const { t } = useTranslation();
  const apiUrl: URL = FORGOT_PASSWORD_API_URL;

  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // False only once the server says it cannot send email; the form until then.
  const canSendEmail: boolean | null = useServerCanSendEmail();
  const cannotEmail: boolean = canSendEmail === false;

  return (
    <AuthPage
      logo={<ProductLogo />}
      title={t("forgotPassword.title")}
      subtitle={
        isSuccess
          ? t("forgotPassword.successMessage")
          : cannotEmail
            ? undefined
            : t("forgotPassword.subtitle")
      }
      beforeCard={
        cannotEmail ? (
          <CannotEmailNotice
            testId={FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID}
            text={t("forgotPassword.cannotEmail")}
          />
        ) : undefined
      }
      hasCard={!isSuccess && !cannotEmail}
      cardTestId="forgot-password-card"
      /*
       * The one way back to sign in, under the card as on the register
       * and SSO pages. The card used to have a second one, "Return to
       * Sign in.", a line above this "Sign in.".
       */
      footerTestId="forgot-password-sign-in"
      footer={
        <>
          {t("forgotPassword.rememberPasswordPrompt")}{" "}
          <Link
            to={new Route("/accounts/login")}
            className={AUTH_PAGE_LINK_CLASS}
          >
            {t("forgotPassword.loginLink")}
          </Link>
        </>
      }
    >
      <ModelForm<User>
        modelType={User}
        name="Forgot Password"
        id="login-form"
        createOrUpdateApiUrl={apiUrl}
        fields={[
          {
            field: {
              email: true,
            },
            title: t("common.email"),
            fieldType: FormFieldSchemaType.Email,
            required: true,
            disableSpellCheck: true,
          },
        ]}
        onSuccess={() => {
          setIsSuccess(true);
        }}
        submitButtonText={t("forgotPassword.submitButton")}
        formType={FormType.Create}
        maxPrimaryButtonWidth={true}
      />
    </AuthPage>
  );
};

export default ForgotPassword;
