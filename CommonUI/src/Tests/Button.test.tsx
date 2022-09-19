import * as React from 'react';
import { render,screen,fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Button,{ ButtonStyleType} from '../Components/Button/Button';

describe('Tests for Button.tsx', () => {
    test('should  render component and pass title as prop', () => {
        render(
            <Button title="buttonTitle" 
            />
        );
        const buttonTitle=screen.getByText(/buttonTitle/i)
        expect(buttonTitle).toBeInTheDocument();
    });
    test('button should be in document and visible to everyone', () => {
        render(
            <Button
            />
        );
        const button=screen.getByRole("button")
        expect(button).toBeInTheDocument();
        expect(button).toBeVisible()
    });
    test(' button should contain some HTML tags(span,div)', () => {
        render(
            <Button
            />
        );
        const button=screen.getByRole("button")
        expect(button).toBeInTheDocument();
        expect(button).toContainHTML("span")
        expect(button).toContainHTML("div")

    });
    test('button should be clickable', () => {
        render(
            <Button title='buttonName'
              />
        );
        const button=screen.getByRole("button",{name:'buttonName'})
        fireEvent.click(button)
        expect(button).toBeInTheDocument();

    });

    test('Checking if button is  Normal', () => {
        render(
            <Button 
            buttonStyle={ButtonStyleType.NORMAL}
            />
        );
        expect(screen.getByRole("button")).toHaveClass('no-border-on-hover');
    });
});