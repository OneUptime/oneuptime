import '@testing-library/jest-dom/extend-expect';
import React, { useEffect, FunctionComponent } from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../../Components/ErrorBoundary';

describe('ErrorBoundary', () => {
    const spy: jest.SpyInstance = jest.spyOn(console, 'error');

    beforeAll(() => {
        spy.mockImplementation(() => {});
    });

    afterAll(() => {
        spy.mockRestore();
    });

    test('should render children when no error is thrown', () => {
        render(
            <ErrorBoundary>
                <div>Child Component</div>
            </ErrorBoundary>
        );

        const child: HTMLElement = screen.getByText('Child Component');

        expect(child).toBeInTheDocument();
    });

    test('should render error message when an error occurs', () => {
        const ErrorThrowingComponent: FunctionComponent = () => {
            useEffect(() => {
                throw new Error('Test Error');
            }, []);

            return <div>Error Throwing Component</div>;
        };

        render(
            <ErrorBoundary>
                <ErrorThrowingComponent />
            </ErrorBoundary>
        );

        const errorText: HTMLElement = screen.getByText(
            'An unexpected error has occurred. Please reload the page to continue'
        );

        expect(errorText).toBeInTheDocument();
    });
});
