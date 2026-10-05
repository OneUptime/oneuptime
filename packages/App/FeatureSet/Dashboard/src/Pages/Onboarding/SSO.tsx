import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelList from "Common/UI/Components/ModelList/ModelList";
import Page from "Common/UI/Components/Page/Page";
import { APP_API_URL, IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Where a user lands when a project requires single sign-on, and what the
 * Settings > SSO and Settings > OIDC test links open: the project's enabled
 * providers, SAML (/project-sso/:projectId/sso-list) and OpenID Connect
 * (/project-oidc/:projectId/oidc-list) alike. Picking one starts its sign-in.
 *
 * It listed SAML providers only, so a project that signs in with OIDC was
 * told it had no provider at all, and the OIDC test link had nowhere to go.
 */
const SSO: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  /*
   * How many providers of each kind loaded; null until they have. When both
   * are none - the project has no enabled provider - the user is told why
   * and offered a way back to sign-in instead of a dead end.
   */
  const [samlProviderCount, setSamlProviderCount] = useState<number | null>(
    null,
  );
  const [oidcProviderCount, setOidcProviderCount] = useState<number | null>(
    null,
  );
  const hasNoProviders: boolean =
    samlProviderCount === 0 && oidcProviderCount === 0;

  const startSignIn: (path: string) => void = (path: string): void => {
    setIsLoading(true);
    Navigation.navigate(URL.fromURL(IDENTITY_URL).addRoute(new Route(path)));
  };

  return (
    <Page title={""} breadcrumbLinks={[]}>
      <div className="flex justify-center w-full mt-20">
        {isLoading && <PageLoader isVisible={true} />}
        {!isLoading && (
          <div className="w-1/3 min-w-lg">
            <Card
              title={"Single Sign On (SSO)"}
              description="Please select an SSO provider to log in to this project."
            >
              <div className="mt-6 -ml-6 -mr-6 border-t border-gray-200">
                <div className="ml-6 mr-6  pt-6">
                  <ModelList<ProjectSSO>
                    id="sso-list"
                    overrideFetchApiUrl={URL.fromString(APP_API_URL.toString())
                      .addRoute("/project-sso")
                      .addRoute(`/${ProjectUtil.getCurrentProjectId()}`)
                      .addRoute("/sso-list")}
                    modelType={ProjectSSO}
                    titleField="name"
                    descriptionField="description"
                    select={{
                      name: true,
                      description: true,
                      _id: true,
                    }}
                    noItemsMessage="No SSO Providers Configured or Enabled"
                    hideEmptyState={true}
                    onListLoaded={(list: Array<ProjectSSO>) => {
                      setSamlProviderCount(list.length);
                    }}
                    onSelectChange={(list: Array<ProjectSSO>) => {
                      if (list && list.length > 0) {
                        startSignIn(
                          `/sso/${ProjectUtil.getCurrentProjectId()}/${
                            list[0]?._id
                          }`,
                        );
                      }
                    }}
                  />
                  <ModelList<ProjectOIDC>
                    id="oidc-list"
                    overrideFetchApiUrl={URL.fromString(APP_API_URL.toString())
                      .addRoute("/project-oidc")
                      .addRoute(`/${ProjectUtil.getCurrentProjectId()}`)
                      .addRoute("/oidc-list")}
                    modelType={ProjectOIDC}
                    titleField="name"
                    descriptionField="description"
                    select={{
                      name: true,
                      description: true,
                      _id: true,
                    }}
                    noItemsMessage="No SSO Providers Configured or Enabled"
                    hideEmptyState={true}
                    onListLoaded={(list: Array<ProjectOIDC>) => {
                      setOidcProviderCount(list.length);
                    }}
                    onSelectChange={(list: Array<ProjectOIDC>) => {
                      if (list && list.length > 0) {
                        startSignIn(
                          `/oidc/${ProjectUtil.getCurrentProjectId()}/${
                            list[0]?._id
                          }`,
                        );
                      }
                    }}
                  />
                  {hasNoProviders && (
                    <div
                      className="mb-5 text-sm text-gray-600"
                      data-testid="sso-no-providers-help"
                    >
                      <p>
                        {translator.translateText(
                          "This project has no single sign-on provider you can use to log in. Ask a project admin to enable one.",
                        )}
                      </p>
                      <div className="mt-4">
                        <Link
                          to={RouteMap[PageMap.LOGOUT] as Route}
                          className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                        >
                          {translator.translateText("Back to sign in")}
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </Page>
  );
};

export default SSO;
