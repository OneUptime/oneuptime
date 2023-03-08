import React, { FunctionComponent, useState } from 'react';
import User from 'Model/Models/User';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimeSVG/3-transparent.svg';
import Link from 'CommonUI/src/Components/Link/Link';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import { LOGIN_API_URL } from '../Utils/ApiPaths';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import LoginUtil from '../Utils/Login';
import UserUtil from 'CommonUI/src/Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { DASHBOARD_URL } from 'CommonUI/src/Config';

const LoginPage: FunctionComponent = () => {
    const apiUrl: URL = LOGIN_API_URL;

    if (UserUtil.isLoggedIn()) {
        Navigation.navigate(DASHBOARD_URL);
    }

    const [showSsoTip, setShowSSOTip] = useState<boolean>(false);

    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <img
                    className="mx-auto h-12 w-auto"
                    src={OneUptimeLogo}
                    alt="Your Company"
                />
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                    Sign in to your account
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Join thousands of business that use OneUptime to help them
                    stay online all the time.
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <ModelForm<User>
                        modelType={User}
                        id="login-form"
                        name="Login"
                        fields={[
                            {
                                field: {
                                    email: true,
                                },
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
                                validation: {
                                    minLength: 6,
                                },
                                fieldType: FormFieldSchemaType.Password,
                                sideLink: {
                                    text: 'Forgot password?',
                                    url: new Route('/accounts/forgot-password'),
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
                                    {!showSsoTip && <div
                                        onClick={()=>{
                                            setShowSSOTip(true);
                                        }}
                                        className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                                    >
                                        Use single sign-on (SSO) instead
                                    </div>}

                                    {showSsoTip && <div
                                        className="text-gray-500 text-sm"
                                    >
                                        Please sign in with your username and password. Once you have signed in, you'll be able to sign in via SSO that's configured for your project.
                                    </div>}

                                </p>
                            </div>
                        }
                    />
                </div>
                <div className="mt-10 text-center">
                    <p className="text-muted mb-0 text-gray-500">
                        Don&apos;t have an account?{' '}
                        <Link
                            to={new Route('/accounts/register')}
                            className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                        >
                            Register.
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
