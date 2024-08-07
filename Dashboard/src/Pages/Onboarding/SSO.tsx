import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Card from "Common/UI/src/Components/Card/Card";
import PageLoader from "Common/UI/src/Components/Loader/PageLoader";
import ModelList from "Common/UI/src/Components/ModelList/ModelList";
import Page from "Common/UI/src/Components/Page/Page";
import { APP_API_URL, IDENTITY_URL } from "Common/UI/src/Config";
import Navigation from "Common/UI/src/Utils/Navigation";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import React, { FunctionComponent, ReactElement, useState } from "react";

const SSO: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);

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
                      .addRoute(`/${DashboardNavigation.getProjectId()}`)
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
                    onSelectChange={(list: Array<ProjectSSO>) => {
                      if (list && list.length > 0) {
                        setIsLoading(true);
                        Navigation.navigate(
                          URL.fromURL(IDENTITY_URL).addRoute(
                            new Route(
                              `/sso/${DashboardNavigation.getProjectId()}/${
                                list[0]?._id
                              }`,
                            ),
                          ),
                        );
                      }
                    }}
                  />
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
