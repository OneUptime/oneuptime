import React, { FunctionComponent, useEffect } from 'react';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import { LOGIN_API_URL } from '../../Utils/ApiPaths';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import LoginUtil from '../../Utils/Login';
import UserUtil from '../../Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { FILE_URL } from 'CommonUI/src/Config';
import ObjectID from 'Common/Types/ObjectID';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import Link from 'CommonUI/src/Components/Link/Link';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPageUtil from '../../Utils/StatusPage';

export interface ComponentProps {
    statusPageName: string;
    logoFileId: ObjectID;
    forceSSO: boolean;
    hasEnabledSSOConfig: boolean;
}

const LoginPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    useEffect(() => {
        if (props.forceSSO && StatusPageUtil.getStatusPageId()) {
            if (Navigation.getQueryStringByName('redirectUrl')) {
                // forward redirect url to sso page
                Navigation.navigate(
                    new Route(
                        (!StatusPageUtil.isPreviewPage()
                            ? RouteUtil.populateRouteParams(
                                  RouteMap[PageMap.SSO]!,
                                  StatusPageUtil.getStatusPageId()!
                              )
                            : RouteUtil.populateRouteParams(
                                  RouteMap[PageMap.PREVIEW_SSO]!,
                                  StatusPageUtil.getStatusPageId()!
                              )
                        ).toString() +
                            `?redirectUrl=${Navigation.getQueryStringByName(
                                'redirectUrl'
                            )}`
                    )
                );
            } else {
                Navigation.navigate(
                    !StatusPageUtil.isPreviewPage()
                        ? RouteUtil.populateRouteParams(
                              RouteMap[PageMap.SSO]!,
                              StatusPageUtil.getStatusPageId()!
                          )
                        : RouteUtil.populateRouteParams(
                              RouteMap[PageMap.PREVIEW_SSO]!,
                              StatusPageUtil.getStatusPageId()!
                          )
                );
            }
        }
    }, [props.forceSSO, StatusPageUtil.getStatusPageId()]);

    const apiUrl: URL = LOGIN_API_URL;

    if (!StatusPageUtil.getStatusPageId()) {
        return <></>;
    }

    if (!StatusPageUtil.isPrivateStatusPage()) {
        Navigation.navigate(
            new Route(
                StatusPageUtil.isPreviewPage()
                    ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
                    : '/'
            )
        );
    }

    if (
        StatusPageUtil.getStatusPageId() &&
        UserUtil.isLoggedIn(StatusPageUtil.getStatusPageId()!)
    ) {
        if (Navigation.getQueryStringByName('redirectUrl')) {
            Navigation.navigate(
                new Route(Navigation.getQueryStringByName('redirectUrl')!)
            );
        } else {
            Navigation.navigate(
                new Route(
                    StatusPageUtil.isPreviewPage()
                        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
                        : '/'
                )
            );
        }
    }

    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                {props.logoFileId && props.logoFileId.toString() ? (
                    <img
                        style={{ height: '70px', margin: 'auto' }}
                        src={`${URL.fromString(FILE_URL.toString()).addRoute(
                            '/image/' + props.logoFileId.toString()
                        )}`}
                    />
                ) : (
                    <></>
                )}
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                    Welcome back!
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Please login to view {props.statusPageName || 'Status Page'}
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <ModelForm<StatusPagePrivateUser>
                        modelType={StatusPagePrivateUser}
                        id="login-form"
                        name="Status Page Login"
                        fields={[
                            {
                                field: {
                                    email: true,
                                },
                                forceShow: true,
                                title: 'Email',
                                fieldType: FormFieldSchemaType.Email,
                                required: true,
                            },
                            {
                                field: {
                                    password: true,
                                },
                                title: 'Password',
                                required: true,
                                forceShow: true,
                                validation: {
                                    minLength: 6,
                                },
                                fieldType: FormFieldSchemaType.Password,
                                sideLink: {
                                    text: 'Forgot password?',
                                    url: new Route(
                                        StatusPageUtil.isPreviewPage()
                                            ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/forgot-password`
                                            : '/forgot-password'
                                    ),
                                    openLinkInNewTab: false,
                                },
                            },
                        ]}
                        apiUrl={apiUrl}
                        formType={FormType.Create}
                        submitButtonText={'Login'}
                        onSuccess={(value: JSONObject) => {
                            LoginUtil.login(value);

                            if (
                                Navigation.getQueryStringByName('redirectUrl')
                            ) {
                                Navigation.navigate(
                                    new Route(
                                        Navigation.getQueryStringByName(
                                            'redirectUrl'
                                        )!
                                    )
                                );
                            } else {
                                Navigation.navigate(
                                    new Route(
                                        StatusPageUtil.isPreviewPage()
                                            ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/`
                                            : '/'
                                    )
                                );
                            }
                        }}
                        onBeforeCreate={(item: StatusPagePrivateUser) => {
                            if (!StatusPageUtil.getStatusPageId()) {
                                throw new BadDataException(
                                    'Status Page ID not found'
                                );
                            }

                            item.statusPageId =
                                StatusPageUtil.getStatusPageId()!;
                            return item;
                        }}
                        maxPrimaryButtonWidth={true}
                        footer={
                            <div className="actions pointer text-center mt-4 underline-on-hover fw-semibold">
                                {props.hasEnabledSSOConfig ? (
                                    <p>
                                        <Link
                                            to={
                                                new Route(
                                                    StatusPageUtil.isPreviewPage()
                                                        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/sso`
                                                        : '/sso'
                                                )
                                            }
                                            className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                                        >
                                            Use single sign-on (SSO) instead
                                        </Link>
                                    </p>
                                ) : (
                                    <></>
                                )}
                            </div>
                        }
                    />
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
