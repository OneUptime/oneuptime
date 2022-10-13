import React from 'react';
import { render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import  HiddenText  from '../Components/HiddenText/HiddenText';
import Icon from '../Components/Icon/Icon';
describe('tests for HiddenText component', () => {
    
    test('it should show icon in the document', () => {
        render(
            <HiddenText text='text' />
        );
        expect(Icon).toBeInTheDocument;
    });
    test('it should show paragraph in the document ', () => {
        render(
            <HiddenText dataTestId="test-id" text='text' />
        );
        const testId: HTMLElement = screen.getByTestId('test-id');
        expect(testId).toBeInTheDocument;
        expect(testId).toHaveTextContent('Click here to reveal');
    });   
});
