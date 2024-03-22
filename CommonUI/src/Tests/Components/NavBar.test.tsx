import React from 'react';
import { render, screen } from '@testing-library/react';
import Navbar, { ComponentProps } from '../../Components/Navbar/NavBar';
import '@testing-library/jest-dom/extend-expect';

describe('Navbar', () => {
    const defaultProps: ComponentProps = {
        children: <div>Test</div>,
    };

    it('renders without crashing', () => {
        render(<Navbar {...defaultProps} />);
        expect(screen.getByText('Test')).toBeInTheDocument();
    });

    it('renders with a custom className', () => {
        const customProps = { ...defaultProps, className: 'custom-class' };
        const { container } = render(<Navbar {...customProps} />);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('renders with a rightElement', () => {
        const rightElement = <div>Right Element</div>;
        const customProps = { ...defaultProps, rightElement };
        render(<Navbar {...customProps} />);
        expect(screen.getByText('Right Element')).toBeInTheDocument();
    });

    it('renders with multiple children', () => {
        const customProps = { ...defaultProps, children: [<div key={1}>Child 1</div>, <div key={2}>Child 2</div>] };
        render(<Navbar {...customProps} />);
        expect(screen.getByText('Child 1')).toBeInTheDocument();
        expect(screen.getByText('Child 2')).toBeInTheDocument();
    });
});
