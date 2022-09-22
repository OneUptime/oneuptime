import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Button from '../Components/Button/Button';
import ButtonType from '../Components/Button/ButtonTypes';
import ShortcutKey from '../Components/ShortcutKey/ShortcutKey';
import Icon from '../Components/Icon/Icon';

describe('Button test', () => {
    const handleClick: undefined | (() => void) = jest.fn();
    render(
        <Button
            dataTestId="test-id"
            title="sample title"
            disabled={true}
            onClick={handleClick}
            shortcutKey={ShortcutKey.Settings}
            type={ButtonType.Button}
            showIconOnRight={false}
        />
    );
    const title: HTMLElement = screen.getByText('sample title');
    const testId: HTMLElement = screen.getByTestId('test-id');

    test('it should render correctly with a test id', () => {
        expect(testId).toBeInTheDocument;
    });

    test('it should have type button', () => {
        expect(testId).toHaveAttribute('type', 'button');
    });

    test('it should have key shortcut', () => {
        expect(testId).toHaveTextContent(ShortcutKey.Settings);
    });

    test('it should have a title', () => {
        expect(title).toBeInTheDocument;
    });

    test('it should have disabled attribute', () => {
        expect(testId).toHaveAttribute('disabled');
    });

    test('it should have class btn', () => {
        expect(testId).toHaveClass('btn');
    });

    test('it should have icon', () => {
        expect(Icon).toBeInTheDocument;
    });

    test('it should handle onClick event', () => {
        fireEvent.click(testId);
        expect(handleClick).toBeCalled;
    });
});
