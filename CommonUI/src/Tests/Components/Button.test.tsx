import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from '../../Components/Button/Button';
import ButtonType from '../../Components/Button/ButtonTypes';
import ShortcutKey from '../../Components/ShortcutKey/ShortcutKey';
import { IconProp } from '../../Components/Icon/Icon';

describe('Button', () => {
    test('it should render correctly with title and icon', () => {
        render(
            <Button
                dataTestId="test-id"
                title="sample title"
                disabled={true}
                type={ButtonType.Button}
                showIconOnRight={true}
                icon={IconProp.Add}
            />
        );
        const title: HTMLElement = screen.getByText('sample title');
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(title).toBeInTheDocument();
        expect(testId).toBeInTheDocument();
        expect(testId).toHaveAttribute('type', 'button');
        expect(testId).toHaveAttribute('disabled');
        expect(testId).toHaveClass('btn');
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

        expect(testId).toHaveClass('no-border-on-hover');
    });

    test('it should have buttonStyle DANGER', () => {
        render(
            <Button dataTestId="test-id" buttonStyle={ButtonStyleType.DANGER} />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-danger');
    });

    test('it should have buttonStyle DANGER_OUTLINE', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-outline-danger');
    });

    test('it should have buttonStyle PRIMARY', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.PRIMARY}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-primary');
    });

    test('it should have buttonStyle SECONDRY', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.SECONDRY}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-secondary');
    });

    test('it should have buttonStyle OUTLINE', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.NORMAL}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass(
            'btn-outline-secondary background-very-light-grey-on-hover'
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

        expect(testId).toHaveClass('btn-success');
    });

    test('it should have buttonStyle SUCCESS_OUTLINE', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-outline-success');
    });

    test('it should have buttonStyle WARNING', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.WARNING}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-warning');
    });

    test('it should have buttonStyle WARNING_OUTLINE', () => {
        render(
            <Button
                dataTestId="test-id"
                buttonStyle={ButtonStyleType.WARNING_OUTLINE}
            />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-outline-warning');
    });

    test('it should have buttonSize Normal', () => {
        render(<Button dataTestId="test-id" buttonSize={ButtonSize.Normal} />);
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn');
    });

    test('it should have buttonSize Small', () => {
        render(<Button dataTestId="test-id" buttonSize={ButtonSize.Small} />);
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-sm');
    });

    test('it should have buttonSize Large', () => {
        render(<Button dataTestId="test-id" buttonSize={ButtonSize.Large} />);
        const testId: HTMLElement = screen.getByTestId('test-id');

        expect(testId).toHaveClass('btn-lg');
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
