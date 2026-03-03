import { SERVICE_PROVIDER_LOGIN_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import { DASHBOARD_URL, IDENTITY_URL } from "Common/UI/Config";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, { ReactElement, useState } from "react";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Email from "Common/Types/Email";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import StaticModelList from "Common/UI/Components/ModelList/StaticModelList";

const LoginPage: () => JSX.Element = () => {
  const apiUrl: URL = SERVICE_PROVIDER_LOGIN_URL;

  if (UserUtil.isLoggedIn()) {
    Navigation.navigate(DASHBOARD_URL);
  }

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [projectSsoConfigList, setProjectSsoConfigList] = useState<
    Array<ProjectSSO>
  >([]);

  type FetchSSOConfigsFunction = (email: Email) => Promise<void>;

  const fetchSsoConfigs: FetchSSOConfigsFunction = async (
    email: Email,
  ): Promise<void> => {
    if (email) {
      setIsLoading(true);
      try {
        // get sso config by email.
        const listResult: HTTPErrorResponse | HTTPResponse<JSONArray> =
          await API.get({
            url: URL.fromString(apiUrl.toString()).addQueryParam(
              "email",
              email.toString(),
            ),
          });

        if (listResult instanceof HTTPErrorResponse) {
          throw listResult;
        }

        if (!listResult.data || (listResult.data as JSONArray).length === 0) {
          setError(
            "No SSO configuration found for the email: " + email.toString(),
          );
        } else {
          setProjectSsoConfigList(
            ProjectSSO.fromJSONArray(listResult["data"], ProjectSSO),
          );
        }
      } catch (error) {
        setError(API.getFriendlyErrorMessage(error as Error));
      }
    } else {
      setError("Email is required to perform this action");
    }

    setIsLoading(false);
  };

  type GetSsoConfigModelListFunction = (
    configs: Array<ProjectSSO>,
  ) => ReactElement;

  const getSsoConfigModelList: GetSsoConfigModelListFunction = (
    configs: Array<ProjectSSO>,
  ): ReactElement => {
    return (
      <StaticModelList<ProjectSSO>
        list={configs}
        titleField="name"
        selectedItems={[]}
        descriptionField="description"
        onClick={(item: ProjectSSO) => {
          setIsLoading(true);
          Navigation.navigate(
            URL.fromURL(IDENTITY_URL).addRoute(
              new Route(
                `/sso/${item.projectId?.toString()}/${item.id?.toString()}`,
              ),
            ),
          );
        }}
      />
    );
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  type GetProjectNameFunction = (projectId: string) => string;

  const getProjectName: GetProjectNameFunction = (
    projectId: string,
  ): string => {
    const projectNames: Array<string | undefined> = projectSsoConfigList
      .filter((config: ProjectSSO) => {
        return config.projectId?.toString() === projectId.toString();
      })
      .map((config: ProjectSSO) => {
        return config.project?.name;
      });
    return projectNames[0] || "Project";
  };

  if (projectSsoConfigList.length > 0 && !error && !isLoading) {
    const projectIds: Array<string> = projectSsoConfigList.map(
      (config: ProjectSSO) => {
        return config.projectId?.toString() as string;
      },
    );

    return (
      <div className="w-full max-w-md mx-auto px-4 sm:px-0">
        <div className="flex min-h-full flex-col justify-center py-8 sm:py-12">
          <div className="w-full">
            <img
              className="mx-auto h-10 w-auto sm:h-12"
              src={OneUptimeLogo}
              alt="OneUptime"
            />
            <h2 className="mt-6 sm:mt-10 text-center text-lg sm:text-xl tracking-tight text-gray-900">
              Select Project
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
              Select the project you want to login to.
            </p>
          </div>

          {projectIds.map((projectId: string) => {
            return (
              <div key={projectId}>
                <h3 className="mt-6 font-medium  tracking-tight">
                  {getProjectName(projectId)}
                </h3>
                {getSsoConfigModelList(
                  projectSsoConfigList.filter((config: ProjectSSO) => {
                    return (
                      config.projectId?.toString() === projectId.toString()
                    );
                  }),
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <img
          className="mx-auto h-10 w-auto sm:h-12"
          src={OneUptimeLogo}
          alt="OneUptime"
        />
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
          Login with SSO
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
          Login with your SSO provider to access your account.
        </p>
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
          <BasicForm
            modelType={User}
            id="login-form"
            error={error}
            name="Login"
            fields={[
              {
                field: {
                  email: true,
                },
                fieldType: FormFieldSchemaType.Email,
                placeholder: "jeff@example.com",
                required: true,
                title: "Email",
                dataTestId: "email",
                disableSpellCheck: true,
              },
            ]}
            maxPrimaryButtonWidth={true}
            submitButtonText="Login with SSO"
            onSubmit={async (data: JSONObject) => {
              await fetchSsoConfigs(data["email"] as Email);
            }}
            footer={
              <div className="actions text-center mt-4 hover:underline fw-semibold">
                <div>
                  <Link to={new Route("/accounts/login")}>
                    <div className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm">
                      Use username and password instead.
                    </div>
                  </Link>
                </div>
              </div>
            }
          />
        </div>
        <div className="mt-6 sm:mt-10 text-center">
          <div className="text-muted mb-0 text-gray-500 text-sm sm:text-base">
            Don&apos;t have an account?{" "}
            <Link
              to={new Route("/accounts/register")}
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              Register.
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
