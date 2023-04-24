import React from 'react';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import Input, { ComponentProps } from '../../Components/Input/Input';
import '@testing-library/jest-dom/extend-expect';

describe('Input', () => {
    afterEach(() => {
        cleanup();
    });

    test('renders input element with no props', () => {
        const { getByRole } = render(<Input />);
        const input: HTMLElement = getByRole('textbox');

        expect(input).toBeInTheDocument();
    });

    test('renders input element with all props set', () => {
        const props: ComponentProps = {
            initialValue: 'initial value',
            onClick: () => {},
            placeholder: 'placeholder',
            className: 'className',
            onChange: () => {},
            value: 'value',
            readOnly: true,
            disabled: true,
            type: 'text',
            onFocus: () => {},
            onBlur: () => {},
            dataTestId: 'testid',
            tabIndex: 0,
            onEnterPress: () => {},
            error: 'error',
            outerDivClassName: 'outerDivClassName',
            autoFocus: true,
        };

        const { getByRole } = render(<Input {...props} />);
        const input: HTMLElement = getByRole('textbox');

        expect(input).toBeInTheDocument();
    });

    test('calls onChange when input value changes', () => {
        const onChange: jest.Mock = jest.fn();
        const newValue: string = 'new value';

        const { getByRole } = render(<Input {...{ onChange }} />);
        const input: HTMLElement = getByRole('textbox');
        fireEvent.change(input, { target: { value: newValue } });

        expect(onChange).toHaveBeenCalledWith(newValue);
    });

    test('changes input value on input', () => {
        const newValue: string = 'new value';

        const { getByRole } = render(<Input />);
        const input: HTMLElement = getByRole('textbox');
        fireEvent.change(input, { target: { value: newValue } });

        expect(screen.getByDisplayValue(newValue)).toBeInTheDocument();
    });

    test('calls onClick when input is clicked', () => {
        const onClick: jest.Mock = jest.fn();

        const { getByRole } = render(<Input {...{ onClick }} />);
        const input: HTMLElement = getByRole('textbox');
        fireEvent.click(input);

        expect(onClick).toHaveBeenCalled();
    });

    test('calls onFocus when input is focused', () => {
        const onFocus: jest.Mock = jest.fn();

        const { getByRole } = render(<Input {...{ onFocus }} />);
        const input: HTMLElement = getByRole('textbox');
        fireEvent.focus(input);

        expect(onFocus).toHaveBeenCalled();
    });

    test('calls onBlur when input loses focus', () => {
        const onBlur: jest.Mock = jest.fn();

        const { getByRole } = render(<Input {...{ onBlur }} />);
        const input: HTMLElement = getByRole('textbox');
        fireEvent.blur(input);

        expect(onBlur).toHaveBeenCalled();
    });

    test('calls onEnterPress when Enter key is pressed', () => {
        const onEnterPress: jest.Mock = jest.fn();

        const { getByRole } = render(<Input {...{ onEnterPress }} />);
        const input: HTMLElement = getByRole('textbox');
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        expect(onEnterPress).toHaveBeenCalled();
    });

    test('sets initialValue', () => {
        const initialValue: string = 'initial value';
        render(<Input {...{ initialValue }} />);

        expect(screen.getByDisplayValue(initialValue)).toBeInTheDocument();
    });

    test('sets value', () => {
        const value: string = 'value';
        render(<Input {...{ value }} />);

        expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    });

    test('value overrides initalValue', () => {
        const value: string = 'value';
        const initialValue: string = 'initial value';

        render(<Input {...{ value, initialValue }} />);

        expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    });

    test('updates input when value changes', () => {
        const value: string = 'value';
        const { rerender } = render(<Input {...{ value }} />);

        const newValue: string = 'new value';
        rerender(<Input {...{ value: newValue }} />);

        expect(screen.getByDisplayValue(newValue)).toBeInTheDocument();
    });

    test('resets input to initalValue when value changes to empty string', () => {
        const value: string = 'value';
        const initialValue: string = 'initial value';

        const { rerender } = render(<Input {...{ value, initialValue }} />);

        const newValue: string = '';
        rerender(<Input {...{ value: newValue, initialValue }} />);

        expect(screen.getByDisplayValue(initialValue)).toBeInTheDocument();
    });

    test('sets placeholder attribute', () => {
        const placeholder: string = 'placeholder';
        render(<Input {...{ placeholder }} />);

        expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument();
    });

    test('sets className', () => {
        const className: string = 'className';
        const { getByRole } = render(<Input {...{ className }} />);
        const input: HTMLElement = getByRole('textbox');

        expect(Array.from(input.classList.values())).toEqual([className]);
    });

    test('sets default className', () => {
        const { getByRole } = render(<Input />);
        const input: HTMLElement = getByRole('textbox');

        expect(input.classList.length).toBeGreaterThan(0);
    });

    test('sets readonly attribute when readOnly is true', () => {
        const { getByRole } = render(<Input readOnly={true} />);
        const input: HTMLElement = getByRole('textbox');

        expect(input).toHaveAttribute('readonly');
    });

    test('sets readonly attribute when disabled is true', () => {
        const { getByRole } = render(<Input disabled={true} />);
        const input: HTMLElement = getByRole('textbox');

        expect(input).toHaveAttribute('readonly');
    });

    test('uses local date time string for datetime-local type', () => {
        const dateTime: string = '2023-04-22';
        const dataTestId: string = 'testid';

        render(
            <Input
                type="datetime-local"
                value={dateTime}
                dataTestId={dataTestId}
            />
        );

        expect(screen.getByTestId<HTMLInputElement>(dataTestId).value).toBe(
            '2023-04-22T00:00'
        );
    });

    test('uses YYYY-MM-DD for date type', () => {
        const date: string = '2023-04-22T00:00:00';
        const dataTestId: string = 'testid';

        render(<Input type="date" value={date} dataTestId={dataTestId} />);

        expect(screen.getByTestId<HTMLInputElement>(dataTestId).value).toBe(
            '2023-04-22'
        );
    });

    test('sets dataTestId', () => {
        const dataTestId: string = 'testid';
        const { getByTestId } = render(<Input {...{ dataTestId }} />);

        expect(getByTestId(dataTestId)).toBeInTheDocument();
    });

    test('sets tabIndex', () => {
        const tabIndex: number = 0;
        const { getByRole } = render(<Input {...{ tabIndex }} />);
        const input: HTMLElement = getByRole('textbox');

        expect(input).toHaveAttribute('tabindex', tabIndex.toString());
    });

    test('displays error message', () => {
        const error: string = 'error';
        const errorTestId: string = 'error-message';

        render(<Input {...{ error }} />);

        expect(screen.getByTestId(errorTestId)).toBeInTheDocument();
        expect(screen.getByText(error)).toBeInTheDocument();
    });

    test('displays error icon', () => {
        const error: string = 'error';

        render(<Input {...{ error }} />);

        expect(screen.getByRole('icon')).toBeInTheDocument();
    });

    test('sets error style if error exists', () => {
        const error: string = 'error';

        const { getByRole } = render(<Input {...{ error }} />);
        const input: HTMLElement = getByRole('textbox');

        const errorInputClass: string = 'border-red-300';
        expect(input).toHaveClass(errorInputClass);
    });

    test('sets outerDivClassName', () => {
        const outerDivClassName: string = 'outerDivClassName';

        const { getByRole } = render(<Input {...{ outerDivClassName }} />);

        expect(getByRole('textbox').closest('div')).toHaveClass(
            outerDivClassName
        );
    });

    test('sets default outerDivClassName', () => {
        const { getByRole } = render(<Input />);

        expect(
            getByRole('textbox').closest('div')?.classList.length
        ).toBeGreaterThan(0);
    });

    test('sets autofocus', () => {
        const { getByRole } = render(<Input autoFocus={true} />);

        expect(getByRole('textbox')).toHaveFocus();
    });
});
