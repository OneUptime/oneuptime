import React from 'react';
import BasicModelForm from 'CommonUI/src/Components/Forms/BasicModelForm';
import User from 'Common/Models/User';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';

const LoginPage = () => {

    const user: User = new User();

    
    return (
        <BasicModelForm
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
        /> 
    )
};

export default LoginPage;
