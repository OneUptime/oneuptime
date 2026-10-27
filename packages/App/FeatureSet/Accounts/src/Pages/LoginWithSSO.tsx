import {
  SERVICE_PROVIDER_LOGIN_OIDC_URL,
  SERVICE_PROVIDER_LOGIN_URL,
} from "../Utils/ApiPaths";
import { SignInMethodsRead, useSignInMethods } from "../Utils/SignInMethods";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import SignInMethodsUtil, {
  SignInMethods,
  SsoSignInProvider,
} from "Common/Types/SSO/SignInMethods";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import { DASHBOARD_URL, IDENTITY_URL } from "Common/UI/Config";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import { isProductRenamed } from "Common/UI/Utils/ProductBranding";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Email from "Common/Types/Email";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import SignInOptionLink from "Common/UI/Components/SignInOption/SignInOptionLink";
import SsoProviderOptions, {
  SsoProviderOption,
} from "Common/UI/Components/SignInOption/SsoProviderOptions";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  /*
   * How the server signs people in, when the page drawing this one has read
   * it already: the sign-in and sign-up pages draw this page in their place
   * while the server requires SSO. It is then not read again, and that page
   * has sent a signed-in visitor on already.
   */
  signInMethods?: SignInMethods | undefined;
  // The edition label over the heading, as the sign-in page draws it.
  showEditionLabel?: boolean | undefined;
}

/*
 * The test ids of the page's own parts, for its tests and the browser suite.
 */
export const SSO_PROJECTS_TEST_ID: string = "sso-projects";
export const USE_DIFFERENT_EMAIL_TEST_ID: string = "sso-use-different-email";

/*
 * Signing in with single sign-on (/accounts/sso), and - while the whole
 * server requires SSO - the sign-in and sign-up pages too.
 *
 * The instance-wide providers come first, one button each: they are not
 * bound to an email address, so somebody with an organization-wide identity
 * provider signs in without typing one. Under them, the email form finds the
 * providers of the projects the address belongs to, and the page then lists
 * them by project, drawn as the instance-wide ones are, with a way back to
 * the form.
 *
 * While the server requires SSO (Admin Dashboard > Settings > Single Sign-On
 * > Require SSO for Login), the page offers only SSO: no way back to a
 * password, no sign-up, and the email form only when some project has a
 * provider of its own to find - with only instance-wide providers, typing an
 * address could only end in "No SSO configuration found" (issue #5193). A
 * page whose one way in is one provider draws it as its filled button. The
 * server refuses a password meanwhile anyway (SsoRequiredSignIn); master
 * admins sign in with theirs at /accounts/admin-login.
 */
const LoginWithSsoPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  // Drawn in another page's place, which has sent a signed-in visitor on.
  const isOwnPage: boolean = !props.signInMethods;

  /*
   * A visitor who is already signed in is sent on to the Dashboard -- once,
   * as the page mounts, not on every render, where it would repeat the
   * navigation and abort the one already under way.
   */
  useEffect(() => {
    if (isOwnPage && UserUtil.isLoggedIn()) {
      Navigation.navigate(DASHBOARD_URL);
    }
  }, []);

  const signInMethodsRead: SignInMethodsRead = useSignInMethods(
    props.signInMethods,
  );
  const signInMethods: SignInMethods | null = signInMethodsRead.signInMethods;

  const [error, setError] = useState<string | undefined>(undefined);
  /*
   * The email lookup is running. The form stays where it is, its button
   * busy: it used to give way to a page-wide loader and come back empty, so
   * an address that found nothing was named in the error above a field that
   * no longer held it (the screenshot in issue #5193).
   */
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);
  // A provider was picked: the browser is on its way to its sign-in.
  const [isLeaving, setIsLeaving] = useState<boolean>(false);
  // The address looked up last, kept in the field when the form comes back.
  const [lookedUpEmail, setLookedUpEmail] = useState<string>("");
  const [samlConfigs, setSamlConfigs] = useState<Array<ProjectSSO>>([]);
  const [oidcConfigs, setOidcConfigs] = useState<Array<ProjectOIDC>>([]);

  /*
   * What the email form starts with when it is drawn again - back from the
   * list of an address's projects - so the address is still in it. A form
   * the visitor has typed into keeps what they typed (BasicForm).
   */
  const emailFormInitialValues: JSONObject = useMemo((): JSONObject => {
    return lookedUpEmail ? { email: lookedUpEmail } : {};
  }, [lookedUpEmail]);

  /*
   * The list of an address's projects takes the form's place: the keyboard
   * and a screen reader start at its heading, rather than at the top of a
   * page whose form, and the focus in it, have gone.
   */
  const isListingProjects: boolean =
    (samlConfigs.length > 0 || oidcConfigs.length > 0) && !error;
  const projectsHeadingRef: MutableRefObject<HTMLHeadingElement | null> =
    useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (isListingProjects) {
      projectsHeadingRef.current?.focus();
    }
  }, [isListingProjects]);

  type FetchSSOConfigsFunction = (email: Email) => Promise<void>;

  const fetchSsoConfigs: FetchSSOConfigsFunction = async (
    email: Email,
  ): Promise<void> => {
    if (!email) {
      setError(t("sso.emailRequired"));
      return;
    }

    // A new lookup answers for itself: the last one's error goes.
    setError(undefined);
    setLookedUpEmail(email.toString());
    setIsLookingUp(true);

    try {
      const [samlResult, oidcResult] = await Promise.all([
        API.get({
          url: URL.fromString(
            SERVICE_PROVIDER_LOGIN_URL.toString(),
          ).addQueryParam("email", email.toString()),
        }).catch((e: HTTPErrorResponse): HTTPErrorResponse => {
          return e;
        }),
        API.get({
          url: URL.fromString(
            SERVICE_PROVIDER_LOGIN_OIDC_URL.toString(),
          ).addQueryParam("email", email.toString()),
        }).catch((e: HTTPErrorResponse): HTTPErrorResponse => {
          return e;
        }),
      ]);

      let nextSaml: Array<ProjectSSO> = [];
      let nextOidc: Array<ProjectOIDC> = [];

      if (
        !(samlResult instanceof HTTPErrorResponse) &&
        (samlResult as HTTPResponse<JSONArray>).data
      ) {
        nextSaml = ProjectSSO.fromJSONArray(
          (samlResult as HTTPResponse<JSONArray>).data,
          ProjectSSO,
        );
      }

      if (
        !(oidcResult instanceof HTTPErrorResponse) &&
        (oidcResult as HTTPResponse<JSONArray>).data
      ) {
        nextOidc = ProjectOIDC.fromJSONArray(
          (oidcResult as HTTPResponse<JSONArray>).data,
          ProjectOIDC,
        );
      }

      if (nextSaml.length === 0 && nextOidc.length === 0) {
        setError(t("sso.noConfigForEmail", { email: email.toString() }));
      } else {
        setSamlConfigs(nextSaml);
        setOidcConfigs(nextOidc);
      }
    } catch (e) {
      setError(API.getFriendlyErrorMessage(e as Error));
    }

    setIsLookingUp(false);
  };

  // Sends the browser to a provider's sign-in, on the identity server.
  const startSignIn: (route: string) => void = (route: string): void => {
    setIsLeaving(true);
    Navigation.navigate(URL.fromURL(IDENTITY_URL).addRoute(new Route(route)));
  };

  /*
   * A provider as a button: "Sign in with Okta", in the visitor's language,
   * unless the admin wrote a description of their own ("Use your Acme
   * email"): the button then says the provider's name, and the description
   * is under it.
   */
  const toProviderOption: (data: {
    provider: SsoSignInProvider;
    projectId?: string | undefined;
    dataTestId: string;
  }) => SsoProviderOption = (data: {
    provider: SsoSignInProvider;
    projectId?: string | undefined;
    dataTestId: string;
  }): SsoProviderOption => {
    const hasOwnDescription: boolean = SignInMethodsUtil.hasOwnDescription(
      data.provider,
    );

    return {
      key: `${data.provider.type}:${data.provider.id}`,
      title: hasOwnDescription
        ? data.provider.name
        : t("sso.signInWithProvider", { name: data.provider.name }),
      description: hasOwnDescription ? data.provider.description : undefined,
      dataTestId: data.dataTestId,
      onClick: (): void => {
        const route: string | null = SignInMethodsUtil.getSignInRoute({
          provider: data.provider,
          projectId: data.projectId,
        });

        if (route) {
          startSignIn(route);
        }
      },
    };
  };

  /*
   * Until the page knows whether the server requires SSO it draws nothing of
   * its own: never a way back to a password it may then take away.
   */
  if (signInMethodsRead.isReading || isLeaving) {
    return <PageLoader isVisible={true} />;
  }

  const isSsoRequired: boolean = Boolean(signInMethods?.isSsoRequired);

  /*
   * The logo, the edition where the sign-in page shows it, and the heading
   * (which can take the focus, given a ref).
   */
  const renderHeader: (
    title: string,
    subtitle: string,
    headingRef?: MutableRefObject<HTMLHeadingElement | null> | undefined,
  ) => ReactElement = (
    title: string,
    subtitle: string,
    headingRef?: MutableRefObject<HTMLHeadingElement | null> | undefined,
  ): ReactElement => {
    return (
      <div className="w-full max-w-md mx-auto">
        <ProductLogo />
        {/*
         * Which OneUptime edition this is, where the sign-in page shows it:
         * not on an installation that goes by a name of its own.
         */}
        {props.showEditionLabel && !isProductRenamed() && (
          <div className="mt-4 flex justify-center">
            <EditionLabel />
          </div>
        )}
        <h2
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900 text-balance focus:outline-none"
        >
          {title}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0 text-balance">
          {subtitle}
        </p>
      </div>
    );
  };

  const getProjectName: (projectId: string) => string = (
    projectId: string,
  ): string => {
    const samlMatch: ProjectSSO | undefined = samlConfigs.find(
      (c: ProjectSSO) => {
        return c.projectId?.toString() === projectId;
      },
    );
    if (samlMatch?.project?.name) {
      return samlMatch.project.name;
    }
    const oidcMatch: ProjectOIDC | undefined = oidcConfigs.find(
      (c: ProjectOIDC) => {
        return c.projectId?.toString() === projectId;
      },
    );
    if (oidcMatch?.project?.name) {
      return oidcMatch.project.name;
    }
    return t("sso.defaultProjectName");
  };

  /*
   * The providers of the projects an address belongs to, by project: drawn
   * as the instance-wide providers are, in the page's card - one filled
   * button when there is one provider in all - with a way back to the email
   * form, the address still in it. They were a list of their own under the
   * project names, with no way back but reloading the page.
   */
  if (isListingProjects) {
    const projectIdSet: Set<string> = new Set();
    for (const c of samlConfigs) {
      if (c.projectId) {
        projectIdSet.add(c.projectId.toString());
      }
    }
    for (const c of oidcConfigs) {
      if (c.projectId) {
        projectIdSet.add(c.projectId.toString());
      }
    }
    const projectIds: Array<string> = Array.from(projectIdSet);

    const toProvider: (
      config: ProjectSSO | ProjectOIDC,
      type: SsoProviderType,
    ) => SsoSignInProvider = (
      config: ProjectSSO | ProjectOIDC,
      type: SsoProviderType,
    ): SsoSignInProvider => {
      return {
        type: type,
        id: config.id?.toString() || config._id?.toString() || "",
        name: config.name || "",
        description: config.description || "",
      };
    };

    const providerCount: number = samlConfigs.length + oidcConfigs.length;

    return (
      <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
        {renderHeader(
          t("sso.selectProjectTitle"),
          t("sso.selectProjectSubtitle"),
          projectsHeadingRef,
        )}

        <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
          <div
            className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10 space-y-6"
            data-testid={SSO_PROJECTS_TEST_ID}
          >
            {projectIds.map((projectId: string): ReactElement => {
              const options: Array<SsoProviderOption> = [
                ...samlConfigs
                  .filter((c: ProjectSSO) => {
                    return c.projectId?.toString() === projectId;
                  })
                  .map((c: ProjectSSO): SsoProviderOption => {
                    return toProviderOption({
                      provider: toProvider(c, SsoProviderType.ProjectSSO),
                      projectId: projectId,
                      dataTestId: "sso-project-provider",
                    });
                  }),
                ...oidcConfigs
                  .filter((c: ProjectOIDC) => {
                    return c.projectId?.toString() === projectId;
                  })
                  .map((c: ProjectOIDC): SsoProviderOption => {
                    return toProviderOption({
                      provider: toProvider(c, SsoProviderType.ProjectOIDC),
                      projectId: projectId,
                      dataTestId: "sso-project-provider",
                    });
                  }),
              ];

              return (
                <div key={projectId} data-testid="sso-project">
                  <h3
                    dir="auto"
                    className="mb-3 text-center text-sm font-medium tracking-tight text-gray-900 break-words text-balance"
                  >
                    {getProjectName(projectId)}
                  </h3>
                  <SsoProviderOptions
                    options={options}
                    isOnlyWayIn={providerCount === 1}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-6 sm:mt-10 text-center">
            <button
              type="button"
              data-testid={USE_DIFFERENT_EMAIL_TEST_ID}
              onClick={() => {
                setSamlConfigs([]);
                setOidcConfigs([]);
              }}
              className="rounded text-sm sm:text-base text-indigo-500 hover:text-indigo-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              {t("sso.useDifferentEmail")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /*
   * The email form finds the providers of a project the address belongs to:
   * kept unless the server requires SSO and no project has one of its own.
   */
  const hasEmailForm: boolean =
    !isSsoRequired || Boolean(signInMethods?.hasProjectSsoProviders);

  const providerOptions: Array<SsoProviderOption> = (
    signInMethods?.ssoProviders || []
  ).map((provider: SsoSignInProvider): SsoProviderOption => {
    return toProviderOption({
      provider: provider,
      dataTestId: "sso-provider",
    });
  });

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      {renderHeader(
        isSsoRequired ? t("login.title") : t("sso.title"),
        isSsoRequired ? t("sso.requiredSubtitle") : t("sso.subtitle"),
      )}

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
          {providerOptions.length > 0 && (
            <div
              className={hasEmailForm ? "mb-6" : ""}
              data-testid="sso-providers"
            >
              {/*
               * Named only beside the email form: on a page that offers
               * nothing else, the heading above says it already.
               */}
              {hasEmailForm && (
                <h3 className="mb-3 text-center text-sm font-medium tracking-tight text-gray-900">
                  {t("sso.globalProvidersTitle")}
                </h3>
              )}
              <SsoProviderOptions
                options={providerOptions}
                isOnlyWayIn={!hasEmailForm}
                dataTestId="sso-provider-options"
              />
              {hasEmailForm && (
                <LabelledDivider
                  label={t("sso.globalProvidersDivider")}
                  dataTestId="global-providers-divider"
                />
              )}
            </div>
          )}
          {hasEmailForm && (
            <BasicForm
              modelType={User}
              id="login-form"
              error={error}
              name="Login"
              initialValues={emailFormInitialValues}
              isLoading={isLookingUp}
              fields={[
                {
                  field: {
                    email: true,
                  },
                  fieldType: FormFieldSchemaType.Email,
                  placeholder: "jeff@example.com",
                  required: true,
                  title: t("common.email"),
                  dataTestId: "email",
                  disableSpellCheck: true,
                },
              ]}
              maxPrimaryButtonWidth={true}
              submitButtonText={t("sso.submitButton")}
              onSubmit={async (data: JSONObject) => {
                await fetchSsoConfigs(data["email"] as Email);
              }}
              footer={
                isSsoRequired ? undefined : (
                  /*
                   * The way back to the password form, drawn as the password
                   * page draws its other ways in: an outlined button under
                   * "or", as wide and as tall as this page's own button
                   * (SignInOptionStyle). It was a small text link, the
                   * mirror of the one that brought the visitor here. Not
                   * while the server requires SSO: it would only refuse.
                   */
                  <div data-testid="sign-in-options">
                    <LabelledDivider
                      label={t("common.or")}
                      className="my-5"
                      dataTestId="sign-in-options-divider"
                    />
                    <SignInOptionLink
                      to={new Route("/accounts/login")}
                      id="password-login"
                      dataTestId="password-login"
                      icon={IconProp.Lock}
                      title={t("sso.signInWithPassword")}
                    />
                  </div>
                )
              }
            />
          )}
          {/*
           * The server requires SSO and has nothing to sign in with yet: a
           * master admin has turned the requirement on before any provider.
           * Say so, rather than draw an empty card.
           */}
          {providerOptions.length === 0 && !hasEmailForm && (
            <p
              className="text-center text-sm text-gray-600 text-balance"
              data-testid="sso-not-set-up"
            >
              {t("sso.requiredNotSetUp")}
            </p>
          )}
        </div>
        {!isSsoRequired && (
          <div className="mt-6 sm:mt-10 text-center">
            <div className="text-muted mb-0 text-gray-500 text-sm sm:text-base">
              {t("sso.noAccountPrompt")}{" "}
              <Link
                to={new Route("/accounts/register")}
                className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
              >
                {t("sso.registerLink")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginWithSsoPage;
