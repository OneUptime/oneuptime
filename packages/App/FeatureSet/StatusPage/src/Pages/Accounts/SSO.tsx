import PageLogo from "../../Components/Logo/PageLogo";
import {
  STATUS_PAGE_API_URL,
  STATUS_PAGE_OIDC_API_URL,
  STATUS_PAGE_SSO_API_URL,
} from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelList from "Common/UI/Components/ModelList/ModelList";
import SignInOptionLink from "Common/UI/Components/SignInOption/SignInOptionLink";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import React, { FunctionComponent, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
  // The logo made for the dark theme, shown instead while the page is dark.
  darkThemeLogoFileId?: ObjectID | undefined;
  /*
   * The page requires SSO (Require SSO for Login): its private users can't
   * sign in with an email and password, so the page offers no way back to
   * the password form - the sign-in page would only send them here again.
   */
  forceSSO?: boolean | undefined;
}

// The way back to the email and password form, under the providers.
export const PASSWORD_SIGN_IN_OPTION_TEST_ID: string = "password-login";
export const SSO_SIGN_IN_OPTIONS_TEST_ID: string = "sign-in-options";

const LoginPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  /*
   * How many providers each list loaded (null until it has). When both are
   * empty there is nothing to sign in with - no SAML or OIDC provider is
   * enabled for this status page - so the page says so and links back to
   * sign-in.
   *
   * That notice is the ONLY message then: neither list shows an empty state of
   * its own (hideEmptyState), and both stay mounted but hidden, so they keep
   * their loaded state and add no blank space above the notice. An empty
   * list next to one with providers is hidden too, rather than "No items
   * found." - or the blank space of an empty list - under a provider that is
   * right there.
   *
   * The lists' own padding is taken back (-mx-2, and the last list's mb-5),
   * so a provider's card lines up with Log in with password under it, and
   * the "or" sits as far below the cards as it sits below the sign-in
   * page's button.
   */
  const [ssoProviderCount, setSsoProviderCount] = useState<number | null>(null);
  const [oidcProviderCount, setOidcProviderCount] = useState<number | null>(
    null,
  );
  const statusPageObjectId: ObjectID | null = StatusPageUtil.getStatusPageId();
  const statusPageId: string | undefined = statusPageObjectId?.toString();
  const requiresMasterPasswordLock: boolean =
    StatusPageUtil.isPrivateStatusPage() &&
    StatusPageUtil.requiresMasterPassword() &&
    !StatusPageUtil.isMasterPasswordValidated();

  if (!statusPageObjectId) {
    return <></>;
  }

  if (requiresMasterPasswordLock) {
    StatusPageUtil.navigateToMasterPasswordPage();
    return <></>;
  }

  if (!StatusPageUtil.isPrivateStatusPage()) {
    Navigation.navigate(
      new Route(
        StatusPageUtil.isPreviewPage()
          ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
          : "/",
      ),
    );
  }

  if (statusPageObjectId && UserUtil.isLoggedIn(statusPageObjectId)) {
    const safeRedirectUrl: string | null = StatusPageUtil.getSafeRedirectUrl();
    if (safeRedirectUrl) {
      Navigation.navigate(new Route(safeRedirectUrl));
    } else {
      Navigation.navigate(StatusPageUtil.getDefaultRedirectRoute());
    }
  }

  const safeRedirectUrlForStorage: string | null =
    StatusPageUtil.getSafeRedirectUrl();
  if (safeRedirectUrlForStorage) {
    // save this to local storage, so in the overview page. We can redirect to this page.
    LocalStorage.setItem("redirectUrl", safeRedirectUrlForStorage);
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  const hasNoProviders: boolean =
    ssoProviderCount === 0 && oidcProviderCount === 0;

  /*
   * The page's own sign-in, on its domain or in the Dashboard's preview,
   * still taking the visitor back to the page they were sent to sign in
   * from once they have.
   */
  const loginRoute: Route = StatusPageUtil.getSignInRoute({
    path: StatusPageUtil.isPreviewPage()
      ? `/status-page/${statusPageId}/login`
      : "/login",
    redirectUrl: safeRedirectUrlForStorage,
  });

  /*
   * Under the providers, the way back to the email and password form, drawn
   * as the sign-in page draws its way here (Log in with SSO): "or", then an
   * outlined button as wide as the providers. Only where a private user may
   * sign in with a password - not on a page that requires SSO - and not
   * when the page has no provider to list, where the notice below already
   * says what to do instead, with its own link back.
   */
  const offersPasswordSignIn: boolean = !props.forceSSO && !hasNoProviders;

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <PageLogo
          logoFileId={props.logoFileId}
          darkThemeLogoFileId={props.darkThemeLogoFileId}
          altText={props.statusPageName}
        />
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          {t("accounts.sso.title")}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {t("accounts.sso.loginPrompt", {
            statusPageName: props.statusPageName || t("common.statusPage"),
          })}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 space-y-6">
          <div
            className="-mx-2 -mb-5"
            hidden={hasNoProviders}
            data-testid="status-page-sso-provider-lists"
          >
            <div hidden={ssoProviderCount === 0}>
              <ModelList<StatusPageSSO>
                id="sso-list"
                overrideFetchApiUrl={URL.fromString(
                  STATUS_PAGE_API_URL.toString(),
                ).addRoute(
                  "/sso/" + StatusPageUtil.getStatusPageId()?.toString(),
                )}
                modelType={StatusPageSSO}
                titleField="name"
                descriptionField="description"
                select={{
                  name: true,
                  description: true,
                  _id: true,
                }}
                noItemsMessage={""}
                hideEmptyState={true}
                onListLoaded={(list: Array<StatusPageSSO>) => {
                  setSsoProviderCount(list.length);
                }}
                onSelectChange={(list: Array<StatusPageSSO>) => {
                  if (list && list.length > 0) {
                    setIsLoading(true);
                    Navigation.navigate(
                      URL.fromURL(STATUS_PAGE_SSO_API_URL).addRoute(
                        new Route(
                          `/${StatusPageUtil.getStatusPageId()?.toString()}/${
                            list[0]?._id
                          }`,
                        ),
                      ),
                    );
                  }
                }}
              />
            </div>

            <div hidden={oidcProviderCount === 0}>
              <ModelList<StatusPageOIDC>
                id="oidc-list"
                overrideFetchApiUrl={URL.fromString(
                  STATUS_PAGE_API_URL.toString(),
                ).addRoute(
                  "/oidc/" + StatusPageUtil.getStatusPageId()?.toString(),
                )}
                modelType={StatusPageOIDC}
                titleField="name"
                descriptionField="description"
                select={{
                  name: true,
                  description: true,
                  _id: true,
                }}
                noItemsMessage={t("accounts.sso.noProviders")}
                hideEmptyState={true}
                onListLoaded={(list: Array<StatusPageOIDC>) => {
                  setOidcProviderCount(list.length);
                }}
                onSelectChange={(list: Array<StatusPageOIDC>) => {
                  if (list && list.length > 0) {
                    setIsLoading(true);
                    Navigation.navigate(
                      URL.fromURL(STATUS_PAGE_OIDC_API_URL).addRoute(
                        new Route(
                          `/${StatusPageUtil.getStatusPageId()?.toString()}/${
                            list[0]?._id
                          }`,
                        ),
                      ),
                    );
                  }
                }}
              />
            </div>
          </div>

          {offersPasswordSignIn && (
            <div data-testid={SSO_SIGN_IN_OPTIONS_TEST_ID}>
              <LabelledDivider
                label={t("accounts.login.or")}
                className="mb-5"
                dataTestId="sign-in-options-divider"
              />
              <SignInOptionLink
                to={loginRoute}
                id={PASSWORD_SIGN_IN_OPTION_TEST_ID}
                dataTestId={PASSWORD_SIGN_IN_OPTION_TEST_ID}
                icon={IconProp.Lock}
                title={t("accounts.sso.logInWithPassword")}
              />
            </div>
          )}

          {hasNoProviders && (
            <div
              className="text-center text-sm text-gray-600"
              data-testid="status-page-sso-unavailable"
            >
              <p>
                {t("accounts.sso.notAvailable", {
                  defaultValue:
                    "Single sign-on is not available for this status page. Sign in with your email and password instead.",
                })}
              </p>
              <p className="mt-4">
                <Link
                  to={loginRoute}
                  className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                >
                  {t("accounts.sso.backToLogin", {
                    defaultValue: "Back to sign in",
                  })}
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
