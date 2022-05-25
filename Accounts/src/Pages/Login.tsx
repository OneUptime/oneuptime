import React, { FunctionComponent } from 'react';
import { Link } from 'react-router-dom';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Route from 'Common/Types/API/Route';
import Footer from '../Footer';
import Container from 'CommonUI/src/Container';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';

const LoginPage: FunctionComponent = () => {
    const user: User = new User();

    user.getPublicCreateableColumns();

    return (
        <Container title="Login">
            <BasicModelForm<User>
                model={user}
                id="login-form"
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
                onSubmit={(values: FormValues<User>) => {
                    console.log(values);
                }}
                submitButtonText={'Login'}
                title={'Sign in to your account'}
                footer={
                    <div className="actions">
                        <p>
                            <Link to="/accounts/login/sso">
                                Use single sign-on (SSO) instead
                            </Link>
                        </p>
                        <p>
                            <span>Don&apos;t have an account? </span>
                            <Link to="/accounts/register">Sign up</Link>
                        </p>
                    </div>
                }
            />
            <Footer />
        </Container>
    );
};

export default LoginPage;
