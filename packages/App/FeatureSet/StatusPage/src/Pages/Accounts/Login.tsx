import LogoPlate from "../../Components/Logo/LogoPlate";
import { LOGIN_API_URL } from "../../Utils/ApiPaths";
import LoginUtil from "../../Utils/Login";
import StatusPageModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import SignInOptionLink from "Common/UI/Components/SignInOption/SignInOptionLink";
import IconProp from "Common/Types/Icon/IconProp";
import { STATUS_PAGE_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import React, { FunctionComponent, useEffect } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
  forceSSO: boolean;
  hasEnabledSSOConfig: boolean;
}

const LoginPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { t } = useTranslation();
  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();
  const statusPageIdString: string | undefined = statusPageId?.toString();
  const requiresMasterPasswordLock: boolean =
    StatusPageUtil.isPrivateStatusPage() &&
    StatusPageUtil.requiresMasterPassword() &&
    !StatusPageUtil.isMasterPasswordValidated();

  useEffect(() => {
    if (requiresMasterPasswordLock || !statusPageId) {
      StatusPageUtil.navigateToMasterPasswordPage();
      return;
    }

    if (props.forceSSO) {
      const safeRedirectUrl: string | null =
        StatusPageUtil.getSafeRedirectUrl();
      const ssoBasePath: string = (
        !StatusPageUtil.isPreviewPage()
          ? RouteUtil.populateRouteParams(RouteMap[PageMap.SSO]!, statusPageId)
          : RouteUtil.populateRouteParams(
              RouteMap[PageMap.PREVIEW_SSO]!,
              statusPageId,
            )
      ).toString();

      const navRoute: Route = new Route(
        safeRedirectUrl
          ? `${ssoBasePath}?redirectUrl=${encodeURIComponent(safeRedirectUrl)}`
          : ssoBasePath,
      );

      Navigation.navigate(navRoute);
    }
  }, [props.forceSSO, statusPageIdString, requiresMasterPasswordLock]);

  const apiUrl: URL = LOGIN_API_URL;
  const statusPageIdForLogo: string | undefined =
    StatusPageUtil.getStatusPageId()?.toString();
  const logoUrl: string | null =
    props.logoFileId && props.logoFileId.toString() && statusPageIdForLogo
      ? URL.fromString(STATUS_PAGE_API_URL.toString())
          .addRoute(`/logo/${statusPageIdForLogo}`)
          .toString()
      : null;

  if (!statusPageId) {
    return <></>;
  }

  if (requiresMasterPasswordLock) {
    StatusPageUtil.navigateToMasterPasswordPage();
    return <></>;
  }

  if (!StatusPageUtil.isPrivateStatusPage()) {
    const navRoute: Route = new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
        : "/",
    );

    Navigation.navigate(navRoute);
  }

  if (statusPageId && UserUtil.isLoggedIn(statusPageId)) {
    const safeRedirectUrl: string | null = StatusPageUtil.getSafeRedirectUrl();
    if (safeRedirectUrl) {
      Navigation.navigate(new Route(safeRedirectUrl));
    } else {
      Navigation.navigate(StatusPageUtil.getDefaultRedirectRoute());
    }
  }

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {logoUrl ? (
          <LogoPlate className="mx-auto w-fit">
            <img style={{ height: "70px", margin: "auto" }} src={logoUrl} />
          </LogoPlate>
        ) : (
          <></>
        )}
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          {t("accounts.login.welcomeBack")}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {t("accounts.login.loginPrompt", {
            statusPageName: props.statusPageName || t("common.statusPage"),
          })}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <ModelForm<StatusPagePrivateUser>
            modelType={StatusPagePrivateUser}
            modelAPI={StatusPageModelAPI}
            id="login-form"
            name="Status Page Login"
            fields={[
              {
                field: {
                  email: true,
                },
                showEvenIfPermissionDoesNotExist: true,
                title: t("accounts.shared.email"),
                fieldType: FormFieldSchemaType.Email,
                required: true,
                disableSpellCheck: true,
              },
              {
                field: {
                  password: true,
                },
                title: t("accounts.shared.password"),
                required: true,
                showEvenIfPermissionDoesNotExist: true,
                validation: {
                  minLength: 6,
                },
                fieldType: FormFieldSchemaType.Password,
                // The sign-in password: password managers fill it.
                autoComplete: "current-password",
                isOwnCredential: true,
                sideLink: {
                  text: t("accounts.login.forgotPassword"),
                  url: new Route(
                    StatusPageUtil.isPreviewPage()
                      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/forgot-password`
                      : "/forgot-password",
                  ),
                  openLinkInNewTab: false,
                },
              },
            ]}
            createOrUpdateApiUrl={apiUrl}
            formType={FormType.Create}
            submitButtonText={t("accounts.login.submit")}
            onSuccess={(
              value: StatusPagePrivateUser,
              _miscData: JSONObject | undefined,
            ) => {
              LoginUtil.login({
                user: value,
              });

              const safeRedirectUrl: string | null =
                StatusPageUtil.getSafeRedirectUrl();
              if (safeRedirectUrl) {
                Navigation.navigate(new Route(safeRedirectUrl));
              } else {
                Navigation.navigate(StatusPageUtil.getDefaultRedirectRoute());
              }
            }}
            onBeforeCreate={(
              item: StatusPagePrivateUser,
            ): Promise<StatusPagePrivateUser> => {
              if (!StatusPageUtil.getStatusPageId()) {
                throw new BadDataException("Status Page ID not found");
              }

              item.statusPageId = StatusPageUtil.getStatusPageId()!;
              return Promise.resolve(item);
            }}
            maxPrimaryButtonWidth={true}
            footer={
              /*
               * Single sign-on, where the page has a provider turned on: an
               * outlined button under "or", as wide and as tall as Login,
               * named like the page it opens - the way OneUptime's own
               * sign-in page offers it (SignInOptionStyle). It was a small
               * text link.
               */
              props.hasEnabledSSOConfig ? (
                <div data-testid="sign-in-options">
                  <LabelledDivider
                    label={t("accounts.login.or")}
                    className="my-5"
                    dataTestId="sign-in-options-divider"
                  />
                  <SignInOptionLink
                    to={StatusPageUtil.getSignInRoute({
                      path: StatusPageUtil.isPreviewPage()
                        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/sso`
                        : "/sso",
                      redirectUrl: StatusPageUtil.getSafeRedirectUrl(),
                    })}
                    id="sso-login"
                    dataTestId="sso-login"
                    icon={IconProp.ShieldCheck}
                    title={t("accounts.login.logInWithSso")}
                  />
                </div>
              ) : (
                <></>
              )
            }
          />
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
