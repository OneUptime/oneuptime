import { SEND_MAGIC_LINK_API_URL } from "../Utils/ApiPaths";
import { SignInMethodsRead, useSignInMethods } from "../Utils/SignInMethods";
import Route from "Common/Types/API/Route";
import { MAGIC_LINK_EXPIRY_MINUTES } from "Common/Types/Accounts/MagicLink";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Captcha from "Common/UI/Components/Captcha/Captcha";
import ModelForm, {
  FormType,
  ModelField,
} from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import {
  CAPTCHA_ENABLED,
  CAPTCHA_SITE_KEY,
  DASHBOARD_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, { MutableRefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const MAGIC_LINK_FORM_TEST_ID: string = "magic-link-form";
export const MAGIC_LINK_SENT_TEST_ID: string = "magic-link-sent";
export const MAGIC_LINK_SEND_ANOTHER_TEST_ID: string =
  "magic-link-send-another";

/*
 * "Sign in with a link", reached from the sign-in page's "Email me a sign-in
 * link" (Common/Types/Accounts/MagicLink): an email address, then "Check your
 * email". The server answers the same whether or not the address has an
 * account - it says nothing about who has one - so the page says "if": a
 * reader who mistyped their address is told where else to look.
 *
 * Offered only where the server takes sign-in links. Anywhere else - a
 * master admin turned them off, or the server requires single sign-on - the
 * page sends its reader to the sign-in page, which offers what the server
 * does take.
 */
const MagicLinkPage: () => JSX.Element = () => {
  const { t } = useTranslation();

  const signInMethodsRead: SignInMethodsRead = useSignInMethods();

  // The address the latest link was asked for: shown once it is sent.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const askingFor: MutableRefObject<string> = useRef<string>("");

  // Asking again starts from an empty form.
  const [formKey, setFormKey] = useState<number>(0);

  const isCaptchaEnabled: boolean =
    CAPTCHA_ENABLED && Boolean(CAPTCHA_SITE_KEY);

  const [shouldResetCaptcha, setShouldResetCaptcha] = useState<boolean>(false);
  const [captchaResetSignal, setCaptchaResetSignal] = useState<number>(0);

  /*
   * A server that takes no sign-in links. Only when it said so: an answer
   * that could not be read leaves the form, and the server decides.
   */
  const isMagicLinkLoginUnavailable: boolean =
    !signInMethodsRead.isReading &&
    signInMethodsRead.signInMethods !== null &&
    !signInMethodsRead.signInMethods.isMagicLinkLoginEnabled;

  useEffect(() => {
    if (UserUtil.isLoggedIn()) {
      Navigation.navigate(DASHBOARD_URL);
    }
  }, []);

  useEffect(() => {
    if (isMagicLinkLoginUnavailable) {
      Navigation.navigate(new Route("/accounts/login"));
    }
  }, [isMagicLinkLoginUnavailable]);

  if (signInMethodsRead.isReading || isMagicLinkLoginUnavailable) {
    return <PageLoader isVisible={true} />;
  }

  let fields: Array<ModelField<User>> = [
    {
      field: {
        email: true,
      },
      title: t("common.email"),
      fieldType: FormFieldSchemaType.Email,
      placeholder: "jeff@example.com",
      required: true,
      disableSpellCheck: true,
      dataTestId: "email",
    },
  ];

  // The request emails an address its caller names, so it carries the captcha where it is on.
  if (isCaptchaEnabled) {
    fields = fields.concat([
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

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <ProductLogo />
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
          {sentTo ? t("magicLink.sentTitle") : t("magicLink.title")}
        </h2>

        {!sentTo && (
          <p className="mt-2 text-balance text-center text-sm text-gray-600 px-2 sm:px-0">
            {t("magicLink.subtitle")}
          </p>
        )}
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
          {sentTo ? (
            <div
              className="space-y-4 text-center text-sm text-gray-600"
              data-testid={MAGIC_LINK_SENT_TEST_ID}
              role="status"
            >
              <p className="break-words">
                {t("magicLink.sent", {
                  email: sentTo,
                  minutes: MAGIC_LINK_EXPIRY_MINUTES,
                })}
              </p>
              <p>{t("magicLink.notReceived")}</p>
              <Button
                title={t("magicLink.sendAnother")}
                buttonStyle={ButtonStyleType.OUTLINE}
                dataTestId={MAGIC_LINK_SEND_ANOTHER_TEST_ID}
                style={{ width: "100%", marginInlineStart: "0px" }}
                onClick={() => {
                  setSentTo(null);
                  setFormKey(formKey + 1);
                }}
              />
            </div>
          ) : (
            <div data-testid={MAGIC_LINK_FORM_TEST_ID}>
              <ModelForm<User>
                key={formKey}
                modelType={User}
                id="magic-link-form"
                name="Sign-In Link"
                createOrUpdateApiUrl={SEND_MAGIC_LINK_API_URL}
                fields={fields}
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

                  askingFor.current = data.email?.toString() || "";
                  return Promise.resolve(data);
                }}
                onLoadingChange={(loading: boolean) => {
                  if (!isCaptchaEnabled) {
                    return;
                  }

                  // A captcha answer works once: a new one for the next request.
                  if (!loading && shouldResetCaptcha) {
                    setShouldResetCaptcha(false);
                    setCaptchaResetSignal((current: number) => {
                      return current + 1;
                    });
                  }
                }}
                onSuccess={() => {
                  setSentTo(askingFor.current);
                }}
                submitButtonText={t("magicLink.submitButton")}
                formType={FormType.Create}
                maxPrimaryButtonWidth={true}
              />
            </div>
          )}
        </div>

        {/*
         * The way back to the password, under the card as on the forgot
         * password page.
         */}
        <div
          className="mt-4 sm:mt-5 text-center"
          data-testid="magic-link-sign-in"
        >
          <p className="text-muted mb-0 text-gray-500 text-sm sm:text-base">
            {t("magicLink.knowPasswordPrompt")}{" "}
            <Link
              to={new Route("/accounts/login")}
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              {t("magicLink.loginLink")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default MagicLinkPage;
