import React, { ReactElement } from 'react';
import SideOver, { ComponentProps } from '../../Components/SideOver/SideOver';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';

describe('SideOver', () => {
    const childElementText: string = 'child element';
    const childElement: ReactElement = <div key={0}>{childElementText}</div>;

    const props: ComponentProps = {
        title: 'title',
        description: 'description',
        onClose: jest.fn(),
        onSubmit: jest.fn(),
        children: childElement,
    };

    const renderComponent: Function = (props: ComponentProps): void => {
        render(<SideOver {...props} />);
    };

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should display title', () => {
        renderComponent(props);

        const title: HTMLElement = screen.getByText(props.title);
        expect(title).toBeInTheDocument();
        expect(title).toHaveClass('text-lg font-medium text-gray-900');
    });

    test('should display description', () => {
        renderComponent(props);

        const description: HTMLElement = screen.getByText(props.description);
        expect(description).toBeInTheDocument();
        expect(description).toHaveClass('text-sm text-gray-500');
    });

    test("should close the call onClose when 'Close Panel' button is clicked", () => {
        renderComponent(props);

        const closePanelButton: HTMLElement = screen.getByText('Close panel');
        expect(closePanelButton).toBeInTheDocument();

        fireEvent.click(closePanelButton);
        expect(props.onClose).toHaveBeenCalled();
    });

    test('should render children component passed in the props', () => {
        renderComponent(props);

        expect(screen.getByText(childElementText)).toBeInTheDocument();
    });

    test('should render leftFooterElement when passed in the props', () => {
        const leftFooterElementText: string = 'left element';
        const leftFooterElement: ReactElement = (
            <div key={0}>{leftFooterElementText}</div>
        );

        renderComponent({ ...props, leftFooterElement });

        expect(screen.getByText(leftFooterElementText)).toBeInTheDocument();
    });

    test('should call onClose when Cancel button is clicked', () => {
        renderComponent(props);

        const cancelButton: HTMLElement = screen.getByText('Cancel');
        expect(cancelButton).toBeInTheDocument();

        fireEvent.click(cancelButton);
        expect(props.onClose).toHaveBeenCalled();
    });

    test('should use submitButtonText value passed in the props for submit button text', () => {
        const submitButtonText: string = 'Submit';

        renderComponent({ ...props, submitButtonText });

        expect(screen.getByText(submitButtonText)).toBeInTheDocument();
    });

    test('should disable Save button', () => {
        renderComponent({ ...props, submitButtonDisabled: true });

        const saveButton: HTMLElement = screen.getByText('Save');

        expect(saveButton).toBeInTheDocument();
        expect(saveButton).toBeDisabled();
    });

    test('should call onSubmit when Save button is clicked', () => {
        renderComponent(props);

        const saveButton: HTMLElement = screen.getByText('Save');
        expect(saveButton).toBeInTheDocument();

        fireEvent.click(saveButton);
        expect(props.onSubmit).toHaveBeenCalled();
    });
});
