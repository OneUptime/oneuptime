import * as React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { UserEvent } from '@testing-library/user-event/dist/types/setup/setup';
import userEvent from '@testing-library/user-event';
import Toast, { ToastType } from '../Components/Toast/Toast';
import OneUptimeDate from 'Common/Types/Date';

describe('Test for Toast.tsx', () => {
    test('should render the component', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        expect(screen.getByTestId('toast-main')).toHaveClass(
            'position-fixed top-0 end-0 p-3'
        );
    });

    test('Checking Title', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        expect(screen.getByTestId('toast-strong')).toHaveTextContent('Spread');
    });

    test('Checking Description', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        expect(screen.getByTestId('toast-desc')).toHaveTextContent('Love');
    });
    test('Should say "seconds ago"', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        const now_date: string = OneUptimeDate.fromNow(date);

        expect(screen.getByTestId('toast-time')).toHaveTextContent(now_date);
    });
    test('Checking if Toast is for SUCCESS', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        expect(screen.getByTestId('toast-status')).toHaveClass('text-success');
    });
    test('Checking if Toast is for INFO', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.INFO}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        expect(screen.getByTestId('toast-status')).toHaveClass('text-info');
    });

    test('Checking if Toast is for Warning', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.WARNING}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        expect(screen.getByTestId('toast-status')).toHaveClass('text-warning');
    });

    test('Checking if Toast is for Normal', () => {
        const date: Date = new Date();
        render(
            <Toast
                type={ToastType.NORMAL}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );
        expect(screen.getByTestId('toast-status')).toHaveClass('text-normal');
    });
    test('simulates button click and sets the state to flase, closing the toast', async () => {
        const date: Date = new Date();
        const user: UserEvent = userEvent.setup();

        render(
            <Toast
                type={ToastType.SUCCESS}
                title="Spread"
                description="Love"
                createdAt={date}
            />
        );

        const loginButton: HTMLButtonElement =
            screen.getByTestId('toast-button');
        await user.click(loginButton);

        expect(screen.queryByTestId('toast-main')).toBeFalsy;
    });
});
