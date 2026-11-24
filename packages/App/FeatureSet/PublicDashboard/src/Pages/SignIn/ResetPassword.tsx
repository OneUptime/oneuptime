import {
  FORGOT_PASSWORD_COPY,
  RESET_PASSWORD_COPY,
  RESET_PASSWORD_DONE_TEST_ID,
  SIGN_IN_COPY,
} from "./SignInCopy";
import API from "../../Utils/API";
import PublicDashboardUtil, {
  PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH,
  PUBLIC_DASHBOARD_RESET_PASSWORD_PATH,
  PUBLIC_DASHBOARD_SIGN_IN_PATH,
} from "../../Utils/PublicDashboard";
import PublicDashboardSignIn from "../../Utils/SignIn";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { isResetLinkRefusal } from "Common/Types/Accounts/SignInMessages";
import AuthPage, {
  AUTH_PAGE_LINK_CLASS,
} from "Common/UI/Components/AuthPage/AuthPage";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The page a dashboard's invitation and a reset link open (#10250): a new
 * password, held to the one password rule by the server, then the way to
 * sign in with it. The token is the last part of the address; the server
 * finds the private user by its hash and the dashboard alone, and a link
 * that is spent or ran out offers a new one.
 */
export interface ComponentProps {
  dashboardName: string;
}

// The reset link's token: what follows /reset-password/ in the address.
export const getResetPasswordToken: (path: string) => string = (
  path: string,
): string => {
  const marker: string = `${PUBLIC_DASHBOARD_RESET_PASSWORD_PATH}/`;
  const at: number = path.indexOf(marker);

  if (at < 0) {
    return "";
  }

  return (path.substring(at + marker.length).split(/[/?#]/)[0] || "").trim();
};

const ResetPasswordPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A word of the page, in the visitor's language, else as written.
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();
  const token: string = getResetPasswordToken(
    Navigation.getCurrentPath().toString(),
  );

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState<boolean>(false);

  if (!dashboardId) {
    return <AuthPageSkeleton fields={1} />;
  }

  const signInRoute: Route = new Route(
    PublicDashboardUtil.withLinkTheme(
      PublicDashboardUtil.getPagePath(PUBLIC_DASHBOARD_SIGN_IN_PATH),
    ),
  );

  const forgotPasswordRoute: Route = new Route(
    PublicDashboardUtil.withLinkTheme(
      PublicDashboardUtil.getPagePath(PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH),
    ),
  );

  const handleSubmit: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    const password: string =
      (
        values["password"] as { toString: () => string } | undefined
      )?.toString() || "";

    if (!password) {
      setFormError(translate(SIGN_IN_COPY.passwordRequired));
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await PublicDashboardSignIn.resetPassword({
        dashboardId,
        token,
        password,
      });
      setIsDone(true);
    } catch (err) {
      setFormError(API.getFriendlyMessage(err));
    }

    setIsSubmitting(false);
  };

  // A link that is spent, ran out or is not one offers a new one.
  const isLinkRefused: boolean = Boolean(
    formError && isResetLinkRefusal(formError),
  );

  return (
    <AuthPage
      title={translate(RESET_PASSWORD_COPY.title)}
      subtitle={props.dashboardName || translate(SIGN_IN_COPY.fallbackTitle)}
      footer={
        <Link
          to={isLinkRefused ? forgotPasswordRoute : signInRoute}
          className={AUTH_PAGE_LINK_CLASS}
        >
          {translate(
            isLinkRefused
              ? RESET_PASSWORD_COPY.requestNewLink
              : FORGOT_PASSWORD_COPY.backToSignIn,
          )}
        </Link>
      }
    >
      {isDone ? (
        <div className="space-y-4 text-center">
          <p
            className="text-sm text-gray-700"
            data-testid={RESET_PASSWORD_DONE_TEST_ID}
          >
            {translate(RESET_PASSWORD_COPY.done)}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-5 text-sm text-gray-600">
            {translate(RESET_PASSWORD_COPY.prompt)}
          </p>
          <BasicForm
            id="dashboard-reset-password-form"
            name="Dashboard Reset Password"
            initialValues={{
              password: "",
            }}
            fields={[
              {
                field: {
                  password: true,
                },
                title: RESET_PASSWORD_COPY.passwordLabel,
                required: true,
                fieldType: FormFieldSchemaType.Password,
                // A new password: password managers offer to make one.
                autoComplete: "new-password",
                isOwnCredential: true,
                disableSpellCheck: true,
              },
            ]}
            submitButtonText={RESET_PASSWORD_COPY.submit}
            maxPrimaryButtonWidth={true}
            isLoading={isSubmitting}
            error={formError || undefined}
            onSubmit={(values: JSONObject) => {
              void handleSubmit(values);
            }}
            footer={<></>}
          />
        </>
      )}
    </AuthPage>
  );
};

export default ResetPasswordPage;
