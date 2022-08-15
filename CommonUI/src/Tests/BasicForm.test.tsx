import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import BasicForm, { ComponentProps } from '../Components/Forms/BasicForm';
import FormFieldSchemaType from '../Components/Forms/Types/FormFieldSchemaType';
import Route from 'Common/Types/API/Route';
import FormValues from '../Components/Forms/Types/FormValues';
describe('BasicForm test', () => {
    test('Should render correctly and has type of "email" and "password" fields', () => {
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
            footer: <div>Footer</div>,
            error: 'Error',
        };
        const testRenderer: ReactTestRenderer = renderer.create(
            <BasicForm {...basicFormProps} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(testInstance.findAllByType('input')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('form-control'),
                    type: expect.stringContaining('email'),
                }),
            })
        );
        expect(testInstance.findAllByType('input')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('form-control'),
                    type: expect.stringContaining('password'),
                }),
            })
        );
    });
});
