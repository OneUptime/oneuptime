import React, { FunctionComponent, useEffect, useState } from 'react';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Link from 'CommonUI/src/Components/Link/Link';
import { FORGOT_PASSWORD_API_URL } from '../../Utils/ApiPaths';
import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import UserUtil from '../../Utils/User';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import { FILE_URL } from 'CommonUI/src/Config';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import StatusPageUtil from '../../Utils/StatusPage';

export interface ComponentProps {
    statusPageName: string;
    logoFileId: ObjectID;
    forceSSO: boolean;
}

const ForgotPassword: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    useEffect(() => {
        if (props.forceSSO) {
            Navigation.navigate(
                !StatusPageUtil.isPreviewPage()
                    ? RouteMap[PageMap.SSO]!
                    : RouteMap[PageMap.PREVIEW_SSO]!
            );
        }
    }, [props.forceSSO]);

    const apiUrl: URL = FORGOT_PASSWORD_API_URL;

    const [isSuccess, setIsSuccess] = useState<boolean>(false);

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
        Navigation.navigate(
            new Route(
                StatusPageUtil.isPreviewPage()
                    ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
                    : '/'
            )
        );
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
                    Forgot Password
                </h2>
                {!isSuccess && (
                    <p className="mt-2 text-center text-sm text-gray-600">
                        If you have forgotten your password for{' '}
                        {props.statusPageName}, please enter your email and the
                        password reset link will be sent to you.{' '}
                    </p>
                )}

                {isSuccess && (
                    <p className="mt-2 text-center text-sm text-gray-600">
                        We have emailed you the password reset link. Please do
                        not forget to check spam.{' '}
                    </p>
                )}
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                {!isSuccess && (
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                        <ModelForm<StatusPagePrivateUser>
                            modelType={StatusPagePrivateUser}
                            id="login-form"
                            name="Status Page > Forgot Password"
                            apiUrl={apiUrl}
                            onBeforeCreate={(
                                item: StatusPagePrivateUser
                            ): Promise<StatusPagePrivateUser> => {
                                item.statusPageId =
                                    StatusPageUtil.getStatusPageId()!;
                                return Promise.resolve(item);
                            }}
                            fields={[
                                {
                                    field: {
                                        email: true,
                                    },
                                    title: 'Email',
                                    forceShow: true,
                                    fieldType: FormFieldSchemaType.Email,
                                    required: true,
                                },
                            ]}
                            onSuccess={() => {
                                setIsSuccess(true);
                            }}
                            submitButtonText={'Send Password Reset Link'}
                            formType={FormType.Create}
                            maxPrimaryButtonWidth={true}
                        />
                    </div>
                )}

                <div className="mt-10 text-center">
                    <p className="text-muted mb-0 text-gray-500">
                        Remember your password?{' '}
                        <Link
                            to={
                                new Route(
                                    StatusPageUtil.isPreviewPage()
                                        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/login`
                                        : '/login'
                                )
                            }
                            className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                        >
                            Login.
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
