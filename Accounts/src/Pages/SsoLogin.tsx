import React, { FunctionComponent } from 'react';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Model/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimeSVG/3-transparent.svg';
import Link from 'CommonUI/src/Components/Link/Link';

const SsoLoginPage: FunctionComponent = () => {
    const user: User = new User();

    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <img className="mx-auto h-12 w-auto" src={OneUptimeLogo} alt="Your Company" />
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">Sign in to your account</h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Join thousands of business that use OneUptime
                    to help them stay online all the time.
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">

                    <BasicModelForm<User>
                        model={user}
                        id="login-form"
                        name="SSO Login"
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
                        onSubmit={(
                            _values: FormValues<User>
                        ) => { }}
                        submitButtonText={'Login with SSO'}
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
                                        className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                                    >
                                        Log in with password
                                        instead
                                    </Link>
                                </p>
                            </div>
                        }
                    />

                   
                </div>
                <div className="mt-10 text-center">
                        <p className="text-muted mb-0 text-gray-500" >
                            Don&apos;t have an account?{' '}
                            <Link
                                to={
                                    new Route(
                                        '/accounts/register'
                                    )
                                }
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

export default SsoLoginPage;
