// Libraries
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { Dictionary } from 'lodash';

// Custom components
import DictionaryOfStrings, {
    ComponentProps,
} from '../../Components/Dictionary/DictionaryOfStrings';

jest.mock('Common/Types/Date', () => {
    return {
        toDateTimeLocalString: jest.fn(),
        asDateForDatabaseQuery: jest.fn(),
        fromString: jest.fn(),
        toString: jest.fn(),
    };
});

describe('Dictionary Of Strings', () => {
    const initialValue: Dictionary<string> = {
        key: 'value',
    };

    const defaultProps: ComponentProps = {
        initialValue,
        onChange: jest.fn(),
        keyPlaceholder: 'KeyPlaceholder',
        valuePlaceholder: 'ValuePlaceholder',
        addButtonSuffix: 'Attribute',
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('Should not show any row if no initialValue is provided', () => {
        render(
            <DictionaryOfStrings {...{ ...defaultProps, initialValue: {} }} />
        );

        expect(
            screen.queryByPlaceholderText(defaultProps.keyPlaceholder as string)
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', {
                name: new RegExp(`Add ${defaultProps.addButtonSuffix}`, 'i'),
            })
        ).toBeInTheDocument();
    });

    it('Should show the rows if initialValue is provided', () => {
        render(<DictionaryOfStrings {...defaultProps} />);
        const key: string = Object.keys(initialValue)[0] || '';
        const value: string = initialValue[key] || '';

        expect(screen.getByDisplayValue(key)).toBeInTheDocument();
        expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    });

    it('Should call onChange function with correct values when input changes', () => {
        render(<DictionaryOfStrings {...defaultProps} />);

        fireEvent.change(
            screen.getByPlaceholderText(defaultProps.keyPlaceholder as string),
            {
                target: { value: 'testKey' },
            }
        );
        fireEvent.change(
            screen.getByPlaceholderText(
                defaultProps.valuePlaceholder as string
            ),
            {
                target: { value: 'testValue' },
            }
        );

        expect(defaultProps.onChange).toHaveBeenCalledWith({
            testKey: 'testValue',
        });
    });

    it('Should add a new row when the Add button is clicked', () => {
        render(<DictionaryOfStrings {...defaultProps} />);
        fireEvent.click(
            screen.getByText(`Add ${defaultProps.addButtonSuffix}`)
        );

        const keyInputs: HTMLInputElement[] = screen.getAllByPlaceholderText(
            defaultProps.keyPlaceholder as string
        );
        const valueInputs: HTMLInputElement[] = screen.getAllByPlaceholderText(
            defaultProps.valuePlaceholder as string
        );

        expect(keyInputs.length).toBe(2);
        expect(valueInputs.length).toBe(2);
    });

    it('Should delete a row when the Delete button is clicked', () => {
        const initialValue: Dictionary<string> = {
            key1: 'value1',
            key2: 'value2',
        };
        render(
            <DictionaryOfStrings
                {...defaultProps}
                initialValue={initialValue}
            />
        );

        const key1: string = Object.keys(initialValue)[0] || '';
        const value1: string = initialValue[key1] || '';
        const key2: string = Object.keys(initialValue)[1] || '';
        const value2: string = initialValue[key2] || '';
        const deleteButtons: HTMLButtonElement = screen.getByTestId(
            `delete-${key2}`
        );
        fireEvent.click(deleteButtons);

        expect(screen.queryByDisplayValue(key1)).toBeInTheDocument();
        expect(screen.queryByDisplayValue(value1)).toBeInTheDocument();
        expect(screen.queryByDisplayValue(key2)).not.toBeInTheDocument();
        expect(screen.queryByDisplayValue(value2)).not.toBeInTheDocument();
    });
});
