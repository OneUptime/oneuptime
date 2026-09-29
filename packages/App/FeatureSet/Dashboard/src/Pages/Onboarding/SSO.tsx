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
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import React, { FunctionComponent, ReactElement, useState } from "react";

const SSO: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  /*
   * Set once the provider list has loaded empty. That happens when the
   * project has no enabled SSO provider, and always on the Community Edition,
   * where SSO login is not available (the server lists no providers there).
   * The user is then told why and offered a way back to sign-in instead of a
   * dead end.
   */
  const [hasNoProviders, setHasNoProviders] = useState<boolean>(false);

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
                    onListLoaded={(list: Array<ProjectSSO>) => {
                      setHasNoProviders(list.length === 0);
                    }}
                    onSelectChange={(list: Array<ProjectSSO>) => {
                      if (list && list.length > 0) {
                        setIsLoading(true);
                        Navigation.navigate(
                          URL.fromURL(IDENTITY_URL).addRoute(
                            new Route(
                              `/sso/${ProjectUtil.getCurrentProjectId()}/${
                                list[0]?._id
                              }`,
                            ),
                          ),
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
                        This project has no single sign-on provider you can use
                        to log in. Ask a project admin to enable one. Single
                        sign-on is part of the OneUptime Enterprise Edition; on
                        a Community Edition server, sign in with your email and
                        password instead.
                      </p>
                      <div className="mt-4">
                        <Link
                          to={RouteMap[PageMap.LOGOUT] as Route}
                          className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                        >
                          Back to sign in
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
