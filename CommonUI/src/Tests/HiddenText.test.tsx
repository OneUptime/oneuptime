import React from 'react';
import { render,screen,fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import  HiddenText  from '../Components/HiddenText/HiddenText';
import Icon,{IconProp} from '../Components/Icon/Icon';
// import { renderHook,act } from '@testing-library/react-hooks'
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
    test('it should paragraphy click should return boolean', () => {
        const setShowText: (() => Boolean) = jest.fn();
        render(<HiddenText text="text" dataTestId="test-id"  />);
        fireEvent.click(screen.getByTestId('test-id'))
        expect(setShowText).toBeCalled;
    });
    test('it should click paragraph and return true value', () => {
        const setShowText: (() => true) = jest.fn();
        render(<HiddenText text="text" dataTestId="test-id"  />);
        fireEvent.click(screen.getByTestId('test-id'))
        expect(setShowText).toBeCalled;
    });
    test('it should show paragraph class of pointer underline', () => {
        render(<HiddenText dataTestId="test-id"text='text' />);
        const testId: HTMLElement = screen.getByTestId('test-id');
        expect(testId).toHaveClass('pointer underline');
    });
    test('it should click icon and show off text', () => { 
        const setShowText: (() => false) = jest.fn();
        render(<Icon icon={IconProp.Hide} onClick={setShowText} dataTestId="test-id" />);
        fireEvent.click(screen.getByTestId('test-id'))
        expect(setShowText).toBeCalled;
    });
    test('it should click icon and cant copy to clipboard', () => { 
        const setCopyToClipboard: (() => false) = jest.fn();
        render(<Icon icon={IconProp.Hide} onClick={setCopyToClipboard} dataTestId="test-id" />);
        fireEvent.click(screen.getByTestId('test-id'))
        expect(setCopyToClipboard).toBeCalled;
    });
    test('it should show icon of hide', () => { 
        render(<Icon icon={IconProp.Hide} dataTestId="test-id"  />);
        const testId: HTMLElement = screen.getByTestId('test-id');
        expect(testId).toHaveClass('pointer');
    });
    test('it should have a class of  pointer underline', () => { 
        render(<HiddenText text='text' dataTestId="test-id" isCopyable={true} />);
        const testId: HTMLElement = screen.getByTestId('test-id');
        expect(testId).toHaveClass('pointer underline');
    });
});
   
 

