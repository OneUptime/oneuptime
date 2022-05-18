import React, { FunctionComponent } from 'react';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';


const LoginPage: FunctionComponent = () => {

    const user: User = new User();

    user.getPublicCreateableColumns();

    return (
        <BasicModelForm<User>
            model={user}
            id="login-form"
            fields={[
                {
                    field: {
                        email: true
                    }
                },
                {
                    field: {
                        password: true
                    }
                }
            ]}

            onSubmit={(values: FormValues<User>) => {
                console.log(values);
            }}
            submitButtonText={"Login"}
            title={"Sign in to your account"}
        /> 
    )
};

export default LoginPage;
