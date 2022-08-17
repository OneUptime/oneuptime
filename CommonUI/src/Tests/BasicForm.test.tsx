import * as React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
// import userEvent from '@testing-library/user-event';
import BasicForm, { ComponentProps } from '../Components/Forms/BasicForm';
import FormFieldSchemaType from '../Components/Forms/Types/FormFieldSchemaType';
import Route from 'Common/Types/API/Route';
import FormValues from '../Components/Forms/Types/FormValues';
import { act } from 'react-test-renderer';
describe('BasicForm test', () => {
    const basicFormProps: ComponentProps<FormValues<any>> = {
        id: 'sample-id',
        initialValues: { email: 'sam@gmail.com', password: 'password' },
        onSubmit: () => {
            return 'Submited';
        },

        fields: [
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
        ],
        submitButtonText: 'Login',
        footer: <div>Footer</div>,
        error: 'Error',
    };

    test('Should render correctly and has type of "email" and "password" fields', () => {
        render(<BasicForm {...basicFormProps} />);
        const inputEmail: HTMLElement = screen.getByTestId('email');
        const inputPassword: HTMLElement = screen.getByTestId('password');
        expect(inputEmail).toBeInTheDocument;
        expect(inputPassword).toBeInTheDocument;
    });

    test('Should accept values and submit if valid', async () => {
        const { getByTestId, container } = render(
            <BasicForm {...basicFormProps} />
        );
        fireEvent.input(getByTestId('email'), {
            target: {
                value: 'humed@gmail.com',
            },
        });
        fireEvent.input(getByTestId('password'), {
            target: {
                value: '12345678',
            },
        });
        const loginButton: HTMLButtonElement = screen.getByTestId('Login');
        await act(() => {
            fireEvent.click(loginButton);
        });
        const errorComponent: HTMLCollectionOf<Element> =
            container.getElementsByClassName('mt-1 text-danger');

        expect(errorComponent).toHaveLength(0);
    });

    test('Should display error if values are invalid', async () => {
        jest.useFakeTimers();
        const { getByTestId } = render(<BasicForm {...basicFormProps} />);
        await act(() => {
            fireEvent.input(getByTestId('email'), {
                target: {
                    value: 'humed',
                },
            });
        });
        await act(() => {
            fireEvent.input(getByTestId('password'), {
                target: {
                    value: '1234',
                },
            });
        });
        const loginButton: HTMLButtonElement = screen.getByTestId('Login');
        await act(() => {
            fireEvent.click(loginButton);
        });
        await act(() => {
            jest.advanceTimersByTime(1000 * 10);
        });
        const errorComponent: HTMLElement[] =
            screen.getAllByTestId('errorMessage');

        expect(errorComponent[0]?.innerHTML).toEqual('Email is not valid.');
        expect(errorComponent[1]?.innerHTML).toEqual(
            'Password cannot be less than 6 characters.'
        );
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });
});
