import {
  FORGOT_PASSWORD_COPY,
  FORGOT_PASSWORD_SENT_TEST_ID,
  SIGN_IN_COPY,
} from "./SignInCopy";
import API from "../../Utils/API";
import PublicDashboardUtil, {
  PUBLIC_DASHBOARD_SIGN_IN_PATH,
} from "../../Utils/PublicDashboard";
import PublicDashboardSignIn from "../../Utils/SignIn";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AuthPage, {
  AUTH_PAGE_LINK_CLASS,
} from "Common/UI/Components/AuthPage/AuthPage";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A dashboard's Forgot password page (#10250): an email address, then the
 * same answer for every address - sent or not, a private user of the
 * dashboard or not - so asking says nothing about who is invited. The
 * server counts the requests before it looks the address up, and its
 * refusal says when to come back.
 */
export interface ComponentProps {
  dashboardName: string;
}

const ForgotPasswordPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A word of the page, in the visitor's language, else as written.
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState<boolean>(false);

  if (!dashboardId) {
    return <AuthPageSkeleton fields={1} />;
  }

  const signInRoute: Route = new Route(
    PublicDashboardUtil.withLinkTheme(
      PublicDashboardUtil.getPagePath(PUBLIC_DASHBOARD_SIGN_IN_PATH),
    ),
  );

  const footer: ReactElement = (
    <Link to={signInRoute} className={AUTH_PAGE_LINK_CLASS}>
      {translate(FORGOT_PASSWORD_COPY.backToSignIn)}
    </Link>
  );

  const handleSubmit: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    const email: string = String(values["email"] || "").trim();

    if (!email) {
      setFormError(translate(SIGN_IN_COPY.emailRequired));
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await PublicDashboardSignIn.forgotPassword({ dashboardId, email });
      setIsSent(true);
    } catch (err) {
      setFormError(API.getFriendlyMessage(err));
    }

    setIsSubmitting(false);
  };

  return (
    <AuthPage
      title={translate(FORGOT_PASSWORD_COPY.title)}
      subtitle={props.dashboardName || translate(SIGN_IN_COPY.fallbackTitle)}
      footer={footer}
    >
      {isSent ? (
        <p
          className="text-center text-sm text-gray-700"
          data-testid={FORGOT_PASSWORD_SENT_TEST_ID}
        >
          {translate(FORGOT_PASSWORD_COPY.sent)}
        </p>
      ) : (
        <>
          <p className="mb-5 text-sm text-gray-600">
            {translate(FORGOT_PASSWORD_COPY.prompt)}
          </p>
          <BasicForm
            id="dashboard-forgot-password-form"
            name="Dashboard Forgot Password"
            initialValues={{
              email: "",
            }}
            fields={[
              {
                field: {
                  email: true,
                },
                title: SIGN_IN_COPY.emailLabel,
                fieldType: FormFieldSchemaType.Email,
                required: true,
                disableSpellCheck: true,
              },
            ]}
            submitButtonText={FORGOT_PASSWORD_COPY.submit}
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

export default ForgotPasswordPage;
