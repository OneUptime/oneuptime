import ResendVerificationEmail from "../ResendVerificationEmail/ResendVerificationEmail";
import { DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS } from "../../Utils/VerificationEmailResend";
import {
  WebmailProvider,
  getWebmailProvider,
} from "../../Utils/WebmailProvider";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { IconType, ThickProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import React, { ReactElement, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/*
 * The screen a hosted signup lands on: the account exists, no session was
 * started, and nothing more happens until the link in the welcome email is
 * opened.
 *
 * Everything here is about getting that one email opened -- the address it
 * went to (so a typo is noticed now, not after a day of waiting), a shortcut
 * to the inbox for the big webmail services, and a way to get another link
 * that does not involve signing in. The resend button is only offered when
 * /signup handed back a resend token; without one, the old advice stands:
 * signing in with the email and password sends a new link.
 */

export interface ComponentProps {
  email: string;
  resendToken?: string | undefined;
  resendAvailableInSeconds?: number | undefined;
  onUseDifferentEmail?: (() => void) | undefined;
}

/*
 * Stands in for the address while the translated sentence is split around
 * it, so the address can be emphasised wherever each language puts it
 * without the locale files carrying any markup.
 */
const EMAIL_SENTINEL: string = "__ONEUPTIME_EMAIL__";

const VerifyEmailPending: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { t, i18n } = useTranslation();

  const headingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);

  /*
   * The form that was just submitted is gone. Without this, focus falls to
   * <body> and a screen reader user hears nothing about the page that
   * replaced it.
   */
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const webmailProvider: WebmailProvider | null = getWebmailProvider(
    props.email,
  );

  type GetSentToSentenceFunction = () => React.ReactNode;

  const getSentToSentence: GetSentToSentenceFunction = (): React.ReactNode => {
    if (!props.email) {
      return t("register.verifyEmailSent");
    }

    const parts: Array<string> = t("register.verifyEmailSentTo", {
      email: EMAIL_SENTINEL,
    }).split(EMAIL_SENTINEL);

    /*
     * A translation that lost (or doubled) the placeholder still gets the
     * address, just without the emphasis.
     */
    if (parts.length !== 2) {
      return t("register.verifyEmailSentTo", { email: props.email });
    }

    return (
      <>
        {parts[0]}
        <strong
          data-testid="verify-email-address"
          className="font-semibold text-gray-900 [overflow-wrap:anywhere]"
        >
          {/* An address is always left-to-right, even inside Persian text. */}
          <bdi>{props.email}</bdi>
        </strong>
        {parts[1]}
      </>
    );
  };

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <ProductLogo />
        <div
          className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-8 text-center shadow-sm sm:px-8"
          data-testid="verify-email-required"
          dir={i18n.dir()}
        >
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 ring-8 ring-indigo-50 sm:h-20 sm:w-20">
              <Icon
                icon={IconProp.Envelope}
                type={IconType.Info}
                thick={ThickProp.Thick}
                className="h-8 w-8 sm:h-10 sm:w-10"
              />
            </div>
          </div>

          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight text-gray-900 text-balance focus:outline-none sm:text-2xl"
          >
            {t("register.verifyEmailTitle")}
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-600">
            {getSentToSentence()}
          </p>

          {props.onUseDifferentEmail && (
            <p className="mt-2 text-sm text-gray-500">
              {t("register.verifyEmailWrongAddressPrompt")}{" "}
              <button
                type="button"
                data-testid="verify-email-use-different-email"
                onClick={() => {
                  props.onUseDifferentEmail?.();
                }}
                className="rounded font-medium text-indigo-600 underline-offset-2 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {t("register.verifyEmailUseDifferentEmail")}
              </button>
            </p>
          )}

          <p className="mt-3 text-sm leading-6 text-gray-600">
            {t("register.verifyEmailInstructions")}
          </p>

          {/*
           * The href is one of a few fixed inbox URLs, chosen by an exact
           * match on the domain -- never built from the address itself.
           * noopener/noreferrer: the inbox gets neither a handle on this
           * window nor this page's URL.
           */}
          {webmailProvider && (
            <a
              href={webmailProvider.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="open-webmail"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-base font-medium text-white shadow-sm transition-colors duration-150 ease-out hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:text-sm"
            >
              {t("register.verifyEmailOpenProvider", {
                provider: webmailProvider.name,
              })}
              <Icon icon={IconProp.ExternalLink} className="h-4 w-4" />
              <span className="sr-only">
                {t("register.verifyEmailOpensInNewTab")}
              </span>
            </a>
          )}

          <hr className="my-6 border-gray-200" />

          {props.resendToken ? (
            <>
              <p className="text-sm leading-6 text-gray-500">
                {t("register.verifyEmailSpamHint")}
              </p>
              <ResendVerificationEmail
                className="mt-4"
                credential={{ resendToken: props.resendToken }}
                initialCooldownSeconds={
                  props.resendAvailableInSeconds ??
                  DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS
                }
              />
            </>
          ) : (
            <p className="text-sm leading-6 text-gray-500">
              {t("register.verifyEmailResendHint")}
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-gray-600 sm:mt-5">
          {t("register.verifyEmailAlreadyVerifiedPrompt")}{" "}
          <Link
            to={new Route("/accounts/login")}
            className="font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            {t("register.verifyEmailLoginLink")}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default VerifyEmailPending;
