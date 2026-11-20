import { getProjectSignInMethodsApiUrl } from "../Utils/ApiPaths";
import { rememberSsoProvider } from "../Utils/RememberedSsoProvider";
import { confirmInvitationSsoSignIn } from "../Utils/SignUpInvitation";
import {
  InvitationSsoSignInLink,
  readInvitationSsoSignInLink,
} from "Common/Types/Accounts/InvitationSsoSignIn";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SignInMethodsUtil, {
  SsoSignInProvider,
} from "Common/Types/SSO/SignInMethods";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import SsoProviderOptions, {
  SsoProviderOption,
} from "Common/UI/Components/SignInOption/SsoProviderOptions";
import { IDENTITY_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Location, Params, useLocation, useParams } from "react-router-dom";

/*
 * A PROJECT'S SSO SIGN-IN LINK (/accounts/sso/<project id>, #9918).
 *
 * "Sign in with SSO" (/accounts/sso) finds a project's providers by the
 * address's verified domain alone, never by its account (#9824). So it
 * finds nothing for someone whose address is on another domain - a
 * contractor at gmail.com in Acme's project - or for a project that has not
 * verified its domain (one whose DNS another team runs). This is their way
 * in: the project's admin shares the link (Dashboard: Settings > SSO > SSO
 * Sign-in Link), and the page lists the providers that sign people in to
 * that project, one button each, as "Sign in with SSO" draws an address's
 * (GET /identity/project-sign-in-methods/<project id>: the project's own
 * that are on, and the instance-wide ones that reach it).
 *
 * It asks for no address, so it says nothing about who has an account, and
 * what it reads by the project's id is only what the sign-in pages draw:
 * the providers' kinds, ids, names and descriptions. A link that names no
 * project, or one with no provider turned on, says so, and how to go on.
 *
 * A visitor already signed in sees it too, never sent on to the Dashboard:
 * an admin opens the link to try a provider before requiring SSO, and
 * someone whose project requires SSO signs in through it again.
 *
 * A project provider picked here is remembered on this device (#9986,
 * Utils/RememberedSsoProvider), so "Sign in with SSO" offers it first next
 * time: nobody has to keep the link.
 *
 * An invitation opens it too, for someone who has signed up already whose
 * sign-in the project's single sign-on manages (#10178). On OneUptime Cloud
 * that link carries a single-use link of the invitation's own
 * (Common/Types/Accounts/InvitationSsoSignIn), which only their mailbox was
 * sent: picking a provider first tells the server so
 * (confirmInvitationSsoSignIn) - the confirmation the second email asked
 * for - and only then starts its sign-in, so the provider signs them in the
 * first time. Whatever the server says, or if it says nothing in time, the
 * sign-in starts all the same, and the provider's answer asks the mailbox
 * as it always did. Opened without one, nothing is sent.
 */

// The test ids of the page's own parts, for its tests and the browser suite.
export const PROJECT_SSO_PROVIDERS_TEST_ID: string = "project-sso-providers";
export const PROJECT_SSO_PROVIDER_TEST_ID: string = "project-sso-provider";
export const PROJECT_SSO_NO_PROVIDER_TEST_ID: string =
  "project-sso-no-provider";
export const PROJECT_SSO_OTHER_WAY_TEST_ID: string = "project-sso-other-way";

const LoginWithProjectSsoPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const params: Readonly<Params<string>> = useParams();
  const projectId: string = (params["projectId"] || "").trim();

  // An invitation's single-use link, when the page was opened with one (#10178).
  const location: Location = useLocation();
  const [invitationLink] = useState<InvitationSsoSignInLink | null>(
    (): InvitationSsoSignInLink | null => {
      return readInvitationSsoSignInLink(location.search || "");
    },
  );

  // Null until read; empty when the link names no project.
  const [providers, setProviders] = useState<Array<SsoSignInProvider> | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  // A provider was picked: the browser is on its way to its sign-in.
  const [isLeaving, setIsLeaving] = useState<boolean>(false);

  // Bumped by every read: an answer for one the page has moved on from is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const readProviders: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setError("");
    setProviders(null);

    // A link that names no project has nothing to read.
    if (!ObjectID.isValidUUID(projectId)) {
      setProviders([]);
      return;
    }

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: getProjectSignInMethodsApiUrl(projectId),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (readRef.current === read) {
        setProviders(
          SignInMethodsUtil.parseProjectMethods(response.data).ssoProviders,
        );
      }
    } catch (err) {
      if (readRef.current === read) {
        setError(API.getFriendlyMessage(err));
      }
    }
  };

  useEffect(() => {
    void readProviders();

    return () => {
      readRef.current += 1;
    };
  }, [projectId]);

  if (isLeaving || (providers === null && !error)) {
    return <AuthPageSkeleton fields={1} />;
  }

  /*
   * The invitation's link said first, when the page was opened with one,
   * then the provider's sign-in, whatever came of it (#10178).
   */
  const signInWith: (route: string) => Promise<void> = async (
    route: string,
  ): Promise<void> => {
    if (invitationLink) {
      await confirmInvitationSsoSignIn({
        token: invitationLink.token,
        signature: invitationLink.signature,
        projectId: projectId,
      });
    }

    Navigation.navigate(URL.fromURL(IDENTITY_URL).addRoute(new Route(route)));
  };

  /*
   * "Sign in with Okta", in the visitor's language, unless the admin wrote a
   * description of their own: then the provider's name, and the description
   * under it - as every sign-in page draws a provider.
   */
  const options: Array<SsoProviderOption> = (providers || []).map(
    (provider: SsoSignInProvider): SsoProviderOption => {
      const hasOwnDescription: boolean =
        SignInMethodsUtil.hasOwnDescription(provider);

      return {
        key: `${provider.type}:${provider.id}`,
        title: hasOwnDescription
          ? provider.name
          : t("sso.signInWithProvider", { name: provider.name }),
        description: hasOwnDescription ? provider.description : undefined,
        dataTestId: PROJECT_SSO_PROVIDER_TEST_ID,
        onClick: (): void => {
          const route: string | null = SignInMethodsUtil.getSignInRoute({
            provider: provider,
            projectId: projectId,
          });

          if (!route) {
            return;
          }

          /*
           * Remembered on this device, so "Sign in with SSO" offers it first
           * next time and the link need not be kept (#9986): a project's own
           * provider only, by its kind and ids.
           */
          rememberSsoProvider({ provider: provider, projectId: projectId });

          setIsLeaving(true);
          void signInWith(route);
        },
      };
    },
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void readProviders();
          }}
        />
      );
    }

    if (options.length === 0) {
      return (
        <p
          className="text-center text-sm text-gray-600 text-balance"
          data-testid={PROJECT_SSO_NO_PROVIDER_TEST_ID}
        >
          {t("sso.projectNoProvider")}
        </p>
      );
    }

    return (
      <SsoProviderOptions
        options={options}
        // One provider is the page's filled button, as on Sign in with SSO.
        isOnlyWayIn={true}
        dataTestId={PROJECT_SSO_PROVIDERS_TEST_ID}
      />
    );
  };

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <ProductLogo />
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900 text-balance">
          {t("sso.title")}
        </h2>
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
          {getBody()}
        </div>
        {/*
         * Every other way in - a password, a passkey, "Sign in with SSO" by
         * email - is on the sign-in page, which offers only what the server
         * allows.
         */}
        <div className="mt-6 sm:mt-10 text-center text-sm sm:text-base">
          <Link
            to={new Route("/accounts/login")}
            className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            dataTestId={PROJECT_SSO_OTHER_WAY_TEST_ID}
          >
            {t("sso.signInAnotherWay")}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LoginWithProjectSsoPage;
