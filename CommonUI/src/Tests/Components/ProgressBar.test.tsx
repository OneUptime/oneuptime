import * as React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import ProgressBar from '../../Components/ProgressBar/ProgressBar';

describe('ProgressBar Component', () => {
    function getProgressBar(): HTMLElement {
        //BAD IDEA: should be .progressBar
        const element: HTMLElement | null =
            document.querySelector('.bg-indigo-600');
        if (!element) {
            throw 'Not Found';
        }
        return element;
    }

    test('should calculate and display the correct percentage', () => {
        render(<ProgressBar count={0} totalCount={100} suffix="items" />);
        const progressBar: HTMLElement | null = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '0%' });
    });

    test('should display the correct count and total count with suffix', () => {
        render(<ProgressBar count={30} totalCount={99} suffix="items" />);
        const countText: HTMLElement = screen.getByText('30 items');
        const totalCountText: HTMLElement = screen.getByText('99 items');
        expect(countText).toBeInTheDocument();
        expect(totalCountText).toBeInTheDocument();
    });

    test('should handle zero total count without crashing', () => {
        render(<ProgressBar count={30} totalCount={0} suffix="items" />);
        const progressBar: Element | null = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '100%' });
    });

    test('should round up the percentage to the nearest integer', () => {
        render(<ProgressBar count={33} totalCount={100} suffix="items" />);
        const progressBar: Element | null = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '33%' });
    });

    test('should cap the percentage at 100 if count exceeds total count', () => {
        render(<ProgressBar count={150} totalCount={100} suffix="items" />);
        const progressBar: Element | null = getProgressBar();
        expect(progressBar).toHaveStyle({ width: '100%' });
    });
});
