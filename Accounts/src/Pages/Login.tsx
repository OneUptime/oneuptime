import React, { FunctionComponent } from 'react';
import { Link } from 'react-router-dom';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Route from 'Common/Types/API/Route';

const LoginPage: FunctionComponent = () => {
    const user: User = new User();

    user.getPublicCreateableColumns();

    return (
        <>
            <BasicModelForm<User>
                model={user}
                id="login-form"
                fields={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Password',
                        sideLink: {
                            text: 'Forgot password?',
                            url: new Route('/forgot-password'),
                            openLinkInNewTab: true,
                        },
                    },
                ]}
                onSubmit={(values: FormValues<User>) => {
                    console.log(values);
                }}
                submitButtonText={'Login'}
                title={'Sign in to your account'}
            >
                <div className="actions">
                    <p>
                        <Link to="/login/sso">
                            Use single sign-on (SSO) instead
                        </Link>
                    </p>
                    <p>
                        <span>Don&apos;t have an account? </span>
                        <Link to="/register">Sign up</Link>
                    </p>
                </div>
            </BasicModelForm>

            <div className="footer">
                <p>
                    <Link to="/">&copy; OneUptime</Link>
                </p>
                <p>
                    <Link to="/">Contact</Link>
                </p>
                <p>
                    <Link to="/">Privacy &amp; terms</Link>
                </p>
            </div>
        </>
    );
};

export default LoginPage;
