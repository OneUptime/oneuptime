import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Pill, { PillSize } from '../Components/Pill/Pill';
import Color from 'Common/Types/Color';

describe('Test for Pill', () => {
    const color: Color = new Color('#807149');
    const testRenderer: ReactTestRenderer = renderer.create(
        <Pill text="Love" color={color} size={PillSize.Small} />
    );
    const testInstance: ReactTestInstance = testRenderer.root;
    test('should render the component', () => {
        expect(testInstance.findAllByType('span')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('rounded-pill'),
                }),
            })
        );
    });
    test('Checking text', () => {
        expect(
            testInstance.findByProps({ className: 'rounded-pill badge' })
                .children
        ).toEqual([' ', 'Love', ' ']);
    });
    test('Checking the color', () => {
        const element = testInstance.props.color;
        expect(element).toEqual(color);
    });
});
