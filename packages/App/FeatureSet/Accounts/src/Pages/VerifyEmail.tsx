import { VERIFY_EMAIL_API_URL } from "../Utils/ApiPaths";
import ResendVerificationEmail from "../Components/ResendVerificationEmail/ResendVerificationEmail";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon, { IconType, ThickProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const VerifyEmail: () => JSX.Element = () => {
  const { t, i18n } = useTranslation();
  const apiUrl: URL = VERIFY_EMAIL_API_URL;
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * Whether the server turned THIS LINK down (a 4xx: expired, unknown,
   * malformed) as opposed to not answering properly (a 5xx, a network error).
   * The first is fixed by a new link, the second by trying the same one
   * again, and the page offers exactly that.
   */
  const [hasLinkProblem, setHasLinkProblem] = useState<boolean>(false);

  /*
   * The token this page was opened with. Kept past the failed attempt
   * because a rejected link is still a credential for asking for a new one:
   * the server mails the address the account already holds, and only when it
   * is the one this token was sent to.
   */
  const [linkToken, setLinkToken] = useState<string>("");

  const successHeadingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);

  const shouldFocusSuccessHeading: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const init: PromiseVoidFunction = async (): Promise<void> => {
    // Ping an API here.
    setError("");
    setHasLinkProblem(false);
    setIsLoading(true);

    /*
     * Not a route param: the head bootstrap moves the token out of the path
     * before any third-party tag can report the URL. See
     * Common/UI/Utils/SensitiveUrlToken. Read once, before anything below can
     * clear it.
     */
    const token: string = SensitiveUrlToken.read();
    setLinkToken(token);

    try {
      // strip data.
      const emailverificationToken: EmailVerificationToken =
        new EmailVerificationToken();
      emailverificationToken.token = new ObjectID(token);

      await ModelAPI.createOrUpdate<EmailVerificationToken>({
        model: emailverificationToken,
        modelType: EmailVerificationToken,
        formType: FormType.Create,
        miscDataProps: {},
        requestOptions: {
          overrideRequestUrl: apiUrl,
        },
      });

      // Verified; the token is spent and must not outlive the page.
      SensitiveUrlToken.clear();
    } catch (err) {
      const isLinkProblem: boolean =
        err instanceof HTTPErrorResponse &&
        err.statusCode >= 400 &&
        err.statusCode < 500;

      setHasLinkProblem(isLinkProblem);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  type RunInitFunction = () => void;

  const runInit: RunInitFunction = (): void => {
    init().catch((err: Error) => {
      setError(err.toString());
      setIsLoading(false);
    });
  };

  useEffect(() => {
    runInit();
  }, []);

  /*
   * Asking for a new link found the account already verified -- another tab,
   * or a mail scanner that followed an earlier link -- so this page switches
   * to the success view. Focus follows, or a screen reader user is left on a
   * button that no longer exists.
   */
  useEffect(() => {
    if (error || !shouldFocusSuccessHeading.current) {
      return;
    }

    shouldFocusSuccessHeading.current = false;
    successHeadingRef.current?.focus();
  }, [error]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  /*
   * Only a well-formed token is offered as a credential: anything else could
   * never be a verification token the server issued, and a button that can
   * only fail is worse than the plain "sign in to get a new link" advice.
   */
  const canRequestNewLink: boolean =
    hasLinkProblem && ObjectID.isValidUUID(linkToken);

  return (
    <div className="flex w-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center sm:mb-10">
          <ProductLogo
            className="mx-auto h-10 w-auto sm:h-12"
          />
        </div>

        <div
          className="rounded-xl bg-white px-6 py-8 shadow-sm ring-1 ring-gray-100 sm:px-10 sm:py-10"
          dir={i18n.dir()}
        >
          {!error && (
            <div className="text-center" data-testid="verify-email-success">
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50">
                  <Icon
                    icon={IconProp.Check}
                    type={IconType.Success}
                    thick={ThickProp.Thick}
                    className="h-10 w-10"
                  />
                </div>
              </div>
              <h1
                ref={successHeadingRef}
                tabIndex={-1}
                className="text-xl font-semibold tracking-tight text-gray-900 focus:outline-none sm:text-2xl"
              >
                {t("verifyEmail.successTitle")}
              </h1>
              <p className="mt-3 px-2 text-sm leading-relaxed text-gray-600 sm:px-0 sm:text-base">
                {t("verifyEmail.successDescription")}
              </p>
              {/*
               * Verifying signs nobody in -- the link is a bearer secret sat
               * in an inbox, and mail scanners follow links -- so the next
               * step for a new account is always the sign-in page.
               */}
              <div className="mt-6">
                <Link
                  to={new Route("/accounts/login")}
                  className="inline-flex w-full cursor-pointer justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
                >
                  {t("verifyEmail.continueToSignIn")}
                </Link>
              </div>
            </div>
          )}

          {error && (
            <div className="text-center" data-testid="verify-email-error">
              {canRequestNewLink && (
                <>
                  <div className="mb-6 flex justify-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 ring-8 ring-amber-50">
                      <Icon
                        icon={IconProp.Clock}
                        type={IconType.Warning}
                        thick={ThickProp.Thick}
                        className="h-10 w-10"
                      />
                    </div>
                  </div>
                  <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
                    {t("verifyEmail.linkInvalidTitle")}
                  </h1>
                  {/*
                   * Not the server's message: that one tells people to sign
                   * in for a new link, and the button below is the easier
                   * way to get one.
                   */}
                  <p className="mt-3 px-2 text-sm leading-relaxed text-gray-600 sm:px-0 sm:text-base">
                    {t("verifyEmail.requestNewLinkDescription")}
                  </p>
                  <ResendVerificationEmail
                    className="mt-6"
                    credential={{ verificationToken: linkToken }}
                    onAlreadyVerified={() => {
                      // Nothing left for this token to do.
                      SensitiveUrlToken.clear();
                      shouldFocusSuccessHeading.current = true;
                      setHasLinkProblem(false);
                      setError("");
                    }}
                  />
                </>
              )}

              {!canRequestNewLink && (
                <>
                  <div className="mb-6 flex justify-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100 ring-8 ring-red-50">
                      <Icon
                        icon={IconProp.Close}
                        type={IconType.Danger}
                        thick={ThickProp.Thick}
                        className="h-10 w-10"
                      />
                    </div>
                  </div>
                  <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
                    {hasLinkProblem
                      ? t("verifyEmail.linkInvalidTitle")
                      : t("verifyEmail.errorTitle")}
                  </h1>
                  <p className="mt-3 px-2 text-sm leading-relaxed text-gray-600 sm:px-0 sm:text-base">
                    {error}
                  </p>
                  {/*
                   * The server did not answer properly, which says nothing
                   * about the link -- the same link may well work a moment
                   * from now.
                   */}
                  {!hasLinkProblem && (
                    <div className="mt-6">
                      <Button
                        buttonStyle={ButtonStyleType.PRIMARY}
                        title={t("verifyEmail.tryAgain")}
                        dataTestId="verify-email-try-again"
                        className="w-full justify-center"
                        style={{ width: "100%", marginLeft: 0 }}
                        onClick={() => {
                          runInit();
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-6 text-center sm:mt-8">
            <p className="text-sm text-gray-500 sm:text-base">
              {t("verifyEmail.returnToSignIn")}{" "}
              <Link
                to={new Route("/accounts/login")}
                className="cursor-pointer font-medium text-indigo-500 hover:text-indigo-700"
              >
                {t("verifyEmail.loginLink")}
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
