import React from 'react';
import RadioButtons, {
    RadioButton,
} from '../../Components/RadioButtons/RadioButtons';
import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';

describe('RadioButtons', () => {
    const options: RadioButton[] = [
        {
            title: 'title 1',
            description: 'description 1',
            value: '1',
            sideTitle: 'side title 1',
            sideDescription: 'side description 1',
        },
        {
            title: 'title 2',
            description: 'description 2',
            value: '2',
            sideTitle: 'side title 2',
            sideDescription: 'side description 2',
        },
    ];

    test('renders with required props only', () => {
        const { getByRole } = render(
            <RadioButtons onChange={() => {}} options={options} />
        );
        const radioButtonsGroup: HTMLElement = getByRole('radiogroup');
        expect(radioButtonsGroup).toBeInTheDocument();
    });

    test('renders with all props', () => {
        const { getByRole } = render(
            <RadioButtons
                onChange={() => {}}
                options={options}
                initialValue="1"
                error="error"
            />
        );
        const radioButtonsGroup: HTMLElement = getByRole('radiogroup');
        expect(radioButtonsGroup).toBeInTheDocument();
    });

    test('sets options', () => {
        const { getAllByRole } = render(
            <RadioButtons onChange={() => {}} options={options} />
        );

        const radioButtons: HTMLElement[] = getAllByRole('radio');

        expect(radioButtons).toHaveLength(2);
    });

    test('sets initial value', () => {
        const { getByLabelText } = render(
            <RadioButtons
                onChange={() => {}}
                options={options}
                initialValue="1"
            />
        );

        const radioButton: HTMLElement = getByLabelText('title 1');
        expect(radioButton).toBeChecked();
    });

    test('displays error', () => {
        const { queryByText, rerender, getByText } = render(
            <RadioButtons
                onChange={() => {}}
                options={options}
                initialValue="1"
            />
        );
        expect(queryByText('error')).toBeNull();

        rerender(
            <RadioButtons onChange={() => {}} options={options} error="error" />
        );
        expect(getByText('error')).toBeInTheDocument();
    });

    test('displays titles and descriptions', () => {
        const { getByText, getByLabelText } = render(
            <RadioButtons
                onChange={() => {}}
                options={[options[0] as RadioButton]}
            />
        );

        expect(getByLabelText('title 1')).toBeInTheDocument();
        expect(getByText('description 1')).toBeInTheDocument();
        expect(getByText('side title 1')).toBeInTheDocument();
        expect(getByText('side description 1')).toBeInTheDocument();
    });

    test('calls onChange', () => {
        const onChange: jest.Mock = jest.fn();
        const { getByLabelText } = render(
            <RadioButtons onChange={onChange} options={options} />
        );

        const radioButton: HTMLElement = getByLabelText('title 1');
        fireEvent.click(radioButton);

        expect(onChange).toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledWith('1');
    });
});
