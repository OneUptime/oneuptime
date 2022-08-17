import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Pill, { PillSize } from '../Components/Pill/Pill';
import Color from 'Common/Types/Color';

describe('Test for Pill', () => {
    test('should render the component with className rounded-pill', () => {
        const color: Color = new Color('#807149');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'pill' })
                .props.className.includes('rounded-pill')
        ).toBe(true);
    });
    test('Checking text', () => {
        const color: Color = new Color('#807149');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(testInstance.findByProps({ id: 'pill' }).children).toEqual([
            ' ',
            'Love',
            ' ',
        ]);
    });
    test('Checking the font-size(Small)', () => {
        const color: Color = new Color('#807149');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance.findByProps({ id: 'pill' }).parent?.props.size
        ).toEqual(PillSize.Small);
    });
    test('Checking the font-size(Large)', () => {
        const color: Color = new Color('#807149');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Large} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance.findByProps({ id: 'pill' }).parent?.props.size
        ).toEqual(PillSize.Large);
    });
    test('Checking for color #807149', () => {
        const color: Color = new Color('#807149');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance.findByProps({ id: 'pill' }).parent?.props.color
        ).toEqual(color);
    });
    test('Checking for color #fffff', () => {
        const color: Color = new Color('#ffffff');
        const testRenderer: ReactTestRenderer = renderer.create(
            <Pill text="Love" color={color} size={PillSize.Small} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance.findByProps({ id: 'pill' }).parent?.props.color
        ).toEqual(color);
    });
});
