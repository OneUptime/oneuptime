import PageLogo from "../../Components/Logo/PageLogo";
import { RESET_PASSWORD_API_URL } from "../../Utils/ApiPaths";
import StatusPageModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  RESET_LINK_MESSAGES,
  isResetLinkRefusal,
} from "Common/Types/Accounts/SignInMessages";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/Types/Translator";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon, { IconType, ThickProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { getNewPasswordFields } from "Common/UI/Components/PasswordRequirements/NewPasswordFields";
import Navigation from "Common/UI/Utils/Navigation";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import useTranslator from "Common/UI/Utils/UseTranslator";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import React, {
  FunctionComponent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
  // The logo made for the dark theme, shown instead while the page is dark.
  darkThemeLogoFileId?: ObjectID | undefined;
  forceSSO: boolean;
}

/*
 * Where a reset ends (#9123): in Log In once the password is reset, and in
 * Request a New Link when the link is dead. It used to end in a sentence with
 * nothing to click.
 */
enum ResetOutcome {
  // The form, before a reset or after a refused password.
  Form = "Form",
  Reset = "Reset",
  LinkExpired = "LinkExpired",
  // Used already, never sent, or only part of it reached the page.
  LinkInvalid = "LinkInvalid",
}

const ResetPassword: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();
  const apiUrl: URL = RESET_PASSWORD_API_URL;
  const passwordRequirementsId: string = useId();
  const [outcome, setOutcome] = useState<ResetOutcome>(ResetOutcome.Form);
  const headingRef: React.RefObject<HTMLHeadingElement> =
    useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (props.forceSSO) {
      // This page's single sign-on, its id filled in on the preview.
      Navigation.navigate(
        RouteUtil.populateRouteParams(
          !StatusPageUtil.isPreviewPage()
            ? RouteMap[PageMap.SSO]!
            : RouteMap[PageMap.PREVIEW_SSO]!,
        ),
      );
    }
  }, [props.forceSSO]);

  // The form is gone: focus goes to what replaced it, or a screen reader is left nowhere.
  useEffect(() => {
    if (outcome !== ResetOutcome.Form) {
      headingRef.current?.focus();
    }
  }, [outcome]);

  if (!StatusPageUtil.getStatusPageId()) {
    return <></>;
  }

  if (
    StatusPageUtil.getStatusPageId() &&
    UserUtil.isLoggedIn(StatusPageUtil.getStatusPageId()!)
  ) {
    Navigation.navigate(
      new Route(
        StatusPageUtil.isPreviewPage()
          ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
          : "/",
      ),
    );
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

  const loginRoute: Route = RouteUtil.populateRouteParams(
    StatusPageUtil.isPreviewPage()
      ? RouteMap[PageMap.PREVIEW_LOGIN]!
      : RouteMap[PageMap.LOGIN]!,
  );

  const forgotPasswordRoute: Route = RouteUtil.populateRouteParams(
    StatusPageUtil.isPreviewPage()
      ? RouteMap[PageMap.PREVIEW_FORGOT_PASSWORD]!
      : RouteMap[PageMap.FORGOT_PASSWORD]!,
  );

  const header: JSX.Element = (
    <div className="sm:mx-auto sm:w-full sm:max-w-md">
      <PageLogo
        logoFileId={props.logoFileId}
        darkThemeLogoFileId={props.darkThemeLogoFileId}
        altText={props.statusPageName}
      />
      {outcome === ResetOutcome.Form && (
        <>
          <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
            {t("accounts.resetPassword.description", {
              statusPageName: props.statusPageName,
            })}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t("accounts.resetPassword.instructions")}{" "}
          </p>
        </>
      )}
    </div>
  );

  const knowPasswordLine: JSX.Element = (
    <div className="mt-10 text-center">
      <p className="text-muted mb-0 text-gray-500">
        {t("accounts.resetPassword.knowPassword")}{" "}
        <Link
          to={loginRoute}
          className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
        >
          {t("accounts.shared.login")}.
        </Link>
      </p>
    </div>
  );

  if (outcome !== ResetOutcome.Form) {
    const isReset: boolean = outcome === ResetOutcome.Reset;
    const isExpired: boolean = outcome === ResetOutcome.LinkExpired;

    return (
      <div className="flex min-h-full flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        {header}
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div
            className="bg-white py-8 px-6 shadow sm:rounded-lg sm:px-10 text-center"
            data-testid={
              isReset ? "reset-password-success" : "reset-password-link-problem"
            }
          >
            <div className="mb-6 flex justify-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full ring-8 ${
                  isReset
                    ? "bg-green-100 ring-green-50"
                    : "bg-amber-100 ring-amber-50"
                }`}
              >
                <Icon
                  icon={isReset ? IconProp.Check : IconProp.Clock}
                  type={isReset ? IconType.Success : IconType.Warning}
                  thick={ThickProp.Thick}
                  className="h-8 w-8"
                />
              </div>
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold tracking-tight text-gray-900 focus:outline-none sm:text-2xl"
            >
              {isReset
                ? t("accounts.resetPassword.successTitle")
                : isExpired
                  ? t("accounts.resetPassword.linkExpiredTitle")
                  : t("accounts.resetPassword.linkInvalidTitle")}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600 sm:text-base">
              {isReset
                ? t("accounts.resetPassword.successDescription")
                : isExpired
                  ? t("accounts.resetPassword.linkExpiredDescription")
                  : t("accounts.resetPassword.linkInvalidDescription")}
            </p>
            <div className="mt-6">
              <Button
                title={
                  isReset
                    ? t("accounts.resetPassword.loginButton")
                    : t("accounts.resetPassword.requestNewLinkButton")
                }
                isTitleTranslated={true}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId={
                  isReset
                    ? "reset-password-log-in"
                    : "reset-password-request-new-link"
                }
                className="w-full justify-center"
                style={{ width: "100%", marginInlineStart: "0px" }}
                onClick={() => {
                  Navigation.navigate(
                    isReset ? loginRoute : forgotPasswordRoute,
                  );
                }}
              />
            </div>
          </div>
          {!isReset && knowPasswordLine}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      {header}

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <ModelForm<StatusPagePrivateUser>
            modelType={StatusPagePrivateUser}
            modelAPI={StatusPageModelAPI}
            id="register-form"
            name="Status Page > Reset Password"
            onBeforeCreate={(
              item: StatusPagePrivateUser,
            ): Promise<StatusPagePrivateUser> => {
              /*
               * Not a route param: the head bootstrap moves the token out of
               * the path before any third-party tag can report the URL. See
               * Common/UI/Utils/SensitiveUrlToken.
               */
              item.resetPasswordToken = SensitiveUrlToken.read();

              item.statusPageId = StatusPageUtil.getStatusPageId()!;
              return Promise.resolve(item);
            }}
            showAsColumns={1}
            maxPrimaryButtonWidth={true}
            fields={getNewPasswordFields<StatusPagePrivateUser>({
              translator: translator,
              requirementsId: passwordRequirementsId,
              passwordTitle: t("accounts.shared.newPassword"),
              confirmPasswordTitle: t("accounts.shared.confirmPassword"),
            })}
            createOrUpdateApiUrl={apiUrl}
            formType={FormType.Create}
            submitButtonText={t("accounts.resetPassword.submit")}
            onSubmitError={(error: string) => {
              // A dead link is fixed by a new one; a refused password stays on the form.
              if (!isResetLinkRefusal(error)) {
                return;
              }

              setOutcome(
                error === RESET_LINK_MESSAGES.expired
                  ? ResetOutcome.LinkExpired
                  : ResetOutcome.LinkInvalid,
              );
            }}
            onSuccess={() => {
              /*
               * Only on success. A rejected reset (expired token, refused
               * password) has to keep the stash so the retry still has a
               * token to submit.
               */
              SensitiveUrlToken.clear();
              setOutcome(ResetOutcome.Reset);
            }}
          />
        </div>
        {knowPasswordLine}
      </div>
    </div>
  );
};

export default ResetPassword;
