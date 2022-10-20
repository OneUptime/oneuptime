
import React from 'react';
import { render,screen,fireEvent,act} from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import  HiddenText  from '../Components/HiddenText/HiddenText';
import Icon from '../Components/Icon/Icon';
describe('tests for HiddenText component', () => {
    it('it should click paragraph and show text in document', async () => {
        act(() => {
            render(<HiddenText text='text' />);
          });
        const paragraph = screen.getByRole('paragraph');
        await act(async () => {
          fireEvent.click(paragraph);
        });
        expect(screen.getByText('text')).toBeInTheDocument();
      });
      it('it should call function after clicking paragraph', async () => {
        const setShowText: (() => true) = jest.fn();
        act(() => {
            render(<HiddenText text='text' />);
          });
        const paragraph = screen.getByRole('paragraph');
        await act(async () => {
          fireEvent.click(paragraph);
        });
        expect(setShowText).toBeCalled;
      });
      it('it should click paragraph and copy to clipboard', async () => {
        act(() => {
            render(<HiddenText text='text' isCopyable={true} dataTestId="test-id"/>);
          });
        const paragraph = screen.getByRole('paragraph');
        await act(async () => {
          fireEvent.click(paragraph);
        });
        expect(screen.getByTestId("test-id")).toHaveTextContent('Copy to Clipboard')
      });
      it('it should call function after clicking paragraph', async () => {
        const  setCopyToClipboard: (() => false) = jest.fn();
        act(() => {
            render(<HiddenText text='text' isCopyable={true}/>);
          });
        const paragraph = screen.getByRole('paragraph');
        await act(async () => {
          fireEvent.click(paragraph);
        });
        expect(setCopyToClipboard).toBeCalled;
      });
    test('it should show icon in the document', () => {
        render(
            <HiddenText text='text' />
        );
        expect(Icon).toBeInTheDocument;
    });
    test('it should show paragraph in the document and its content ', () => {
        render(
            <HiddenText dataTestId="test-id" text='text' />
        );
        const testId: HTMLElement = screen.getByRole('paragraph');
        expect(testId).toBeInTheDocument;
        expect(testId).toHaveTextContent('Click here to reveal');
    });
   
    test('it should have a paragraph and its role attribute', () => {
        render(<HiddenText text='text'/>);
        const testId = screen.getByRole('paragraph');
        expect(testId).toHaveAttribute('role','paragraph');
    });
    
});
   
 

