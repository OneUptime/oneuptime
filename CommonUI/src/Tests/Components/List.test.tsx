import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import FieldType from '../../Components/Types/FieldType';
import List, { ComponentProps } from '../../Components/List/List';

describe('List', () => {
    const defaultProps: ComponentProps = {
        data: [
            {
                id: '1',
                name: 'Item 1',
                description: 'Description 1',
            },
            {
                id: '2',
                name: 'Item 2',
                description: 'Description 2',
            },
        ],
        id: 'test-list',
        fields: [
            {
                title: 'ID',
                key: 'id',
                fieldType: FieldType.Text,
                colSpan: 1,
            },
            {
                title: 'Name',
                key: 'name',
                fieldType: FieldType.Text,
                colSpan: 2,
            },
            {
                title: 'Description',
                key: 'description',
                fieldType: FieldType.Text,
                colSpan: 2,
            },
        ],
        onNavigateToPage: jest.fn(),
        currentPageNumber: 1,
        totalItemsCount: 10,
        itemsOnPage: 5,
        error: '',
        isLoading: false,
        singularLabel: 'Item',
        pluralLabel: 'Items',
    };

    it('renders List component with data', () => {
        render(<List {...defaultProps} />);

        expect(screen.getByTestId('list-container')).toBeInTheDocument();
        expect(screen.getByTestId('list-pagination')).toBeInTheDocument();
    });

    it('renders loading state', () => {
        render(<List {...defaultProps} isLoading={true} />);

        expect(screen.getByTestId('component-loader')).toBeInTheDocument();
    });

    it('renders error state', () => {
        const messageError: string = 'Test error';
        render(<List {...defaultProps} error={messageError} />);

        expect(screen.getByText(messageError)).toBeInTheDocument();
    });

    it('renders error state when data is empty', () => {
        const messageError: string = 'There are no items';
        render(
            <List {...defaultProps} data={[]} noItemsMessage={messageError} />
        );

        expect(screen.getByText(messageError)).toBeInTheDocument();
    });

    it('renders error state default message when data is empty ', () => {
        const messageError: string = 'No item';
        render(<List {...defaultProps} data={[]} />);

        expect(screen.getByText(messageError)).toBeInTheDocument();
    });

    it('handles onNavigateToPage callback', () => {
        render(<List {...defaultProps} />);
        fireEvent.click(screen.getByText('Next'));

        expect(defaultProps.onNavigateToPage).toHaveBeenCalledWith(2, 5);
    });
});
