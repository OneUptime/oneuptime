import PageLogo from "../../Components/Logo/PageLogo";
import { SEND_MAGIC_LINK_API_URL } from "../../Utils/ApiPaths";
import StatusPageModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES } from "Common/Types/StatusPage/StatusPageMagicLink";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import React, {
  FunctionComponent,
  MutableRefObject,
  useEffect,
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
  // Whether the page offers sign-in links (the master-page answer).
  enableMagicLinkLogin: boolean;
}

export const MAGIC_LINK_FORM_TEST_ID: string = "magic-link-form";
export const MAGIC_LINK_SENT_TEST_ID: string = "magic-link-sent";
export const MAGIC_LINK_SEND_ANOTHER_TEST_ID: string =
  "magic-link-send-another";

/*
 * "Log in with a link", reached from the sign-in page's "Email me a sign-in
 * link" (Types/StatusPage/StatusPageMagicLink): the private user's email
 * address, then "Check your email". The answer is the same whether or not
 * the address can sign in to the page - the server says nothing about who
 * can - so the page says "if": a reader who mistyped their address, or was
 * never added, is told where else to look.
 *
 * Where the reader was going is kept for the tab the link opens in
 * (StatusPageUtil.rememberMagicLinkRedirect), so following the link lands
 * them there, as signing in here would have.
 */
const MagicLinkPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { t } = useTranslation();
  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

  // The address the latest link was asked for: shown once it is sent.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const askingFor: MutableRefObject<string> = useRef<string>("");

  // Asking again starts from an empty form.
  const [formKey, setFormKey] = useState<number>(0);

  const requiresMasterPasswordLock: boolean =
    StatusPageUtil.isPrivateStatusPage() &&
    StatusPageUtil.requiresMasterPassword() &&
    !StatusPageUtil.isMasterPasswordValidated();

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

  if (!statusPageId) {
    return <></>;
  }

  if (requiresMasterPasswordLock) {
    StatusPageUtil.navigateToMasterPasswordPage();
    return <></>;
  }

  if (!StatusPageUtil.isPrivateStatusPage()) {
    Navigation.navigate(StatusPageUtil.getDefaultRedirectRoute());
    return <></>;
  }

  if (UserUtil.isLoggedIn(statusPageId)) {
    const safeRedirectUrl: string | null = StatusPageUtil.getSafeRedirectUrl();
    Navigation.navigate(
      safeRedirectUrl
        ? new Route(safeRedirectUrl)
        : StatusPageUtil.getDefaultRedirectRoute(),
    );
    return <></>;
  }

  // The page's password form, still going where the reader was going.
  const loginRoute: Route = StatusPageUtil.getSignInRoute({
    path: StatusPageUtil.isPreviewPage()
      ? `/status-page/${statusPageId.toString()}/login`
      : "/login",
    redirectUrl: StatusPageUtil.getSafeRedirectUrl(),
  });

  // A page that does not offer sign-in links has only its password form.
  if (!props.enableMagicLinkLogin && !props.forceSSO) {
    Navigation.navigate(loginRoute);
    return <></>;
  }

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <PageLogo
          logoFileId={props.logoFileId}
          darkThemeLogoFileId={props.darkThemeLogoFileId}
          altText={props.statusPageName}
        />
        <h2 className="mt-6 text-center text-2xl tracking-tight text-gray-900">
          {sentTo
            ? t("accounts.magicLink.sentTitle")
            : t("accounts.magicLink.title")}
        </h2>
        {!sentTo && (
          <p className="mt-2 text-center text-sm text-gray-600">
            {t("accounts.magicLink.description", {
              statusPageName: props.statusPageName || t("common.statusPage"),
            })}
          </p>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {sentTo ? (
            <div
              className="space-y-4 text-center text-sm text-gray-600"
              data-testid={MAGIC_LINK_SENT_TEST_ID}
              role="status"
            >
              <p className="break-words">
                {t("accounts.magicLink.sent", {
                  email: sentTo,
                  statusPageName:
                    props.statusPageName || t("common.statusPage"),
                  minutes: STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES,
                })}
              </p>
              <p>{t("accounts.magicLink.notReceived")}</p>
              <Button
                title={t("accounts.magicLink.sendAnother")}
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
              <ModelForm<StatusPagePrivateUser>
                key={formKey}
                modelType={StatusPagePrivateUser}
                modelAPI={StatusPageModelAPI}
                id="magic-link-form"
                name="Status Page > Sign-In Link"
                createOrUpdateApiUrl={SEND_MAGIC_LINK_API_URL}
                onBeforeCreate={(
                  item: StatusPagePrivateUser,
                ): Promise<StatusPagePrivateUser> => {
                  item.statusPageId = statusPageId;
                  askingFor.current = item.email?.toString() || "";
                  return Promise.resolve(item);
                }}
                fields={[
                  {
                    field: {
                      email: true,
                    },
                    title: t("accounts.shared.email"),
                    showEvenIfPermissionDoesNotExist: true,
                    fieldType: FormFieldSchemaType.Email,
                    required: true,
                    disableSpellCheck: true,
                  },
                ]}
                onSuccess={() => {
                  StatusPageUtil.rememberMagicLinkRedirect(
                    StatusPageUtil.getSafeRedirectUrl(),
                  );
                  setSentTo(askingFor.current);
                }}
                submitButtonText={t("accounts.magicLink.submit")}
                formType={FormType.Create}
                maxPrimaryButtonWidth={true}
              />
            </div>
          )}
        </div>

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
      </div>
    </div>
  );
};

export default MagicLinkPage;
