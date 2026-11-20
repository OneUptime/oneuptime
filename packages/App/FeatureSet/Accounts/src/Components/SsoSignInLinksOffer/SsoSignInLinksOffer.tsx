import { SEND_SSO_SIGN_IN_LINKS_API_URL } from "../../Utils/ApiPaths";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Captcha from "Common/UI/Components/Captcha/Captcha";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import { CAPTCHA_ENABLED, CAPTCHA_SITE_KEY } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { useServerCanSendEmail } from "Common/UI/Utils/ServerSending";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * "EMAIL ME MY SIGN-IN LINKS" (#9987), under "Sign in with SSO" when it
 * found no provider for the address's domain: somebody on another domain -
 * a contractor at gmail.com in Acme's project - asks for the SSO sign-in
 * links of the organizations their account belongs to, emailed to the
 * address they typed.
 *
 * Whatever the address, the page says the same thing once it has asked
 * (POST /identity/send-sso-sign-in-links answers every address alike,
 * Common/Types/Accounts/SsoSignInLinks): "if this address belongs to an
 * organization that uses single sign-on, we have emailed it the links". It
 * never says that something was sent, or that nothing was.
 *
 * On a server that cannot send email the offer is not drawn: that is a fact
 * of the server, which the sign-in pages read before anybody types
 * (useServerCanSendEmail). Where the captcha is on, the request carries
 * one, as asking for a sign-in link does: it emails an address its caller
 * names.
 */

export interface ComponentProps {
  // The address the lookup found nothing for: the one the links go to.
  email: string;
}

export const SSO_EMAIL_LINKS_TEST_ID: string = "sso-email-links";
export const SSO_EMAIL_LINKS_BUTTON_TEST_ID: string = "sso-email-links-button";
export const SSO_EMAIL_LINKS_SENT_TEST_ID: string = "sso-email-links-sent";

const SsoSignInLinksOffer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  const canSendEmail: boolean | null = useServerCanSendEmail();

  const isCaptchaEnabled: boolean =
    CAPTCHA_ENABLED && Boolean(CAPTCHA_SITE_KEY);

  const [isSending, setIsSending] = useState<boolean>(false);
  const [isAsked, setIsAsked] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState<number>(0);

  if (canSendEmail === false) {
    return <></>;
  }

  if (isAsked) {
    return (
      <p
        className="mt-5 text-center text-sm text-gray-600 text-balance"
        data-testid={SSO_EMAIL_LINKS_SENT_TEST_ID}
        role="status"
      >
        {t("sso.emailLinksSent")}
      </p>
    );
  }

  const ask: () => Promise<void> = async (): Promise<void> => {
    if (isCaptchaEnabled && !captchaToken) {
      setError(t("sso.emailLinksCaptchaRequired"));
      return;
    }

    setError("");
    setIsSending(true);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: SEND_SSO_SIGN_IN_LINKS_API_URL,
          data: {
            data: { email: props.email },
            ...(isCaptchaEnabled
              ? { miscDataProps: { captchaToken: captchaToken } }
              : {}),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setIsAsked(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSending(false);

      // A captcha's token is good once.
      if (isCaptchaEnabled) {
        setCaptchaToken("");
        setCaptchaResetSignal(captchaResetSignal + 1);
      }
    }
  };

  return (
    <div className="mt-5 space-y-3" data-testid={SSO_EMAIL_LINKS_TEST_ID}>
      <p className="text-center text-sm text-gray-600 text-balance">
        {t("sso.emailLinksPrompt")}
      </p>
      {isCaptchaEnabled && (
        <Captcha
          siteKey={CAPTCHA_SITE_KEY}
          resetSignal={captchaResetSignal}
          onTokenChange={(token: string) => {
            setCaptchaToken(token);
          }}
        />
      )}
      {error && (
        <ErrorLine
          message={error}
          className="text-center text-sm text-red-600"
          dataTestId="sso-email-links-error"
        />
      )}
      <Button
        title={t("sso.emailLinksButton")}
        isTitleTranslated={true}
        buttonStyle={ButtonStyleType.OUTLINE}
        isLoading={isSending}
        dataTestId={SSO_EMAIL_LINKS_BUTTON_TEST_ID}
        style={{ width: "100%", marginInlineStart: "0px" }}
        onClick={() => {
          void ask();
        }}
      />
    </div>
  );
};

export default SsoSignInLinksOffer;
