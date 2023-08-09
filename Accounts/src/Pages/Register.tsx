import React from 'react';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import User from 'Model/Models/User';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimeSVG/3-transparent.svg';
import LoginUtil from '../Utils/Login';
import { JSONObject } from 'Common/Types/JSON';
import UserUtil from 'CommonUI/src/Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { BILLING_ENABLED, DASHBOARD_URL } from 'CommonUI/src/Config';
import URL from 'Common/Types/API/URL';
import { SIGNUP_API_URL } from '../Utils/ApiPaths';
import Fields from 'CommonUI/src/Components/Forms/Types/Fields';

const RegisterPage: () => React.JSX.Element = () => {
    const apiUrl: URL = SIGNUP_API_URL;

    if (UserUtil.isLoggedIn()) {
        Navigation.navigate(DASHBOARD_URL);
    }

    let formFields: Fields<User> = [
        {
            field: {
                email: true,
            },
            fieldType: FormFieldSchemaType.Email,
            placeholder: 'jeff@example.com',
            required: true,
            title: 'Email',
        },
        {
            field: {
                name: true,
            },
            fieldType: FormFieldSchemaType.Text,
            placeholder: 'Jeff Smith',
            required: true,
            title: 'Full Name',
        },
    ];

    if (BILLING_ENABLED) {
        formFields = formFields.concat([
            {
                field: {
                    companyName: true,
                },
                fieldType: FormFieldSchemaType.Text,
                placeholder: 'Acme, Inc.',
                required: true,
                title: 'Company Name',
            },
            {
                field: {
                    companyPhoneNumber: true,
                },
                fieldType: FormFieldSchemaType.Phone,
                required: true,
                placeholder: '+11234567890',
                title: 'Phone Number',
            },
        ]);
    }

    formFields = formFields.concat([
        {
            field: {
                password: true,
            },
            fieldType: FormFieldSchemaType.Password,
            validation: {
                minLength: 6,
            },
            placeholder: 'Password',
            title: 'Password',
            required: true,
        },
        {
            field: {
                confirmPassword: true,
            } as any,
            validation: {
                minLength: 6,
                toMatchField: 'password',
            },
            fieldType: FormFieldSchemaType.Password,
            placeholder: 'Confirm Password',
            title: 'Confirm Password',
            overrideFieldKey: 'confirmPassword',
            required: true,
            forceShow: true,
        },
    ]);

    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <img
                    className="mx-auto h-12 w-auto"
                    src={OneUptimeLogo}
                    alt="Your Company"
                />
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                    Create your OneUptime account
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Join thousands of business that use OneUptime to help them
                    stay online all the time.
                </p>
                <p className="mt-2 text-center text-sm text-gray-600">
                    No credit card required.
                </p>
            </div>

            <div className="mt-8 lg:mx-auto lg:w-full lg:max-w-2xl">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <ModelForm<User>
                        modelType={User}
                        id="register-form"
                        showAsColumns={2}
                        name="Register"
                        maxPrimaryButtonWidth={true}
                        initialValues={{
                            email: '',
                            name: '',
                            companyName: '',
                            companyPhoneNumber: '',
                            password: '',
                            confirmPassword: '',
                        }}
                        fields={formFields}
                        apiUrl={apiUrl}
                        formType={FormType.Create}
                        submitButtonText={'Sign Up'}
                        onSuccess={(value: JSONObject) => {
                            LoginUtil.login(value);
                        }}
                    />
                </div>
                <div className="mt-5 text-center text-gray-500">
                    <p className="text-muted mb-0">
                        Already have an account?{' '}
                        <Link
                            to={new Route('/accounts/login')}
                            className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                        >
                            Log in.
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default RegisterPage;
