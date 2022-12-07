import React, { FunctionComponent } from 'react';
import User from 'Model/Models/User';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';
import Link from 'CommonUI/src/Components/Link/Link';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import { LOGIN_API_URL } from '../../Utils/ApiPaths';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import LoginUtil from '../../Utils/Login';
import UserUtil from 'CommonUI/src/Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { DASHBOARD_URL } from 'CommonUI/src/Config';

const LoginPage: FunctionComponent = () => {
    const apiUrl: URL = LOGIN_API_URL;

    if (UserUtil.isLoggedIn()) {
        Navigation.navigate(DASHBOARD_URL);
    }

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
                                                Welcome back!
                                            </h5>
                                            <p className="text-muted mt-2 mb-0">
                                                Join thousands of business that
                                                use OneUptime{' '}
                                            </p>
                                            <p className="text-muted mb-2">
                                                to help them stay online all the
                                                time.
                                            </p>
                                        </div>

                                        <ModelForm<User>
                                            modelType={User}
                                            id="login-form"
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
                                                {
                                                    field: {
                                                        password: true,
                                                    },
                                                    title: 'Password',
                                                    required: true,
                                                    validation: {
                                                        minLength: 6,
                                                    },
                                                    fieldType:
                                                        FormFieldSchemaType.Password,
                                                    sideLink: {
                                                        text: 'Forgot password?',
                                                        url: new Route(
                                                            '/accounts/forgot-password'
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
                                            }}
                                            maxPrimaryButtonWidth={true}
                                            footer={
                                                <div className="actions pointer text-center mt-4 underline-on-hover fw-semibold">
                                                    <p>
                                                        <Link
                                                            to={
                                                                new Route(
                                                                    '/accounts/login/sso'
                                                                )
                                                            }
                                                        >
                                                            Use single sign-on
                                                            (SSO) instead
                                                        </Link>
                                                    </p>
                                                </div>
                                            }
                                        />

                                        <div className="mt-5 text-center">
                                            <p className="text-muted mb-0">
                                                Don&apos;t have an account?{' '}
                                                <Link
                                                    to={
                                                        new Route(
                                                            '/accounts/register'
                                                        )
                                                    }
                                                    className="underline-on-hover text-primary fw-semibold"
                                                >
                                                    Register.
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

export default LoginPage;
