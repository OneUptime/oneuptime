import PageLogo from "../../Components/Logo/PageLogo";
import API from "../../Utils/API";
import { MAGIC_LINK_LOGIN_API_URL } from "../../Utils/ApiPaths";
import LoginUtil from "../../Utils/Login";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import SignInOptionLink from "Common/UI/Components/SignInOption/SignInOptionLink";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import React, { FunctionComponent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
  // The logo made for the dark theme, shown instead while the page is dark.
  darkThemeLogoFileId?: ObjectID | undefined;
  forceSSO: boolean;
  // Whether the page offers sign-in links (the master-page answer).
  enableMagicLinkLogin: boolean;
}

export const MAGIC_LINK_LOGIN_BUTTON_TEST_ID: string =
  "magic-link-login-submit";
export const MAGIC_LINK_LOGIN_ERROR_TEST_ID: string = "magic-link-login-error";
export const MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID: string =
  "magic-link-login-new-link";

/*
 * The page a sign-in link opens (Types/StatusPage/StatusPageMagicLink):
 * <page>/magic-link-login/<token>. By the time it draws, the token is out of
 * the address bar (SensitiveUrlToken), and no custom code of the page runs
 * here.
 *
 * It signs in only when the reader presses Log in. Mail filters that open
 * every link in an email to scan it - and some run the page's script while
 * they do - would otherwise spend the link before its owner ever saw it,
 * and a link works once.
 *
 * A link the server refuses - used, expired, replaced by a newer one, or
 * from a page that no longer takes them - is dropped from the tab, and the
 * page offers a new link instead. One that could not be checked (the server
 * could not be reached) is kept, so pressing Log in again still works.
 */
const MagicLinkLoginPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { t } = useTranslation();
  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

  // Read once: the link this tab was opened with, or "" when there is none.
  const [token, setToken] = useState<string>(() => {
    return SensitiveUrlToken.read();
  });
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requiresMasterPasswordLock: boolean =
    StatusPageUtil.isPrivateStatusPage() &&
    StatusPageUtil.requiresMasterPassword() &&
    !StatusPageUtil.isMasterPasswordValidated();

  useEffect(() => {
    if (props.forceSSO) {
      // Only SSO signs anybody in to this page: the link is of no use.
      SensitiveUrlToken.clear();
      Navigation.navigate(
        RouteUtil.populateRouteParams(
          !StatusPageUtil.isPreviewPage()
            ? RouteMap[PageMap.SSO]!
            : RouteMap[PageMap.PREVIEW_SSO]!,
        ),
      );
    }
  }, [props.forceSSO]);

  if (!statusPageId) {
    return <></>;
  }

  if (requiresMasterPasswordLock) {
    StatusPageUtil.navigateToMasterPasswordPage();
    return <></>;
  }

  if (!StatusPageUtil.isPrivateStatusPage()) {
    SensitiveUrlToken.clear();
    Navigation.navigate(StatusPageUtil.getDefaultRedirectRoute());
    return <></>;
  }

  // Only SSO signs anybody in here: the effect above sends the reader there.
  if (props.forceSSO) {
    return <></>;
  }

  // Already signed in to this page: the link is not needed.
  if (UserUtil.isLoggedIn(statusPageId)) {
    SensitiveUrlToken.clear();
    Navigation.navigate(StatusPageUtil.getDefaultRedirectRoute());
    return <></>;
  }

  const loginRoute: Route = new Route(
    StatusPageUtil.isPreviewPage()
      ? `/status-page/${statusPageId.toString()}/login`
      : "/login",
  );

  const newLinkRoute: Route = new Route(
    StatusPageUtil.isPreviewPage()
      ? `/status-page/${statusPageId.toString()}/magic-link`
      : "/magic-link",
  );

  const signIn: () => Promise<void> = async (): Promise<void> => {
    setIsSigningIn(true);
    setError(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromURL(MAGIC_LINK_LOGIN_API_URL).addRoute(
            `/${statusPageId.toString()}`,
          ),
          data: { token: token },
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        // Refused for what the link is: it will not work again.
        if (response.statusCode >= 400 && response.statusCode < 500) {
          SensitiveUrlToken.clear();
          setToken("");
        }

        setError(API.getFriendlyMessage(response));
        setIsSigningIn(false);
        return;
      }

      // Spent: no copy of it stays in the tab.
      SensitiveUrlToken.clear();

      LoginUtil.login({
        user: BaseModel.fromJSONObject(response.data, StatusPagePrivateUser),
      });

      const redirectPath: string | null =
        StatusPageUtil.takeMagicLinkRedirect();

      Navigation.navigate(
        redirectPath
          ? new Route(redirectPath)
          : StatusPageUtil.getDefaultRedirectRoute(),
        { forceNavigate: true },
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSigningIn(false);
    }
  };

  /*
   * Why this page cannot sign anybody in, when it cannot: the page no longer
   * takes sign-in links, or the tab has no link (opened without one, or one
   * the server refused, whose reason is shown instead).
   */
  const cannotSignInMessage: string | null = !props.enableMagicLinkLogin
    ? t("accounts.magicLinkLogin.turnedOff")
    : !token && !error
      ? t("accounts.magicLinkLogin.noLink")
      : null;

  const canSignIn: boolean = Boolean(token) && props.enableMagicLinkLogin;

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <PageLogo
          logoFileId={props.logoFileId}
          darkThemeLogoFileId={props.darkThemeLogoFileId}
          altText={props.statusPageName}
        />
        <h2 className="mt-6 break-words text-center text-2xl tracking-tight text-gray-900">
          {t("accounts.magicLinkLogin.title", {
            statusPageName: props.statusPageName || t("common.statusPage"),
          })}
        </h2>
        {canSignIn && (
          <p className="mt-2 text-center text-sm text-gray-600">
            {t("accounts.magicLinkLogin.description")}
          </p>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 space-y-4">
          {(error || cannotSignInMessage) && (
            <Alert
              type={AlertType.DANGER}
              title={error || cannotSignInMessage || ""}
              dataTestId={MAGIC_LINK_LOGIN_ERROR_TEST_ID}
            />
          )}

          {canSignIn && (
            <Button
              title={t("accounts.magicLinkLogin.submit")}
              buttonStyle={ButtonStyleType.PRIMARY}
              isLoading={isSigningIn}
              dataTestId={MAGIC_LINK_LOGIN_BUTTON_TEST_ID}
              style={{ width: "100%", marginInlineStart: "0px" }}
              onClick={() => {
                void signIn();
              }}
            />
          )}

          {/*
           * A new link, drawn as the sign-in page draws its other ways in:
           * an outlined button, as wide as the card, that is still a link.
           */}
          {!canSignIn && props.enableMagicLinkLogin && (
            <SignInOptionLink
              to={newLinkRoute}
              id={MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID}
              dataTestId={MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID}
              icon={IconProp.Email}
              title={t("accounts.magicLinkLogin.requestNewLink")}
            />
          )}
        </div>

        <div className="mt-10 text-center">
          <Link
            to={loginRoute}
            className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
          >
            {t("accounts.sso.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default MagicLinkLoginPage;
