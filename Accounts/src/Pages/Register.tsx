import React, { FunctionComponent } from 'react';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import User from 'Common/Models/User';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';
import LoginUtil from '../Utils/Login';
import { JSONObject } from 'Common/Types/JSON';

import URL from 'Common/Types/API/URL';
import { SIGNUP_API_URL } from '../Utils/ApiPaths';

const RegisterPage: FunctionComponent = () => {
    const user: User = new User();
    const apiUrl: URL = SIGNUP_API_URL;

    return (
        <div className="auth-page">
            <div className="container-fluid p-0">
                <div className="row g-0">
                    <div className="col-xxl-3 col-lg-3 col-md-2"></div>

                    <div className="col-xxl-6 col-lg-6 col-md-8">
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
                                                Create your OneUptime account.
                                            </h5>
                                            <p className="text-muted mt-2 mb-0">
                                                Join thousands of business that
                                                use OneUptime{' '}
                                            </p>
                                            <p className="text-muted mb-2">
                                                to help them stay online all the
                                                time. No credit card required.
                                            </p>
                                        </div>

                                        <ModelForm<User>
                                            model={user}
                                            id="register-form"
                                            showAsColumns={2}
                                            maxPrimaryButtonWidth={true}
                                            initialValues={{
                                                email: '',
                                                name: '',
                                                companyName: '',
                                                companyPhoneNumber: '',
                                                password: '',
                                                confirmPassword: '',
                                            }}
                                            fields={[
                                                {
                                                    field: {
                                                        email: true,
                                                    },
                                                    fieldType:
                                                        FormFieldSchemaType.Email,
                                                    placeholder:
                                                        'jeff@example.com',
                                                    required: true,
                                                    title: 'Email',
                                                },
                                                {
                                                    field: {
                                                        name: true,
                                                    },
                                                    fieldType:
                                                        FormFieldSchemaType.Text,
                                                    placeholder: 'Jeff Smith',
                                                    required: true,
                                                    title: 'Full Name',
                                                },
                                                {
                                                    field: {
                                                        companyName: true,
                                                    },
                                                    fieldType:
                                                        FormFieldSchemaType.Text,
                                                    placeholder: 'Acme, Inc.',
                                                    required: true,
                                                    title: 'Company Name',
                                                },
                                                {
                                                    field: {
                                                        companyPhoneNumber:
                                                            true,
                                                    },
                                                    fieldType:
                                                        FormFieldSchemaType.Text,
                                                    required: true,
                                                    placeholder:
                                                        '+1-123-456-7890',
                                                    title: 'Phone Number',
                                                },
                                                {
                                                    field: {
                                                        password: true,
                                                    },
                                                    fieldType:
                                                        FormFieldSchemaType.Password,
                                                    validation: {
                                                        minLength: 6,
                                                    },
                                                    placeholder: 'Password',
                                                    title: 'Password',
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
                                            submitButtonText={'Sign Up'}
                                            onSuccess={(value: JSONObject) => {
                                                LoginUtil.login(value);
                                            }}
                                        />

                                        <div className="mt-5 text-center">
                                            <p className="text-muted mb-0">
                                                Already have an account?{' '}
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
