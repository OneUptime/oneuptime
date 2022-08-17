import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import renderer, {
    act,
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Toast, { ToastType } from '../Components/Toast/Toast';
import OneUptimeDate from 'Common/Types/Date';

describe('Test for Toast.tsx', () => {
    const type_val = ToastType.SUCCESS;
    const date = new Date();
    const now_date = OneUptimeDate.fromNow(date);
    const testRenderer: ReactTestRenderer = renderer.create(
        <Toast
            type={type_val}
            title="Spread"
            description="Love"
            createdAt={date}
        />
    );
    const testInstance: ReactTestInstance = testRenderer.root;
    test('should render the component', () => {
        expect(testInstance.findAllByType('div')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('toast'),
                }),
            })
        );
    });

    test('Checking Title', () => {
        expect(testInstance.findByType('strong').props.children).toEqual(
            'Spread'
        );
    });

    test('Checking Description', () => {
        expect(
            testInstance.findByProps({ className: 'toast-body' }).props.children
        ).toEqual('Love');
    });
    test('Checking Date', () => {
        expect(testInstance.findByType('small').props.children).toEqual(
            now_date
        );
    });

    test('Checking if the proper className is used', () => {
        expect(
            testInstance
                .findByProps({ id: 'status' })
                .props.className.includes('text-success')
        ).toBe(true);
    });

    test('simulates button click and sets the state to flase, closing the toast', () => {
        expect(testInstance.findAllByType('button').length).toEqual(1);
        const button = testInstance.findByProps({ className: 'btn-close' });
        act(button.props.onClick);
        expect(testInstance.findAllByType('div')).toStrictEqual([]);
    });
});
