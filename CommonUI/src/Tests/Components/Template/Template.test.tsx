import React from 'react';
import '@testing-library/jest-dom';
import { screen, render } from '@testing-library/react';
import Component, {
    ComponentProps,
} from '../../../Components/Template/Template';

describe('Template Component', () => {
    const props: ComponentProps = {
        title: 'Template title',
    };
    it('should render component with the correct title', () => {
        render(<Component {...props} />);
        expect(screen.getByText(props.title)).toBeInTheDocument();
    });
});
