import { SERVICE_PROVIDER_LOGIN_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import Link from "CommonUI/src/Components/Link/Link";
import { DASHBOARD_URL, IDENTITY_URL } from "CommonUI/src/Config";
import OneUptimeLogo from "CommonUI/src/Images/logos/OneUptimeSVG/3-transparent.svg";
import Navigation from "CommonUI/src/Utils/Navigation";
import UserUtil from "CommonUI/src/Utils/User";
import User from "Model/Models/User";
import React, { useState } from "react";
import ProjectSSO from "Model/Models/ProjectSSO";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import API from "CommonUI/src/Utils/API/API";
import BasicForm from "CommonUI/src/Components/Forms/BasicForm";
import Email from "Common/Types/Email";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import StaticModelList from "CommonUI/src/Components/ModelList/StaticModelList";

const LoginPage: () => JSX.Element = () => {
    const apiUrl: URL = SERVICE_PROVIDER_LOGIN_URL;

    if (UserUtil.isLoggedIn()) {
        Navigation.navigate(DASHBOARD_URL);
    }

    const [error, setError] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [projectSsoConfigList, setProjectSsoConfigList] = useState<Array<ProjectSSO>>([]);

    const fetchSsoConfigs = async (email: Email) => {
        if (email) {
            setIsLoading(true);
            try {

                // get sso config by email. 
                const listResult: HTTPErrorResponse | HTTPResponse<JSONArray> = await API.get(URL.fromString(apiUrl.toString()).addQueryParam("email", email.toString()));

                if (listResult instanceof HTTPErrorResponse) {
                    throw listResult;
                }

                if (!listResult.data || (listResult.data as JSONArray).length === 0) {
                    return setError("No SSO configuration found for the email: " + email.toString());
                }

                setProjectSsoConfigList(ProjectSSO.fromJSONArray(listResult['data'], ProjectSSO));

            } catch (error) {
                setError(API.getFriendlyErrorMessage(error as Error));
            }

            setIsLoading(false);


        } else {
            setError("Email is required to perform this action");
        }
    };

    const getSsoConfigModelList = (configs: Array<ProjectSSO>) => {
        return (<StaticModelList<ProjectSSO>
            list={configs}
            titleField="name"
            selectedItems={[]}
            descriptionField="description"
            onClick={(item: ProjectSSO) => {
                setIsLoading(true);
                Navigation.navigate(
                    URL.fromURL(IDENTITY_URL).addRoute(
                        new Route(
                            `/sso/${item.projectId?.toString()}/${item.id?.toString()
                            }`,
                        ),
                    ),
                );
            }}
        />);
    }


    if (error) {
        return <ErrorMessage error={error} />;
    }

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    const getProjectName = (projectId: string): string => {
        const projectNames =  projectSsoConfigList.filter((config: ProjectSSO) => config.projectId?.toString() === projectId.toString()).map((config: ProjectSSO) => config.project?.name);
        return projectNames[0] || 'Project';
    }

    if (projectSsoConfigList.length > 0) {

        const projectIds: Array<string> = projectSsoConfigList.map((config: ProjectSSO) => config.projectId?.toString() as string);

        return (
            <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="">
                    <img
                        className="mx-auto h-12 w-auto"
                        src={OneUptimeLogo}
                        alt="OneUptime"
                    />
                    <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                        Select Project
                    </h2>
                    <p className="mt-2 text-center text-sm text-gray-600">
                        Select the project you want to login to.
                    </p>
                </div>

                {projectIds.map((projectId: string) => {
                    return (
                        <div key={projectId}>
                            <h3 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                                Project: {getProjectName(projectId)}
                            </h3>
                            {getSsoConfigModelList(projectSsoConfigList.filter((config: ProjectSSO) => config.projectId?.toString() === projectId.toString()))}
                        </div>
                    )
                })}
            </div>
        );

    }


    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="">
                <img
                    className="mx-auto h-12 w-auto"
                    src={OneUptimeLogo}
                    alt="OneUptime"
                />
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                    Login with SSO
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Login with your SSO provider to access your account.
                </p>
            </div>



            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <BasicForm
                        modelType={User}
                        id="login-form"
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
                            }
                        ]}
                        maxPrimaryButtonWidth={true}
                        submitButtonText="Login with SSO"
                        onSubmit={async (data: JSONObject) => {
                            await fetchSsoConfigs(data['email'] as Email);
                        }}
                        footer={
                            <div className="actions text-center mt-4 hover:underline fw-semibold">
                                <div>
                                    <Link to={new Route("/accounts/login")}>
                                        <div
                                            className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                                        >
                                            Use username and password insead.
                                        </div>
                                    </Link>
                                </div>
                            </div>
                        }
                    />
                </div>
                <div className="mt-10 text-center">
                    <div className="text-muted mb-0 text-gray-500">
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
