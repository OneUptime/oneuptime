import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EmptyState from '../../../Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';

describe('EmptyState', () => {
    test('renders correctly with all props', () => {
        render(
            <EmptyState
                title="Empty State Title"
                description="This is an empty state description"
                icon={IconProp.User}
                footer={<div>This is a footer element</div>}
            />
        );
        const titleElement: HTMLElement = screen.getByText('Empty State Title');
        const descriptionElement: HTMLElement =
            screen.getByText('Empty State Title');
        const iconElement: HTMLElement = screen.getByRole('icon');
        const footerElement: HTMLElement = screen.getByText(
            'This is a footer element'
        );
        expect(titleElement).toBeInTheDocument();
        expect(descriptionElement).toBeInTheDocument();
        expect(iconElement).toBeInTheDocument();
        expect(footerElement).toBeInTheDocument();
    });
    test('renders without an icon', () => {
        render(
            <EmptyState
                icon={undefined}
                title="Title"
                description="Description"
            />
        );
        const title: HTMLElement = screen.getByText('Title');
        const description: HTMLElement = screen.getByText('Description');
        expect(title).toBeInTheDocument();
        expect(description).toBeInTheDocument();
    });
});
