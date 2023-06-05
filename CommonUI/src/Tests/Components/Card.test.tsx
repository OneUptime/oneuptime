import React, { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Card, {
    CardButtonSchema,
    ComponentProps,
} from '../../Components/Card/Card';
import { ButtonStyleType } from '../../Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';

describe('Card', () => {
    const props: ComponentProps = {
        title: 'title',
        description: 'description',
    };

    const renderComponent: Function = (props: ComponentProps): void => {
        render(<Card {...props} />);
    };

    test('should display card title', () => {
        renderComponent(props);

        const title: HTMLElement = screen.getByText(props.title as string);
        expect(title).toBeInTheDocument();
        expect(title).toHaveClass(
            'text-lg font-medium leading-6 text-gray-900'
        );
    });

    test('should display card description', () => {
        renderComponent(props);

        const description: HTMLElement = screen.getByText(
            props.description as string
        );
        expect(description).toBeInTheDocument();
        expect(description).toHaveClass('mt-1 text-sm text-gray-500');
    });

    test('should render rightElement passed in the props', () => {
        const rightElementText: string = 'right element';
        const rightElement: ReactElement = <div>{rightElementText}</div>;

        renderComponent({ ...props, rightElement });

        expect(screen.getByText(rightElementText)).toBeInTheDocument();
    });

    test('should render buttons with the button schemas passed in the props', () => {
        const buttons: CardButtonSchema[] = [
            {
                title: 'btn 1',
                buttonStyle: ButtonStyleType.SUCCESS,
                onClick: jest.fn(),
                icon: IconProp.Success,
                className: 'btn-1-class',
            },
            {
                title: 'btn 2',
                buttonStyle: ButtonStyleType.DANGER,
                onClick: jest.fn(),
                icon: IconProp.Close,
                className: 'btn-2-class',
                disabled: true,
            },
        ];

        renderComponent({ ...props, buttons });

        const button1: HTMLElement = screen.getByText(buttons[0]?.title ?? '');
        fireEvent.click(button1);
        expect(button1).toBeInTheDocument();
        expect(button1).toHaveClass(buttons[0]?.className ?? '');
        expect(buttons[0]?.onClick).toHaveBeenCalled();
        expect(button1.parentElement).not.toHaveStyle({ marginLeft: '10px' });

        const button2: HTMLElement = screen.getByText(buttons[1]?.title ?? '');
        expect(button2).toBeInTheDocument();
        expect(button2).toBeDisabled();
        expect(button2.parentElement).toHaveStyle({ marginLeft: '10px' });
    });

    test('should render component children passed in the props and their parent element should have bodyClassName value passed in the props as css class', () => {
        const bodyClassName: string = 'body-class';
        const childElementText: string = 'child element';
        const childElement: ReactElement = (
            <div key={0}>{childElementText}</div>
        );

        renderComponent({ ...props, children: [childElement], bodyClassName });

        const childComponent: HTMLElement = screen.getByText(childElementText);

        expect(childComponent).toBeInTheDocument();
        expect(childComponent.parentElement).toHaveClass(bodyClassName);
    });

    test("should render component children passed in the props and their parent element have css class 'mt-6'", () => {
        const childElementText: string = 'child element';
        const childElement: ReactElement = (
            <div key={0}>{childElementText}</div>
        );

        renderComponent({ ...props, children: [childElement] });

        const childComponent: HTMLElement = screen.getByText(childElementText);

        expect(childComponent).toBeInTheDocument();
        expect(childComponent.parentElement).toHaveClass('mt-6');
    });
});
