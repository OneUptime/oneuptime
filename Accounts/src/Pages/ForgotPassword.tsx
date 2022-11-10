import React, { FunctionComponent, useState } from 'react';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import User from 'Model/Models/User';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';
import Link from 'CommonUI/src/Components/Link/Link';
import { FORGOT_PASSWORD_API_URL } from '../Utils/ApiPaths';
import URL from 'Common/Types/API/URL';

const ForgotPassword: FunctionComponent = () => {

    const apiUrl: URL = FORGOT_PASSWORD_API_URL;

    const [isSuccess, setIsSuccess] = useState<boolean>(false);

    return (
        <div className="auth-page">
            <div className="container-fluid p-0">
                <div className="row g-0">
                    <div className="col-xxl-4 col-lg-4 col-md-3"></div>

                    <div className="col-xxl-4 col-lg-4 col-md-6">
                        <div className="auth-full-page-content d-flex p-sm-5 p-4">
                            <div className="w-100">
                                <div className="d-flex flex-column h-100">
                                    <div className="auth-content my-auto">
                                        <div
                                            className="mt-4 text-center"
                                            style={{ marginBottom: '40px' }}
                                        >
                                            <img
                                                style={{ height: '40px' }}
                                                src={`/accounts/public/${OneUptimeLogo}`}
                                            />
                                        </div>
                                        <div className="text-center">
                                            <h5 className="mb-0">
                                                Forgot Password
                                            </h5>
                                            {!isSuccess && <p className="text-muted mt-2 mb-0">
                                                Please enter your email and the
                                                password reset link will be sent
                                                to you.{' '}
                                            </p>}


                                            {isSuccess && <p className="text-muted mt-2 mb-0">
                                                We have emailed you the password reset link. Please do not forget to check spam.{' '}
                                            </p>}

                                        </div>

                                        {!isSuccess && <ModelForm<User>
                                             modelType={User}
                                            id="login-form"
                                            apiUrl={apiUrl}
                                            fields={[
                                                {
                                                    field: {
                                                        email: true,
                                                    },
                                                    title: 'Email',
                                                    fieldType:
                                                        FormFieldSchemaType.Email,
                                                    required: true,
                                                },
                                            ]}
                                            onSuccess={() => {
                                                setIsSuccess(true);
                                            }}
                                            submitButtonText={
                                                'Send Password Reset Link'
                                            }
                                            formType={FormType.Create}
                                            maxPrimaryButtonWidth={true}
                                            footer={
                                                <div className="actions pointer text-center mt-4 underline-on-hover fw-semibold">
                                                    <p>
                                                        <Link
                                                            to={
                                                                new Route(
                                                                    '/accounts/login'
                                                                )
                                                            }
                                                        >
                                                            Return to Sign in.
                                                        </Link>
                                                    </p>
                                                </div>
                                            }
                                        />}

                                        <div className="mt-5 text-center">
                                            <p className="text-muted mb-0">
                                                Remember your password?{' '}
                                                <Link
                                                    to={
                                                        new Route(
                                                            '/accounts/login'
                                                        )
                                                    }
                                                    className="underline-on-hover text-primary fw-semibold"
                                                >
                                                    Login.
                                                </Link>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="col-xxl-4 col-lg-4 col-md-3"></div>
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
