import React, { FunctionComponent } from 'react';
import { Link } from 'react-router-dom';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';

const LoginPage: FunctionComponent = () => {
    const user: User = new User();

    return (
        <>
            <div className="brand">
                <img
                    alt="OneUpTime"
                    src="/assets/img/logos/OneUptimeSVG/3.svg"
                />
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
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Password',
                    },
                ]}
                onSubmit={(values: FormValues<User>) => {
                    console.log(values);
                }}
                submitButtonText={'Login'}
                title={'Sign in to your account'}
            />
            <div className="signup_panel">
                Don&apos;t have an account?{' '}
                <span>
                    <Link to="/register">Sign up</Link>
                </span>
            </div>
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
