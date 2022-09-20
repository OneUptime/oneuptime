import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Button, { ButtonStyleType } from '../Components/Button/Button';
describe('Tests for Button.tsx', () => {
    test('should  render component and pass title as prop', () => {
        render(<Button title="buttonTitle" />);
        expect(screen.getByText(/buttonTitle/i)).toBeInTheDocument();
    });
    test('button should be in document and visible to everyone', () => {
        render(<Button />);
        expect(screen.getByRole('button')).toBeInTheDocument();
        expect(screen.getByRole('button')).toBeVisible();
    });
    test(' button should contain some HTML tags(span,div)', () => {
        render(<Button />);
        expect(screen.getByRole('button')).toBeInTheDocument();
        expect(screen.getByRole('button')).toContainHTML('span');
        expect(screen.getByRole('button')).toContainHTML('div');
    });
    test('button should be clickable', () => {
        render(<Button title="buttonName" />);
        fireEvent.click(screen.getByRole('button', { name: 'buttonName' }));
        expect(
            screen.getByRole('button', { name: 'buttonName' })
        ).toBeInTheDocument();
    });
    test('Checking if button is  Normal', () => {
        render(<Button buttonStyle={ButtonStyleType.NORMAL} />);
        expect(screen.getByRole('button')).toHaveClass('no-border-on-hover');
    });
});
