import * as React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import ProgressBar from '../../Components/ProgressBar/ProgressBar';

describe('ProgressBar Component', () => {
    function getProgressBar(): HTMLElement {
        const element: HTMLElement = screen.getByTestId('progress-bar');
        if (!element) {
            throw 'Not Found';
        }
        return element;
    }

    test('should calculate and display the correct percentage', () => {
        render(<ProgressBar count={0} totalCount={100} suffix="items" />);
        const progressBar: HTMLElement = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '0%' });
    });

    test('should display the correct count and total count with suffix', () => {
        render(<ProgressBar count={30} totalCount={99} suffix="items" />);
        const countText: HTMLElement = screen.getByTestId('progress-bar-count');
        const totalCountText: HTMLElement = screen.getByTestId(
            'progress-bar-total-count'
        );
        expect(countText).toBeInTheDocument();
        expect(totalCountText).toBeInTheDocument();

        expect(countText.innerHTML).toEqual('30 items');
        expect(totalCountText.innerHTML).toEqual('99 items');
    });

    test('should handle zero total count without crashing', () => {
        render(<ProgressBar count={30} totalCount={0} suffix="items" />);
        const progressBar: HTMLElement = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '100%' });
    });

    test('should round up the percentage to the nearest integer', () => {
        render(<ProgressBar count={33} totalCount={100} suffix="items" />);
        const progressBar: HTMLElement = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '33%' });
    });

    test('should cap the percentage at 100 if count exceeds total count', () => {
        render(<ProgressBar count={150} totalCount={100} suffix="items" />);
        const progressBar: HTMLElement = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '100%' });
    });
});
