import React, { FunctionComponent, useState } from 'react';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import UserUtil from '../../Utils/User';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import { FILE_URL } from 'CommonUI/src/Config';
import URL from 'Common/Types/API/URL';
import { RESET_PASSWORD_API_URL } from '../../Utils/ApiPaths';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    statusPageId: ObjectID | null;
    isPreviewPage: boolean;
    statusPageName: string;
    logoFileId: ObjectID;
    isPrivatePage: boolean;
}

const ResetPassword: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    const apiUrl: URL = RESET_PASSWORD_API_URL;
    const [isSuccess, setIsSuccess] = useState<boolean>(false);

    if (!props.statusPageId) {
        return <></>;
    }

    if (UserUtil.isLoggedIn(props.statusPageId)) {
        Navigation.navigate(
            new Route(
                props.isPreviewPage ? `/status-page/${props.statusPageId}` : '/'
            )
        );
    }

    if (!props.isPrivatePage) {
        Navigation.navigate(
            new Route(
                props.isPreviewPage ? `/status-page/${props.statusPageId}` : '/'
            )
        );
    }

    return (
        <div className="auth-page">
            <div className="container-fluid p-0">
                <div className="row g-0">
                    <div className="col-xxl-3 col-lg-3 col-md-2"></div>

                    <div className="col-xxl-6 col-lg-6 col-md-8">
                        <div className="auth-full-page-content d-flex p-sm-5 p-4">
                            <div className="w-100">
                                <div className="d-flex flex-column h-100">
                                    <div className="auth-content my-auto">
                                        <div
                                            className="mt-4 text-center"
                                            style={{ marginBottom: '40px' }}
                                        >
                                            <img
                                                 style={{ height: '70px' }}
                                                src={`${URL.fromString(
                                                    FILE_URL.toString()
                                                ).addRoute(
                                                    '/image/' +
                                                        props.logoFileId.toString()
                                                )}`}
                                            />
                                        </div>
                                        <div className="text-center">
                                            <h5 className="mb-0">
                                                Create a new password for your
                                                account.
                                            </h5>
                                            {!isSuccess && (
                                                <p className="text-muted mt-2 mb-0">
                                                    Please enter your new
                                                    password and we will have it
                                                    updated.{' '}
                                                </p>
                                            )}

                                            {isSuccess && (
                                                <p className="text-muted mt-2 mb-0">
                                                    Your password has been
                                                    updated. Please log in.
                                                </p>
                                            )}
                                        </div>

                                        {!isSuccess && (
                                            <ModelForm<StatusPagePrivateUser>
                                                modelType={
                                                    StatusPagePrivateUser
                                                }
                                                id="register-form"
                                                onBeforeCreate={(
                                                    item: StatusPagePrivateUser
                                                ) => {
                                                    item.resetPasswordToken =
                                                        Navigation.getLastParam()
                                                            ?.toString()
                                                            .replace('/', '')
                                                            .toString() || '';
                                                    return item;
                                                }}
                                                showAsColumns={1}
                                                maxPrimaryButtonWidth={true}
                                                initialValues={{
                                                    password: '',
                                                    confirmPassword: '',
                                                }}
                                                fields={[
                                                    {
                                                        field: {
                                                            password: true,
                                                        },
                                                        fieldType:
                                                            FormFieldSchemaType.Password,
                                                        validation: {
                                                            minLength: 6,
                                                        },
                                                        placeholder:
                                                            'New Password',
                                                        title: 'New Password',
                                                        required: true,
                                                    },
                                                    {
                                                        field: {
                                                            password: true,
                                                        },
                                                        validation: {
                                                            minLength: 6,
                                                            toMatchField:
                                                                'password',
                                                        },
                                                        fieldType:
                                                            FormFieldSchemaType.Password,
                                                        placeholder:
                                                            'Confirm Password',
                                                        title: 'Confirm Password',
                                                        overideFieldKey:
                                                            'confirmPassword',
                                                        required: true,
                                                    },
                                                ]}
                                                apiUrl={apiUrl}
                                                formType={FormType.Create}
                                                submitButtonText={
                                                    'Reset Password'
                                                }
                                                onSuccess={() => {
                                                    setIsSuccess(true);
                                                }}
                                            />
                                        )}

                                        <div className="mt-5 text-center">
                                            <p className="text-muted mb-0">
                                                Know your password?{' '}
                                                <Link
                                                    to={
                                                        new Route(
                                                            props.isPreviewPage
                                                                ? `/status-page/${props.statusPageId}/login`
                                                                : '/login'
                                                        )
                                                    }
                                                    className="underline-on-hover text-primary fw-semibold"
                                                >
                                                    Log in.
                                                </Link>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="col-xxl-3 col-lg-3 col-md-2"></div>
                </div>
            </div>
        </div>
    );
};

export default ResetPassword;
