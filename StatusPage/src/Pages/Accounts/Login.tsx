import { LOGIN_API_URL } from "../../Utils/ApiPaths";
import LoginUtil from "../../Utils/Login";
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
import Link from "Common/UI/Components/Link/Link";
import { STATUS_PAGE_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import React, { FunctionComponent, useEffect } from "react";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
  forceSSO: boolean;
  hasEnabledSSOConfig: boolean;
}

const LoginPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
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
      const safeRedirectUrl: string | null = StatusPageUtil.getSafeRedirectUrl();
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
          ? `${ssoBasePath}?redirectUrl=${safeRedirectUrl}`
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
          <img style={{ height: "70px", margin: "auto" }} src={logoUrl} />
        ) : (
          <></>
        )}
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          Welcome back!
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Please login to view {props.statusPageName || "Status Page"}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <ModelForm<StatusPagePrivateUser>
            modelType={StatusPagePrivateUser}
            id="login-form"
            name="Status Page Login"
            fields={[
              {
                field: {
                  email: true,
                },
                showEvenIfPermissionDoesNotExist: true,
                title: "Email",
                fieldType: FormFieldSchemaType.Email,
                required: true,
                disableSpellCheck: true,
              },
              {
                field: {
                  password: true,
                },
                title: "Password",
                required: true,
                showEvenIfPermissionDoesNotExist: true,
                validation: {
                  minLength: 6,
                },
                fieldType: FormFieldSchemaType.Password,
                sideLink: {
                  text: "Forgot password?",
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
            submitButtonText={"Login"}
            onSuccess={(
              value: StatusPagePrivateUser,
              miscData: JSONObject | undefined,
            ) => {
              LoginUtil.login({
                user: value,
                token: miscData ? miscData["token"] : undefined,
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
              <div className="actions pointer text-center mt-4 hover:underline fw-semibold">
                {props.hasEnabledSSOConfig ? (
                  <p>
                    <Link
                      to={
                        new Route(
                          StatusPageUtil.isPreviewPage()
                            ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/sso`
                            : "/sso",
                        )
                      }
                      className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                    >
                      Use single sign-on (SSO) instead
                    </Link>
                  </p>
                ) : (
                  <></>
                )}
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
