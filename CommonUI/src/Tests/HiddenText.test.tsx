import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import  HiddenText  from '../Components/HiddenText/HiddenText';
import Icon from '../Components/Icon/Icon';
describe('tests for HiddenText component', () => {
    
    test('it should show icon in the document', () => {
        render(
            <HiddenText text='strong' />
        );
        expect(Icon).toBeInTheDocument;
    });  
});
