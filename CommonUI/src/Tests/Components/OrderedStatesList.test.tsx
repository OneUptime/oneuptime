import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import OrderedStatesList, {
    ComponentProps,
} from '../../Components/OrderedStatesList/OrderedStatesList';

describe('OrderedSateList', () => {
    const defaultProps: ComponentProps = {
        data: [{ title: 'item 1', description: 'description 1', order: 1 }],
        singularLabel: 'Item',
        titleField: 'title',
        id: 'new-item-button',
        orderField: 'order',
        noItemsMessage: 'No Item',
        shouldAddItemInTheEnd: true,
        shouldAddItemInTheBegining: true,
    };
    it('should render all components', () => {
        render(<OrderedStatesList {...defaultProps} />);
        expect(screen.getByText('item 1')).toBeInTheDocument;
    });
    it('renders Item components for each item in data prop', () => {
        const props: ComponentProps = {
            ...defaultProps,
            data: [
                { title: 'item 1', description: 'description 1', order: 1 },
                { title: 'item 2', description: 'description 2', order: 2 },
                { title: 'item 3', description: 'description 3', order: 3 },
            ],
        };
        render(<OrderedStatesList {...props} />);
        expect(props.data).toHaveLength(3);
    });
    it('renders a ComponentLoader if isLoading prop is true', () => {
        const props: ComponentProps = {
            ...defaultProps,
            isLoading: true,
        };
        render(<OrderedStatesList {...props} />);
        expect(screen.getByRole('bar-loader')).toBeInTheDocument();
    });
    it('should render an error message if error prop is present', () => {
        const props: ComponentProps = {
            ...defaultProps,
            error: 'Error Message',
        };
        render(<OrderedStatesList {...props} />);
        expect(screen.getByText('Error Message')).toBeInTheDocument();
    });
    it('should render "No Item" message when there is no data', () => {
        const props: ComponentProps = {
            ...defaultProps,
            data: [],
        };
        const { getByText } = render(<OrderedStatesList {...props} />);
        expect(getByText('No Item')).toBeInTheDocument();
    });
    it('calls the onRefreshClick function when the refresh button is clicked', () => {
        const props: ComponentProps = {
            ...defaultProps,
            data: [],
            onRefreshClick: jest.fn(),
        };
        render(<OrderedStatesList {...props} />);
        const refreshButton: HTMLElement = screen.getByRole('button');
        refreshButton.click();
        expect(props.onRefreshClick).toHaveBeenCalled();
    });
    it('should call the onCreateNewItem prop when the "New Item" button is clicked', () => {
        const props: ComponentProps = {
            ...defaultProps,
            onCreateNewItem: jest.fn(),
        };
        const { getByText } = render(<OrderedStatesList {...props} />);
        const newItem: HTMLElement = getByText('Add New Item');
        newItem.click();
        expect(props.onCreateNewItem).toHaveBeenCalled();
    });
});
