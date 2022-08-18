import * as React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BasicForm from '../Components/Forms/BasicForm';
import FormFieldSchemaType from '../Components/Forms/Types/FormFieldSchemaType';
import Route from 'Common/Types/API/Route';
import FormValues from '../Components/Forms/Types/FormValues';
import { act } from 'react-test-renderer';
import Fields from '../Components/Forms/Types/Fields';
import { UserEvent } from '@testing-library/user-event/dist/types/setup/setup';
import '@testing-library/jest-dom/extend-expect';
describe('BasicForm test', () => {
    const fields: Fields<FormValues<any>> = [
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
    ];

    test('Should render correctly and has type of "email" and "password" fields', async () => {
        const handleSubmit: Function = jest.fn();
        render(
            <BasicForm
                fields={fields}
                id="sample-id"
                onSubmit={handleSubmit}
                submitButtonText="Login"
                footer={<div data-testid="footer">Footer</div>}
            />
        );

        const inputEmail: HTMLElement = screen.getByTestId('email');
        const inputPassword: HTMLElement = screen.getByTestId('password');
        const footer: HTMLElement = screen.getByTestId('footer');
        const forgotPasswordText: HTMLElement = screen.getByTestId(
            'login-forgot-password'
        );
        expect(inputEmail).toBeInTheDocument;
        expect(inputPassword).toBeInTheDocument;
        expect(footer).toHaveTextContent('Footer');
        expect(forgotPasswordText).toHaveTextContent('Forgot password?');
    });

    test('Should accept values and submit if valid', async () => {
        const handleSubmit: Function = jest.fn();
        render(
            <BasicForm
                fields={fields}
                id="sample-id"
                initialValues={{
                    email: '',
                    password: '',
                }}
                onSubmit={handleSubmit}
                submitButtonText="Login"
            />
        );
        const user: UserEvent = userEvent.setup();
        await user.type(screen.getByTestId('email'), 'humed@gmail.com');
        await user.type(screen.getByTestId('password'), '12345678');

        const loginButton: HTMLButtonElement = screen.getByTestId('Login');
        await act(() => {
            fireEvent.click(loginButton);
        });

        await waitFor(() => {
            expect(handleSubmit).toHaveBeenCalledWith({
                email: 'humed@gmail.com',
                password: {
                    _value: '12345678',
                    isHashed: false,
                },
            });
        });
    });

    test('Should display error if values are invalid', async () => {
        const handleSubmit: Function = jest.fn();
        render(
            <BasicForm
                fields={fields}
                id="sample-id"
                initialValues={{
                    email: '',
                    password: '',
                }}
                onSubmit={handleSubmit}
                submitButtonText="Login"
            />
        );
        const user: UserEvent = userEvent.setup();
        await user.type(screen.getByTestId('email'), 'humed');
        await user.type(screen.getByTestId('password'), '1238');

        const loginButton: HTMLButtonElement = screen.getByTestId('Login');
        await user.click(loginButton);

        const errorComponent: HTMLElement[] =
            screen.getAllByTestId('errorMessage');

        expect(errorComponent[0]?.innerHTML).toEqual('Email is not valid.');
        expect(errorComponent[1]?.innerHTML).toEqual(
            'Password cannot be less than 6 characters.'
        );
    });
});
