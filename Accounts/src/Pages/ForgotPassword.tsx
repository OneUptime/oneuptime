import React, { FunctionComponent } from 'react';
import { Link } from 'react-router-dom';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Footer from '../Footer';

const ForgotPasswordPage: FunctionComponent = () => {
    const user: User = new User();

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
                        required: true,
                    },
                ]}
                onSubmit={(values: FormValues<User>) => {
                    console.log(values);
                }}
                submitButtonText={'Continue'}
                title={'Reset your password'}
                description={`Enter the email address associated with your account, and we'll send you a link to reset your password.`}
            >
                <div className="actions">
                    <p>
                        <Link to="/login">Return to sign in</Link>
                    </p>
                    <p>
                        <span>Don&apos;t have an account? </span>
                        <Link to="/register">Sign up</Link>
                    </p>
                </div>
            </BasicModelForm>
            <Footer />
        </>
    );
};

export default ForgotPasswordPage;
