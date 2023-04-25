import React from 'react';
import Toggle from '../../Components/Toggle/Toggle';
import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';

describe('Toggle', () => {
    test('renders toggle element with required props only', () => {
        const { getByRole } = render(
            <Toggle onChange={() => {}} initialValue={false} />
        );
        const toggle: HTMLElement = getByRole('switch');

        expect(toggle).toBeInTheDocument();
    });

    test('renders toggle element with all props', () => {
        const { getByRole } = render(
            <Toggle
                onChange={() => {}}
                onFocus={() => {}}
                onBlur={() => {}}
                initialValue={false}
                tabIndex={1}
                title="title"
                description="description"
                error="error"
            />
        );
        const toggle: HTMLElement = getByRole('switch');

        expect(toggle).toBeInTheDocument();
    });

    test('calls onChange', () => {
        const onChange: jest.Mock = jest.fn();

        const { getByRole } = render(
            <Toggle onChange={onChange} initialValue={false} />
        );
        const toggle: HTMLElement = getByRole('switch');
        fireEvent.click(toggle);

        expect(onChange).toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledWith(true);
    });

    test('calls onFocus', () => {
        const onFocus: jest.Mock = jest.fn();

        const { getByRole } = render(
            <Toggle
                onFocus={onFocus}
                initialValue={false}
                onChange={() => {}}
            />
        );
        const toggle: HTMLElement = getByRole('switch');
        fireEvent.focus(toggle);

        expect(onFocus).toHaveBeenCalledTimes(1);
    });

    test('calls onBlur', () => {
        const onBlur: jest.Mock = jest.fn();

        const { getByRole } = render(
            <Toggle onBlur={onBlur} initialValue={false} onChange={() => {}} />
        );
        const toggle: HTMLElement = getByRole('switch');
        fireEvent.blur(toggle);

        expect(onBlur).toHaveBeenCalledTimes(1);
    });

    test('displays error', () => {
        const { getByText } = render(
            <Toggle onChange={() => {}} initialValue={false} error="error" />
        );

        expect(getByText('error')).toBeInTheDocument();
    });

    test('displays title', () => {
        const { getByText } = render(
            <Toggle
                onChange={() => {}}
                initialValue={false}
                title="title"
                description="description"
            />
        );

        expect(getByText('title')).toBeInTheDocument();
    });

    test('displays description', () => {
        const { getByText } = render(
            <Toggle
                onChange={() => {}}
                initialValue={false}
                description="description"
            />
        );
        expect(getByText('description')).toBeInTheDocument();
    });

    test('sets tabIndex', () => {
        const { getByRole } = render(
            <Toggle onChange={() => {}} initialValue={false} tabIndex={1} />
        );
        const toggle: HTMLElement = getByRole('switch');

        expect(toggle).toHaveAttribute('tabindex', '1');
    });

    test('sets initial value', () => {
        const { getByRole } = render(
            <Toggle onChange={() => {}} initialValue={true} />
        );
        const toggle: HTMLElement = getByRole('switch');

        expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    test('styles toggle correctly', () => {
        const { getByRole } = render(
            <Toggle onChange={() => {}} initialValue={false} />
        );
        const toggle: HTMLElement = getByRole('switch');

        expect(toggle).toHaveClass('bg-gray-200');
        fireEvent.click(toggle);
        expect(toggle).toHaveClass('bg-indigo-600');
    });
});
