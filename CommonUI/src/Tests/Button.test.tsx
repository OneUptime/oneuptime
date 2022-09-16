import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Button from '../Components/Button/Button';

describe('Button test', () => {
    const handleClick: undefined | (() => void) = jest.fn();
    render(
        <Button
            dataTestId="test-id"
            title="sample title"
            disabled={true}
            onClick={handleClick}
        />
    );
    const title: HTMLElement = screen.getByText('sample title');
    const testId: HTMLElement = screen.getByTestId('test-id');

    test('it should render correctly with a test id', () => {
        expect(testId).toBeInTheDocument;
    });

    test('it should have a title', () => {
        expect(title).toBeInTheDocument;
    });

    test('it should have disabled attribute', () => {
        expect(testId).toHaveAttribute('disabled');
    });

    test('it should handle onClick event', () => {
        fireEvent.click(testId);
        expect(handleClick).toBeCalled;
    });
});
