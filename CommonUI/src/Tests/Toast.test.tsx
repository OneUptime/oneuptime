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
    test('should render the component', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'toast-status' })
                .props.className.includes('spinner-grow ')
        ).toBe(true);
    });

    test('Checking Title', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance.findByProps({ id: 'toast-strong' }).props.children
        ).toEqual('Spread');
    });

    test('Checking Description', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance.findByProps({ id: 'toast-desc' }).props.children
        ).toEqual('Love');
    });
    test('Should say "seconds ago"', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        const now_date: string = OneUptimeDate.fromNow(date);

        expect(
            testInstance.findByProps({ id: 'toast-time' }).props.children
        ).toEqual(now_date);
    });
    test('Checking if Toast is for SUCCESS', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'toast-status' })
                .props.className.includes('text-success')
        ).toBe(true);
    });
    test('Checking if Toast is for INFO', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.INFO}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'toast-status' })
                .props.className.includes('text-info')
        ).toBe(true);
    });

    test('Checking if Toast is for WARNING', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.WARNING}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'toast-status' })
                .props.className.includes('text-warning')
        ).toBe(true);
    });
    test('Checking if Toast is for NORMAL', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.NORMAL}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'toast-status' })
                .props.className.includes('text-normal')
        ).toBe(true);
    });
    test('simulates button click and sets the state to flase, closing the toast', () => {
        const date: Date = new Date();
        const testRenderer: ReactTestRenderer = renderer.create(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(testInstance.findByProps({ id: 'toast-button' }));
        act(testInstance.findByProps({ id: 'toast-button' }).props.onClick)
            .catch;

        expect(testInstance.findAllByType('div')).toStrictEqual([]);
    });
});
