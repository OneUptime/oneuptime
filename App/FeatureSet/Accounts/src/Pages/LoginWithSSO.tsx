import {
  SERVICE_PROVIDER_LOGIN_OIDC_URL,
  SERVICE_PROVIDER_LOGIN_URL,
} from "../Utils/ApiPaths";
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
import { useTranslation } from "react-i18next";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Email from "Common/Types/Email";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import StaticModelList from "Common/UI/Components/ModelList/StaticModelList";

const LoginPage: () => JSX.Element = () => {
  const { t } = useTranslation();

  if (UserUtil.isLoggedIn()) {
    Navigation.navigate(DASHBOARD_URL);
  }

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [samlConfigs, setSamlConfigs] = useState<Array<ProjectSSO>>([]);
  const [oidcConfigs, setOidcConfigs] = useState<Array<ProjectOIDC>>([]);

  type FetchSSOConfigsFunction = (email: Email) => Promise<void>;

  const fetchSsoConfigs: FetchSSOConfigsFunction = async (
    email: Email,
  ): Promise<void> => {
    if (!email) {
      setError(t("sso.emailRequired"));
      return;
    }

    setIsLoading(true);
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

    setIsLoading(false);
  };

  const renderSamlList: (configs: Array<ProjectSSO>) => ReactElement = (
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

  const renderOidcList: (configs: Array<ProjectOIDC>) => ReactElement = (
    configs: Array<ProjectOIDC>,
  ): ReactElement => {
    return (
      <StaticModelList<ProjectOIDC>
        list={configs}
        titleField="name"
        selectedItems={[]}
        descriptionField="description"
        onClick={(item: ProjectOIDC) => {
          setIsLoading(true);
          Navigation.navigate(
            URL.fromURL(IDENTITY_URL).addRoute(
              new Route(
                `/oidc/${item.projectId?.toString()}/${item.id?.toString()}`,
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

  const hasAnyConfigs: boolean =
    samlConfigs.length > 0 || oidcConfigs.length > 0;

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

  if (hasAnyConfigs && !error && !isLoading) {
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
              {t("sso.selectProjectTitle")}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
              {t("sso.selectProjectSubtitle")}
            </p>
          </div>

          {projectIds.map((projectId: string) => {
            const samlForProject: Array<ProjectSSO> = samlConfigs.filter(
              (c: ProjectSSO) => {
                return c.projectId?.toString() === projectId;
              },
            );
            const oidcForProject: Array<ProjectOIDC> = oidcConfigs.filter(
              (c: ProjectOIDC) => {
                return c.projectId?.toString() === projectId;
              },
            );

            return (
              <div key={projectId}>
                <h3 className="mt-6 font-medium  tracking-tight">
                  {getProjectName(projectId)}
                </h3>
                {samlForProject.length > 0 && renderSamlList(samlForProject)}
                {oidcForProject.length > 0 && renderOidcList(oidcForProject)}
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
          {t("sso.title")}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
          {t("sso.subtitle")}
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
              <div className="actions text-center mt-4 hover:underline fw-semibold">
                <div>
                  <Link to={new Route("/accounts/login")}>
                    <div className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm">
                      {t("sso.useUsernameInstead")}
                    </div>
                  </Link>
                </div>
              </div>
            }
          />
        </div>
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
      </div>
    </div>
  );
};

export default LoginPage;
