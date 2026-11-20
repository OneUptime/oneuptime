import {
  SIGN_IN_COPY,
  SIGN_IN_FORM_TEST_ID,
  SIGN_IN_NO_WAY_TEST_ID,
  SIGN_IN_PAGE_TEST_ID,
  SIGN_IN_PROVIDERS_TEST_ID,
} from "./SignInCopy";
import API from "../../Utils/API";
import PublicDashboardUtil, {
  PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH,
} from "../../Utils/PublicDashboard";
import PublicDashboardSignIn from "../../Utils/SignIn";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  DashboardSignInMethods,
  DashboardSignInProvider,
} from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import AuthPage from "Common/UI/Components/AuthPage/AuthPage";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import SignInOptionLink from "Common/UI/Components/SignInOption/SignInOptionLink";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A dashboard's sign-in page (#10250), on its public link - OneUptime's own
 * address and every custom domain of the dashboard: the dashboard's name,
 * what to do, then the ways in the dashboard offers
 * (DashboardPrivateUserApiRoutes.signInMethods) - an email and password,
 * unless it takes only single sign-on, and each single sign-on provider
 * that is on, each a full-width button under "or", as a status page's and
 * OneUptime's own sign-in pages draw theirs (SignInOptionLink). One column,
 * as wide as a sign-in form, with a 16px gutter on a phone (AuthPage).
 *
 * A wrong password and an address that is no private user of the dashboard
 * are answered alike: the server says so in one sentence.
 */
export interface ComponentProps {
  dashboardName: string;
  /*
   * What went wrong exchanging the code single sign-on handed back
   * (App.tsx), said above the ways in so the visitor can try again.
   */
  initialError?: string | null | undefined;
}

interface SignInProviderLink {
  provider: DashboardSignInProvider;
  url: URL;
}

const SignInPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A word of the page, in the visitor's language, else as written.
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();
  const dashboardIdKey: string = dashboardId?.toString() || "";

  const [methods, setMethods] = useState<DashboardSignInMethods | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!dashboardId) {
      return;
    }

    let isCurrent: boolean = true;

    PublicDashboardSignIn.getSignInMethods(dashboardId)
      .then((answer: DashboardSignInMethods) => {
        if (isCurrent) {
          setMethods(answer);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dashboardIdKey]);

  if (!dashboardId || (!methods && !loadError)) {
    return <AuthPageSkeleton fields={2} />;
  }

  const title: string =
    props.dashboardName || translate(SIGN_IN_COPY.fallbackTitle);

  if (!methods) {
    return (
      <AuthPage title={title} dataTestId={SIGN_IN_PAGE_TEST_ID}>
        <Alert type={AlertType.DANGER} title={loadError} />
      </AuthPage>
    );
  }

  const providerLinks: Array<SignInProviderLink> = [
    ...methods.samlProviders.map(
      (provider: DashboardSignInProvider): SignInProviderLink => {
        return {
          provider,
          url: PublicDashboardSignIn.getSamlSignInUrl({
            dashboardId,
            providerId: provider._id,
          }),
        };
      },
    ),
    ...methods.oidcProviders.map(
      (provider: DashboardSignInProvider): SignInProviderLink => {
        return {
          provider,
          url: PublicDashboardSignIn.getOidcSignInUrl({
            dashboardId,
            providerId: provider._id,
          }),
        };
      },
    ),
  ];

  const handleSubmit: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    const email: string = String(values["email"] || "").trim();
    const password: string =
      (
        values["password"] as { toString: () => string } | undefined
      )?.toString() || "";

    if (!email) {
      setFormError(translate(SIGN_IN_COPY.emailRequired));
      return;
    }

    if (!password) {
      setFormError(translate(SIGN_IN_COPY.passwordRequired));
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await PublicDashboardSignIn.signIn({ dashboardId, email, password });
      PublicDashboardUtil.navigateAfterSignIn();
    } catch (err) {
      setFormError(API.getFriendlyMessage(err));
      setIsSubmitting(false);
    }
  };

  const hasWayIn: boolean =
    methods.isPasswordSignInAllowed || providerLinks.length > 0;

  return (
    <AuthPage
      title={title}
      subtitle={translate(
        methods.isPasswordSignInAllowed
          ? SIGN_IN_COPY.prompt
          : SIGN_IN_COPY.ssoOnlyPrompt,
      )}
      dataTestId={SIGN_IN_PAGE_TEST_ID}
    >
      {props.initialError ? (
        <div className="mb-5">
          <Alert type={AlertType.DANGER} title={props.initialError} />
        </div>
      ) : (
        <></>
      )}

      {!hasWayIn ? (
        <p
          className="text-center text-sm text-gray-600"
          data-testid={SIGN_IN_NO_WAY_TEST_ID}
        >
          {translate(SIGN_IN_COPY.noWayToSignIn)}
        </p>
      ) : (
        <></>
      )}

      {methods.isPasswordSignInAllowed ? (
        <div data-testid={SIGN_IN_FORM_TEST_ID}>
          <BasicForm
            id="dashboard-sign-in-form"
            name="Dashboard Sign In"
            initialValues={{
              email: "",
              password: "",
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
              {
                field: {
                  password: true,
                },
                title: SIGN_IN_COPY.passwordLabel,
                required: true,
                // No length check: a password is checked by the server only.
                fieldType: FormFieldSchemaType.Password,
                // The sign-in password: password managers fill it.
                autoComplete: "current-password",
                isOwnCredential: true,
                disableSpellCheck: true,
                sideLink: {
                  text: SIGN_IN_COPY.forgotPassword,
                  url: new Route(
                    PublicDashboardUtil.withLinkTheme(
                      PublicDashboardUtil.getPagePath(
                        PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH,
                      ),
                    ),
                  ),
                  openLinkInNewTab: false,
                },
              },
            ]}
            submitButtonText={SIGN_IN_COPY.submit}
            maxPrimaryButtonWidth={true}
            isLoading={isSubmitting}
            error={formError || undefined}
            onSubmit={(values: JSONObject) => {
              void handleSubmit(values);
            }}
            footer={<></>}
          />
        </div>
      ) : (
        <></>
      )}

      {providerLinks.length > 0 ? (
        <div data-testid={SIGN_IN_PROVIDERS_TEST_ID}>
          {methods.isPasswordSignInAllowed ? (
            <LabelledDivider
              label={translate(SIGN_IN_COPY.or)}
              className="my-5"
            />
          ) : (
            <></>
          )}
          <div className="space-y-3">
            {providerLinks.map((link: SignInProviderLink) => {
              return (
                <SignInOptionLink
                  key={link.provider._id}
                  to={link.url}
                  icon={IconProp.ShieldCheck}
                  dataTestId={`dashboard-sign-in-provider-${link.provider._id}`}
                  title={translator.translateTemplate(
                    SIGN_IN_COPY.signInWithProvider,
                    { provider: link.provider.name },
                  )}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <></>
      )}
    </AuthPage>
  );
};

export default SignInPage;
