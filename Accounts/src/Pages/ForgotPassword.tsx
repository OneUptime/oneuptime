import React, { FunctionComponent } from 'react';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';
import Link from 'CommonUI/src/Components/Link/Link';

const ForgotPassword: FunctionComponent = () => {
    const user: User = new User();

    return (
        <div className="auth-page">
            <div className="container-fluid p-0">
                <div className="row g-0">
                    <div className="col-xxl-4 col-lg-4 col-md-3"></div>

                    <div className="col-xxl-4 col-lg-4 col-md-6">
                        <div className="auth-full-page-content d-flex p-sm-5 p-4">
                            <div className="w-100">
                                <div className="d-flex flex-column h-100">
                                    <div className="mt-4 text-center">
                                        <img
                                            style={{ height: '40px' }}
                                            src={`/accounts/public/${OneUptimeLogo}`}
                                        />
                                    </div>
                                    <div className="auth-content my-auto">
                                        <div className="text-center">
                                            <h5 className="mb-0">
                                                Reset Password
                                            </h5>
                                            <p className="text-muted mt-2 mb-0">
                                                Please enter your email and the
                                                password reset link will be sent
                                                to you.{' '}
                                            </p>
                                        </div>

                                        <BasicModelForm<User>
                                            model={user}
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
                                            ]}
                                            onSubmit={(
                                                _values: FormValues<User>
                                            ) => {}}
                                            submitButtonText={
                                                'Send Password Reset Link'
                                            }
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

export default ForgotPassword;
