import React, { useState } from 'react';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import User from 'Model/Models/User';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimeSVG/3-transparent.svg';
import Link from 'CommonUI/src/Components/Link/Link';
import { FORGOT_PASSWORD_API_URL } from '../Utils/ApiPaths';
import URL from 'Common/Types/API/URL';

const ForgotPassword: () => React.JSX.Element = () => {
    const apiUrl: URL = FORGOT_PASSWORD_API_URL;

    const [isSuccess, setIsSuccess] = useState<boolean>(false);

    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <img
                    className="mx-auto h-12 w-auto"
                    src={OneUptimeLogo}
                    alt="Your Company"
                />
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                    Forgot your password
                </h2>

                {!isSuccess && (
                    <p className="mt-2 text-center text-sm text-gray-600">
                        Please enter your email and the password reset link will
                        be sent to you.
                    </p>
                )}

                {isSuccess && (
                    <p className="mt-2 text-center text-sm text-gray-600">
                        We have emailed you the password reset link. Please do
                        not forget to check spam.
                    </p>
                )}
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                {!isSuccess && (
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                        <ModelForm<User>
                            modelType={User}
                            name="Forgot Password"
                            id="login-form"
                            apiUrl={apiUrl}
                            fields={[
                                {
                                    field: {
                                        email: true,
                                    },
                                    title: 'Email',
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
                            footer={
                                <div className="actions pointer text-center mt-4 hover:underline fw-semibold">
                                    <p>
                                        <Link
                                            to={new Route('/accounts/login')}
                                            className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                                        >
                                            Return to Sign in.
                                        </Link>
                                    </p>
                                </div>
                            }
                        />
                    </div>
                )}

                <div className="mt-5 text-center">
                    <p className="text-muted mb-0 text-gray-500">
                        Remember your password?{' '}
                        <Link
                            to={new Route('/accounts/login')}
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
