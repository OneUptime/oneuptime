import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Tabs from '../../Components/Tabs/Tabs';
import { Tab } from '../../Components/Tabs/Tab';

describe('Tabs', () => {
    const activeClass: string = 'bg-gray-100 text-gray-700';

    const tab1: Tab = {
        name: 'tab1',
        children: <div>tab1 content</div>,
    };

    const tab2: Tab = {
        name: 'tab2',
        children: <div>tab2 content</div>,
    };

    const tabs: Array<Tab> = [tab1, tab2];

    test('it should render all props passed', () => {
        const onTabChange: jest.Mock = jest.fn();

        const { getByText } = render(
            <Tabs tabs={tabs} onTabChange={onTabChange} />
        );

        expect(getByText('tab1')).toBeInTheDocument();
        expect(getByText('tab2')).toBeInTheDocument();
    });

    test('it should render the first tab as active by default', () => {
        const onTabChange: jest.Mock = jest.fn();

        const { getByText } = render(
            <Tabs tabs={tabs} onTabChange={onTabChange} />
        );

        expect(getByText('tab1')).toHaveClass(activeClass);
    });

    test('it should call onTabChange with the correct tab when a tab is clicked', () => {
        const onTabChange: jest.Mock = jest.fn();

        const { getByText } = render(
            <Tabs tabs={tabs} onTabChange={onTabChange} />
        );

        fireEvent.click(getByText('tab1'));
        expect(onTabChange).toHaveBeenCalledWith(tab1);

        fireEvent.click(getByText('tab2'));
        expect(onTabChange).toHaveBeenCalledWith(tab2);
    });

    test('it should show the correct tab as active when a tab is clicked', () => {
        const onTabChange: jest.Mock = jest.fn();

        const { getByText } = render(
            <Tabs tabs={tabs} onTabChange={onTabChange} />
        );

        fireEvent.click(getByText('tab2'));

        expect(getByText('tab1')).not.toHaveClass(activeClass);
        expect(getByText('tab2')).toHaveClass(activeClass);
    });

    test('it should handle empty tabs array gracefully', () => {
        const tabs: Array<Tab> = [];
        const onTabChange: jest.Mock = jest.fn();

        const { getByText } = render(
            <Tabs tabs={tabs} onTabChange={onTabChange} />
        );

        expect(() => {
            return getByText('tab1');
        }).toThrow();

        expect(() => {
            return getByText('tab2');
        }).toThrow();
    });
});
