import React, { FunctionComponent, useState } from 'react';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import User from 'Model/Models/User';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';

import URL from 'Common/Types/API/URL';
import { RESET_PASSWORD_API_URL } from '../Utils/ApiPaths';
import Navigation from 'CommonUI/src/Utils/Navigation';

const RegisterPage: FunctionComponent = () => {
    const apiUrl: URL = RESET_PASSWORD_API_URL;
    const [isSuccess, setIsSuccess] = useState<boolean>(false);

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
                                                style={{ height: '50px' }}
                                                src={`${OneUptimeLogo}`}
                                            />
                                        </div>
                                        <div className="text-center">
                                            <h5 className="mb-0">
                                                Reset Password.
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
                                            <ModelForm<User>
                                                modelType={User}
                                                id="register-form"
                                                name="Reset Password"
                                                onBeforeCreate={(
                                                    item: User
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
                                                            '/accounts/login'
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

export default RegisterPage;
