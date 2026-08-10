import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserAuthenticationStatus from "Common/Types/UserAuthenticationStatus";
import { MINIMUM_PASSWORD_LENGTH } from "Common/Types/Password";
import IconProp from "Common/Types/Icon/IconProp";
import User from "Common/Models/DatabaseModels/User";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import SideMenuComponent from "./SideMenu";

/*
 * The values BasicForm hands back on submit. `password` is typed loosely on
 * purpose: BasicForm wraps every FormFieldSchemaType.Password value in a
 * HashedString before calling onSubmit (it does that so ModelForm can post
 * one straight at a hashed column), so what arrives here is an object with a
 * toString(), not the string the operator typed.
 */
interface SetPasswordFormValues {
  password?: { toString: () => string } | string | undefined;
  confirmPassword?: { toString: () => string } | string | undefined;
}

/*
 * Master-admin actions on ONE user's credentials. These are not model writes:
 * each is a dedicated master-admin endpoint that also revokes the user's
 * sessions and emails them, so they go through API directly rather than
 * through AdminModelAPI. AdminModelAPI is still handed to ModelPage below,
 * which does read the User row (for the page title).
 */
const userAuthenticationRoute: (modelId: ObjectID, action: string) => URL = (
  modelId: ObjectID,
  action: string,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `/user/${modelId.toString()}/${action}`,
  );
};

const UserAuthentication: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [status, setStatus] = useState<UserAuthenticationStatus | null>(null);
  const [isStatusLoading, setIsStatusLoading] = useState<boolean>(true);
  const [statusError, setStatusError] = useState<string>("");

  const [isSettingPassword, setIsSettingPassword] = useState<boolean>(false);
  const [setPasswordError, setSetPasswordError] = useState<string>("");
  const [setPasswordSuccess, setSetPasswordSuccess] = useState<string>("");

  const [showResetLinkModal, setShowResetLinkModal] = useState<boolean>(false);
  const [isSendingResetLink, setIsSendingResetLink] = useState<boolean>(false);
  const [resetLinkError, setResetLinkError] = useState<string>("");
  const [resetLinkSuccess, setResetLinkSuccess] = useState<string>("");

  const loadStatus: () => Promise<void> = async (): Promise<void> => {
    setIsStatusLoading(true);
    setStatusError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: userAuthenticationRoute(modelId, "authentication-status"),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setStatus(response.data as unknown as UserAuthenticationStatus);
    } catch (err) {
      setStatusError(API.getFriendlyMessage(err));
    } finally {
      setIsStatusLoading(false);
    }
  };

  /*
   * Mount only, and deliberately NOT keyed on `modelId`. It is tempting to
   * list it, but Navigation.getLastParamAsObjectID() builds a brand new
   * ObjectID on every render, so any dependency array containing it -- or
   * containing a callback memoized on it -- compares unequal every time and
   * re-runs the effect forever. The id cannot change without remounting this
   * page anyway, since it comes from the URL this route matched.
   */
  useEffect(() => {
    loadStatus().catch(() => {
      // loadStatus already surfaces the failure through statusError.
    });
  }, []);

  const setPassword: (values: SetPasswordFormValues) => Promise<void> = async (
    values: SetPasswordFormValues,
  ): Promise<void> => {
    setIsSettingPassword(true);
    setSetPasswordError("");
    setSetPasswordSuccess("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: userAuthenticationRoute(modelId, "set-password"),
          data: {
            password: values.password ? values.password.toString() : "",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setSetPasswordSuccess(t("pages.userAuthentication.setPasswordSuccess"));

      /*
       * Setting a password clears any outstanding reset link, so the status
       * card above is now stale in two ways at once.
       */
      await loadStatus();
    } catch (err) {
      setSetPasswordError(API.getFriendlyMessage(err));
    } finally {
      setIsSettingPassword(false);
    }
  };

  const sendPasswordResetLink: () => Promise<void> =
    async (): Promise<void> => {
      setIsSendingResetLink(true);
      setResetLinkError("");
      setResetLinkSuccess("");

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: userAuthenticationRoute(modelId, "send-password-reset-link"),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const email: string = (response.data?.["email"] as string) || "";

        setResetLinkSuccess(
          email
            ? t("pages.userAuthentication.resetLinkSentTo", { email: email })
            : t("pages.userAuthentication.resetLinkSuccess"),
        );

        setShowResetLinkModal(false);

        await loadStatus();
      } catch (err) {
        setResetLinkError(API.getFriendlyMessage(err));
      } finally {
        setIsSendingResetLink(false);
      }
    };

  const yesNo: (value: boolean) => string = (value: boolean): string => {
    return value ? t("common.yes") : t("common.no");
  };

  return (
    <ModelPage<User>
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      modelAPI={AdminModelAPI}
      title={t("pages.userView.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
        {
          title: t("breadcrumbs.user"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_VIEW] as Route,
            {
              modelId: modelId,
            },
          ),
        },
        {
          title: t("breadcrumbs.authentication"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_AUTHENTICATION] as Route,
            {
              modelId: modelId,
            },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <div>
        <Card
          title={t("pages.userAuthentication.statusCardTitle")}
          description={t("pages.userAuthentication.statusCardDescription")}
          buttons={[
            {
              title: t("pages.userAuthentication.refreshButton"),
              icon: IconProp.Refresh,
              buttonStyle: ButtonStyleType.NORMAL,
              isLoading: isStatusLoading,
              onClick: () => {
                loadStatus().catch(() => {
                  // Surfaced through statusError.
                });
              },
            },
          ]}
        >
          <div className="mt-3">
            {statusError ? (
              <Alert type={AlertType.DANGER} title={statusError} />
            ) : (
              <></>
            )}

            {!statusError && isStatusLoading && !status ? (
              <ComponentLoader />
            ) : (
              <></>
            )}

            {!statusError && status ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    {t("pages.userAuthentication.hasPasswordLabel")}
                  </p>
                  <p className="text-sm text-gray-900">
                    {yesNo(status.hasPassword)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    {t("pages.userAuthentication.emailVerifiedLabel")}
                  </p>
                  <p className="text-sm text-gray-900">
                    {yesNo(status.isEmailVerified)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    {t("pages.userAuthentication.twoFactorLabel")}
                  </p>
                  <p className="text-sm text-gray-900">
                    {yesNo(status.isTwoFactorAuthEnabled)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    {t("pages.userAuthentication.pendingResetLinkLabel")}
                  </p>
                  <p className="text-sm text-gray-900">
                    {yesNo(status.hasPendingPasswordResetLink)}
                  </p>
                </div>
              </div>
            ) : (
              <></>
            )}
          </div>
        </Card>

        <Card
          title={t("pages.userAuthentication.setPasswordCardTitle")}
          description={t("pages.userAuthentication.setPasswordCardDescription")}
        >
          <div className="mt-3">
            {setPasswordSuccess ? (
              <Alert
                type={AlertType.SUCCESS}
                title={setPasswordSuccess}
                className="mb-5"
              />
            ) : (
              <></>
            )}

            <BasicForm
              id="set-user-password-form"
              name="Set User Password"
              initialValues={{}}
              showAsColumns={1}
              fields={[
                {
                  field: {
                    password: true,
                  },
                  title: t("pages.userAuthentication.newPasswordLabel"),
                  fieldType: FormFieldSchemaType.Password,
                  required: true,
                  disableSpellCheck: true,
                  validation: {
                    minLength: MINIMUM_PASSWORD_LENGTH,
                  },
                },
                {
                  field: {
                    confirmPassword: true,
                  },
                  title: t("pages.userAuthentication.confirmPasswordLabel"),
                  fieldType: FormFieldSchemaType.Password,
                  required: true,
                  disableSpellCheck: true,
                  validation: {
                    minLength: MINIMUM_PASSWORD_LENGTH,
                    toMatchField: "password",
                  },
                },
              ]}
              submitButtonText={t("pages.userAuthentication.setPasswordButton")}
              submitButtonStyleType={ButtonStyleType.DANGER}
              isLoading={isSettingPassword}
              error={setPasswordError || undefined}
              onSubmit={(values: SetPasswordFormValues) => {
                setPassword(values).catch(() => {
                  // Surfaced through setPasswordError.
                });
              }}
              footer={<></>}
            />
          </div>
        </Card>

        <Card
          title={t("pages.userAuthentication.resetLinkCardTitle")}
          description={t("pages.userAuthentication.resetLinkCardDescription")}
          buttons={[
            {
              title: t("pages.userAuthentication.resetLinkButton"),
              icon: IconProp.Email,
              buttonStyle: ButtonStyleType.NORMAL,
              isLoading: isSendingResetLink,
              onClick: () => {
                setResetLinkError("");
                setResetLinkSuccess("");
                setShowResetLinkModal(true);
              },
            },
          ]}
        >
          <div className="mt-3">
            {resetLinkSuccess ? (
              <Alert type={AlertType.SUCCESS} title={resetLinkSuccess} />
            ) : (
              <></>
            )}

            {resetLinkError && !showResetLinkModal ? (
              <Alert type={AlertType.DANGER} title={resetLinkError} />
            ) : (
              <></>
            )}
          </div>
        </Card>

        {showResetLinkModal ? (
          <ConfirmModal
            title={t("pages.userAuthentication.resetLinkModalTitle")}
            description={t(
              "pages.userAuthentication.resetLinkModalDescription",
            )}
            submitButtonText={t(
              "pages.userAuthentication.resetLinkModalSubmit",
            )}
            submitButtonType={ButtonStyleType.PRIMARY}
            isLoading={isSendingResetLink}
            error={resetLinkError || undefined}
            onSubmit={() => {
              sendPasswordResetLink().catch(() => {
                // Surfaced through resetLinkError.
              });
            }}
            onClose={() => {
              setShowResetLinkModal(false);
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </ModelPage>
  );
};

export default UserAuthentication;
