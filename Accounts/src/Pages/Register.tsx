import React, { FunctionComponent } from 'react';
import { Link } from 'react-router-dom';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Footer from '../Footer';
import Container from '../Container';

const RegisterPage: FunctionComponent = () => {
    const user: User = new User();

    return (
        <Container title="Register">
            <BasicModelForm<User>
                model={user}
                id="login-form"
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
                onSubmit={(values: FormValues<User>) => {
                    console.log(values);
                }}
                submitButtonText={'Sign Up'}
                title={'Create your OneUptime account'}
                footer={
                    <div className="actions">
                        <p>
                            <span>Have an account? </span>
                            <Link to="/login">Login</Link>
                        </p>
                    </div>
                }
            />
            <Footer />
        </Container>
    );
};

export default RegisterPage;
