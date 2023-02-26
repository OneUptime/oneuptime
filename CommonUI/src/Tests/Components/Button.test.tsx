import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from '../../Components/Button/Button';
import ButtonType from '../../Components/Button/ButtonTypes';
import ShortcutKey from '../../Components/ShortcutKey/ShortcutKey';
import IconProp from 'Common/Types/Icon/IconProp';

describe('Button', () => {
    test('it should render correctly with title and icon', () => {
        render(
            <Button
                dataTestId="test-id"
                title="sample title"
                disabled={true}
                type={ButtonType.Button}
                icon={IconProp.Add}
            />
        );
        const title: HTMLElement = screen.getByText('sample title');
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(title).toBeInTheDocument();
        expect(testId).toBeInTheDocument();
        expect(testId).toHaveAttribute('type', 'button');
        expect(testId).toHaveAttribute('disabled');
        const icon: HTMLElement = screen.getByRole('icon');
        expect(icon).toBeInTheDocument();
    });

    test('it should have shortcutKey Setting', () => {
        render(
            <Button dataTestId="test-id" shortcutKey={ShortcutKey.Settings} />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveTextContent(ShortcutKey.Settings);
    });

    test('it should have buttonStyle NORMAL', () => {
        render(
            <Button dataTestId="test-id" buttonStyle={ButtonStyleType.NORMAL} />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle DANGER', () => {
        render(
            <Button dataTestId="test-id" buttonStyle={ButtonStyleType.DANGER} />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle DANGER_OUTLINE', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-red-700 bg-white text-base font-medium text-red-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle PRIMARY', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.PRIMARY}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-transparent bg-indigo-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle SECONDRY', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.SECONDRY}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex items-center rounded-md border border-transparent bg-indigo-100 text-sm font-medium text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 px-3 py-2'
        );
    });

    test('it should have buttonStyle OUTLINE', () => {
        render(
            <Button dataTestId="test-id" buttonStyle={ButtonStyleType.NORMAL} />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle SUCCESS', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.SUCCESS}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-transparent bg-green-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle SUCCESS_OUTLINE', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-green-700 bg-white text-base font-medium text-green-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle WARNING', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.WARNING}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-transparent bg-yellow-600 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonStyle WARNING_OUTLINE', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.WARNING_OUTLINE}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            ' inline-flex w-full justify-center rounded-md border border-yellow-700 bg-white text-base font-medium text-yellow-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonSize Normal', () => {
        render(<Button dataTestId="test-id" buttonSize={ButtonSize.Normal} />);
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            ' inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-3 py-2'
        );
    });

    test('it should have buttonSize Small', () => {
        render(<Button dataTestId="test-id" buttonSize={ButtonSize.Small} />);
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-2 py-1'
        );
    });

    test('it should have buttonSize Large', () => {
        render(<Button dataTestId="test-id" buttonSize={ButtonSize.Large} />);
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            ' inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm px-4 py-2'
        );
    });

    test('it should be enabled', () => {
        render(<Button dataTestId="test-id" disabled={false} />);
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).not.toBeDisabled();
    });

    test('it should handle onClick event', () => {
        const handleClick: undefined | (() => void) = jest.fn();
        render(<Button dataTestId="test-id" onClick={handleClick} />);
        const testId: HTMLElement = screen.getByTestId('test-id');
        fireEvent.click(testId);
        expect(handleClick).toBeCalled();
    });
});
