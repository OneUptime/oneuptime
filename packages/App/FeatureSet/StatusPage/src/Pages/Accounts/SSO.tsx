import {
  STATUS_PAGE_API_URL,
  STATUS_PAGE_OIDC_API_URL,
  STATUS_PAGE_SSO_API_URL,
} from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelList from "Common/UI/Components/ModelList/ModelList";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import React, { FunctionComponent, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
}

const LoginPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  /*
   * How many providers each list loaded (null until it has). When both are
   * empty there is nothing to sign in with - no provider is enabled, or this
   * is a Community Edition server, where status page SSO is not available and
   * the server lists none - so the page says so and links back to sign-in.
   *
   * That notice is the ONLY message then: neither list shows an empty state of
   * its own (hideEmptyState), and both stay mounted but hidden, so they keep
   * their loaded state and add no blank space above the notice. An empty
   * list next to one with providers shows nothing either, rather than "No
   * items found." under a provider that is right there.
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
  const logoUrl: string | null =
    props.logoFileId && props.logoFileId.toString() && statusPageId
      ? URL.fromString(STATUS_PAGE_API_URL.toString())
          .addRoute(`/logo/${statusPageId}`)
          .toString()
      : null;

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

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {logoUrl ? (
          <img style={{ height: "70px", margin: "auto" }} src={logoUrl} />
        ) : (
          <></>
        )}
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
            className="space-y-6"
            hidden={hasNoProviders}
            data-testid="status-page-sso-provider-lists"
          >
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
                  to={
                    new Route(
                      StatusPageUtil.isPreviewPage()
                        ? `/status-page/${statusPageId}/login`
                        : "/login",
                    )
                  }
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
