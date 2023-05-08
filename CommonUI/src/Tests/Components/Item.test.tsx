import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import Item, { ComponentProps } from '../../Components/OrderedStatesList/Item';
import { ButtonStyleType } from '../../Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';

describe('Item component', () => {
    const defaultProps: ComponentProps = {
        item: { id: 1, name: 'Test Item', description: 'Test description' },
        actionButtons: [
            {
                title: 'Edit',
                icon: IconProp.Edit,
                buttonStyleType: ButtonStyleType.PRIMARY,
                onClick: jest.fn(),
            },
            {
                title: 'Add',
                icon: IconProp.Add,
                buttonStyleType: ButtonStyleType.NORMAL,
                onClick: jest.fn(),
            },
        ],
        titleField: 'name',
        descriptionField: 'description',
    };

    it('renders item information correctly', () => {
        const { getByText } = render(<Item {...defaultProps} />);
        expect(getByText('Test Item')).toBeInTheDocument();
        expect(getByText('Test description')).toBeInTheDocument();
    });
    it('calls action button onClick function when clicked', () => {
        const { getByText } = render(<Item {...defaultProps} />);
        const editButton: HTMLElement = getByText('Edit');
        editButton.click();
        expect(editButton).toBeInTheDocument();
        expect(defaultProps.actionButtons?.[0]?.onClick).toHaveBeenCalled();
    });
    it('should render titlefield as string if getTitleElement is not provided', () => {
        const { getByText } = render(<Item {...defaultProps} />);
        const titleElement: HTMLElement = getByText('Test Item');
        expect(titleElement).toBeInTheDocument();
    });
    it('should render custom title element provided by getTitleElement function', () => {
        const props: ComponentProps = {
            ...defaultProps,
            getTitleElement: jest.fn(),
        };
        render(<Item {...props} />);
        expect(props.getTitleElement).toHaveBeenCalledWith(props.item);
    });
    it('should render custom title element provided by getDescriptionElement function', () => {
        const props: ComponentProps = {
            ...defaultProps,
            getDescriptionElement: jest.fn(),
        };
        render(<Item {...props} />);
        expect(props.getDescriptionElement).toHaveBeenCalled();
    });
});
