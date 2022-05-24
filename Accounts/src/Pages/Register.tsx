import React, { FunctionComponent, useState } from 'react';
import { Link } from 'react-router-dom';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Footer from '../Footer';
import Container from 'CommonUI/src/Container';
import IdentityAPI from 'CommonUI/src/Utils/API/IdentityAPI';
import Route from 'Common/Types/API/Route';
import { JSONObject } from 'Common/Types/JSON';
import HTTPResponse from 'Common/Types/API/HTTPResponse';

const RegisterPage: FunctionComponent = () => {

    const [isLaoding, setIsLoading] = useState<boolean>(false);

    const user: User = new User();

    const submitForm = async (values: FormValues<User>) => {
        setIsLoading(true);

        const response: HTTPResponse<JSONObject> = await IdentityAPI.post<JSONObject>(new Route("/signup"), {
            user: values as JSONObject
        });

        // navigate to dashboard. 
        console.log(response);
        setIsLoading(false);
    }


    return (
        <Container title="Register">
            <BasicModelForm<User>
                model={user}
                isLoading={isLaoding}
                id="register-form"
                showAsColumns={2}
                fields={[
                    {
                        field: {
                            email: true,
                        },
                        placeholder: 'jeff@example.com',
                        required: true,
                        title: 'Email',
                    },
                    {
                        field: {
                            name: true,
                        },
                        placeholder: 'Jeff Smith',
                        required: true,
                        title: 'Full Name',
                    },
                    {
                        field: {
                            companyName: true,
                        },
                        placeholder: 'Company Name',
                        required: true,
                        title: 'Company Name',
                    },
                    {
                        field: {
                            companyPhoneNumber: true,
                        },
                        required: true,
                        placeholder: 'Phone Number',
                        title: 'Phone Number',
                    },
                    {
                        field: {
                            password: true,
                        },
                        placeholder: 'Password',
                        title: 'Password',
                        required: true,
                    },
                    {
                        field: {
                            password: true,
                        },
                        placeholder: 'Confirm Password',
                        title: 'Confirm Password',
                        required: true,
                    },
                ]}
                onSubmit={submitForm}
                submitButtonText={'Sign Up'}
                title={'Create your OneUptime account'}
                footer={
                    <div className="actions">
                        <p>
                            <span>Have an account? </span>
                            <Link to="/accounts/login">Login</Link>

                        </p>
                    </div>
                }
            />
            <Footer />
        </Container>
    );
};

export default RegisterPage;
