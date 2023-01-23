import React, { FunctionComponent } from 'react';
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

export interface ComponentProps {
    statusPageId: ObjectID | null;
    isPreviewPage: boolean;
    statusPageName: string;
    logoFileId: ObjectID;
    isPrivatePage: boolean;
}

const LoginPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    const apiUrl: URL = LOGIN_API_URL;

    if (!props.statusPageId) {
        return <></>;
    }

    if (!props.isPrivatePage) {
        Navigation.navigate(
            new Route(
                props.isPreviewPage ? `/status-page/${props.statusPageId}` : '/'
            )
        );
    }

    if (UserUtil.isLoggedIn(props.statusPageId)) {
        Navigation.navigate(
            new Route(
                props.isPreviewPage ? `/status-page/${props.statusPageId}` : '/'
            )
        );
    }

    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                {props.logoFileId && props.logoFileId.toString() ? (
                    <img
                        style={{ height: '70px' }}
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
                                        props.isPreviewPage
                                            ? `/status-page/${props.statusPageId}/forgot-password`
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
                            Navigation.navigate(
                                new Route(
                                    props.isPreviewPage
                                        ? `/status-page/${props.statusPageId}/`
                                        : '/'
                                )
                            );
                        }}
                        maxPrimaryButtonWidth={true}
                    />
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
