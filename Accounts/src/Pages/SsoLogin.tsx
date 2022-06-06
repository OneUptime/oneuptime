import React, { FunctionComponent } from 'react';
import { Link } from 'react-router-dom';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import Footer from '../Footer';
import Container from 'CommonUI/src/Container';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';

const SsoLoginPage: FunctionComponent = () => {
    const user: User = new User();

    return (
        <Container title="SSO Login">
            <BasicModelForm<User>
                model={user}
                id="login-form"
                fields={[
                    {
                        field: {
                            email: true,
                        },
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        title: 'Email',
                    },
                ]}
                onSubmit={(values: FormValues<User>) => {
                    console.log(values);
                }}
                submitButtonText={'Continue with SSO'}
                title={'Sign in to your account'}
                footer={
                    <div className="actions">
                        <p>
                            <Link to="/accounts/login">
                                Use your password instead
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

export default SsoLoginPage;
