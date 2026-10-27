import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SignInMethodsUtil, {
  SsoSignInProvider,
} from "Common/Types/SSO/SignInMethods";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Where a user lands when a project requires single sign-on - itself, or
 * because the whole server does - and what Settings > SSO's test link opens:
 * every provider that signs people in to the project, one button each.
 * Picking one starts its sign-in.
 *
 * They come from GET /identity/project-sign-in-methods/:projectId
 * (Common/Server/Utils/SsoSignInMethods): the project's own SAML and OpenID
 * Connect providers that are on, and the server's instance-wide providers
 * that sign people in to it - or only the one the project requires. The page
 * listed the project's own providers alone, so a project that signs in
 * through the server's provider - every project, once the whole server
 * requires SSO - told the person it had no provider, and to ask an admin.
 *
 * With none, it says so and offers the way back to sign-in, rather than a
 * dead end. A list that cannot be read says so, with Try again.
 */

// What a provider's button says when its admin wrote no description of their own.
export const SIGN_IN_WITH_PROVIDER: string = translationKey(
  "Sign in with {{name}}",
);

export const NO_PROVIDER_HELP: string = translationKey(
  "This project has no single sign-on provider you can use to log in. Ask a project admin to enable one.",
);

// The project's sign-in providers, on the identity server.
export const getProjectSignInMethodsUrl: (projectId: ObjectID) => URL = (
  projectId: ObjectID,
): URL => {
  return URL.fromURL(IDENTITY_URL).addRoute(
    new Route(`/project-sign-in-methods/${projectId.toString()}`),
  );
};

const SSO: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Null until read.
  const [providers, setProviders] = useState<Array<SsoSignInProvider> | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  // A provider was picked: the browser is on its way to it.
  const [isLeaving, setIsLeaving] = useState<boolean>(false);

  // Bumped by every read: an answer for one the page has moved on from is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const readProviders: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setError("");
    setProviders(null);

    if (!projectId) {
      setProviders([]);
      return;
    }

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: getProjectSignInMethodsUrl(projectId),
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
  }, [projectId?.toString()]);

  if (isLeaving) {
    return <PageLoader isVisible={true} />;
  }

  const options: Array<SsoProviderOption> = (providers || []).map(
    (provider: SsoSignInProvider): SsoProviderOption => {
      /*
       * "Sign in with Okta", in the reader's language, unless the admin
       * wrote a description of their own: then the provider's name, and the
       * description under it.
       */
      const hasOwnDescription: boolean =
        SignInMethodsUtil.hasOwnDescription(provider);

      return {
        key: `${provider.type}:${provider.id}`,
        title: hasOwnDescription
          ? provider.name
          : translator.translateTemplate(SIGN_IN_WITH_PROVIDER, {
              name: provider.name,
            }),
        description: hasOwnDescription ? provider.description : undefined,
        dataTestId: "project-sso-provider",
        onClick: (): void => {
          const route: string | null = SignInMethodsUtil.getSignInRoute({
            provider: provider,
            projectId: projectId?.toString(),
          });

          if (!route) {
            return;
          }

          setIsLeaving(true);
          Navigation.navigate(
            URL.fromURL(IDENTITY_URL).addRoute(new Route(route)),
          );
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

    if (providers === null) {
      return <ComponentLoader />;
    }

    if (options.length === 0) {
      return (
        <div
          className="text-sm text-gray-600"
          data-testid="sso-no-providers-help"
        >
          <p>{translator.translateText(NO_PROVIDER_HELP)}</p>
          <div className="mt-4">
            <Link
              to={RouteMap[PageMap.LOGOUT] as Route}
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              {translator.translateText("Back to sign in")}
            </Link>
          </div>
        </div>
      );
    }

    return (
      <SsoProviderOptions
        options={options}
        isOnlyWayIn={true}
        dataTestId="project-sso-providers"
      />
    );
  };

  /*
   * One column the width of the sign-in pages' card, centred, at any width:
   * it was a third of the page with a 32rem minimum, wider than a phone.
   */
  return (
    <Page title={""} breadcrumbLinks={[]}>
      <div className="mx-auto mt-8 w-full max-w-md sm:mt-20">
        <Card
          title={"Single Sign On (SSO)"}
          description="Please select an SSO provider to log in to this project."
        >
          {getBody()}
        </Card>
      </div>
    </Page>
  );
};

export default SSO;
