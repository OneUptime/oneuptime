import React, { FunctionComponent, useState } from 'react';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
// import Footer from '../Footer';
// import Container from 'CommonUI/src/Container';
import IdentityAPI from 'CommonUI/src/Utils/API/IdentityAPI';
import Link from "CommonUI/src/Components/Link/Link";
import Route from 'Common/Types/API/Route';
import { JSONObject } from 'Common/Types/JSON';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import OneUptimeLogo from "CommonUI/src/Images/logos/OneUptimePNG/7.png";

const RegisterPage: FunctionComponent = () => {
    const [isLaoding, setIsLoading] = useState<boolean>(false);

    const user: User = new User();

    const submitForm: Function = async (values: FormValues<User>) => {
        setIsLoading(true);

        await IdentityAPI.post<JSONObject>(new Route('/signup'), {
            user: values as JSONObject,
        });

        setIsLoading(false);
    };

    return (
        <div className="auth-page">
            <div className="container-fluid p-0">
                <div className="row g-0">
                    <div className="col-xxl-3 col-lg-3 col-md-2"></div>

                    <div className="col-xxl-6 col-lg-6 col-md-8">
                        <div className="auth-full-page-content d-flex p-sm-5 p-4">
                            <div className="w-100">
                                <div className="d-flex flex-column h-100">
                                    <div className="mb-4 mb-md-5 text-center">
                                        <img src={`public/${OneUptimeLogo}`} />
                                    </div>
                                    <div className="auth-content my-auto">
                                        <div className="text-center">
                                            <h5 className="mb-0">Welcome to OneUptime!</h5>
                                            <p className="text-muted mt-2">Sign up to continue.</p>
                                        </div>

                                        <BasicModelForm<User>
                                            model={user}
                                            isLoading={isLaoding}
                                            id="register-form"
                                            showAsColumns={2}
                                            maxPrimaryButtonWidth={true}
                                            fields={[
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
                                                {
                                                    field: {
                                                        companyName: true,
                                                    },
                                                    fieldType: FormFieldSchemaType.Text,
                                                    placeholder: 'Company Name',
                                                    required: true,
                                                    title: 'Company Name',
                                                },
                                                {
                                                    field: {
                                                        companyPhoneNumber: true,
                                                    },
                                                    fieldType: FormFieldSchemaType.Text,
                                                    required: true,
                                                    placeholder: 'Phone Number',
                                                    title: 'Phone Number',
                                                },
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
                                                        password: true,
                                                    },
                                                    validation: {
                                                        minLength: 6,
                                                        toMatchField: 'password',
                                                    },
                                                    fieldType: FormFieldSchemaType.Password,
                                                    placeholder: 'Confirm Password',
                                                    title: 'Confirm Password',
                                                    overideFieldKey: 'confirmPassword',
                                                    required: true,
                                                },
                                            ]}
                                            onSubmit={submitForm}
                                            submitButtonText={'Sign Up'}
                                        />

                                        <div className="mt-5 text-center">
                                            <p className="text-muted mb-0">Have an account? <Link to={new Route('/accounts/login')} className="text-primary fw-semibold" > Log in </Link></p>
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
    )

    // return (
    //     <Container title="Register">

    //         <Footer />
    //     </Container>
    // );
};

export default RegisterPage;
