import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Pill, { PillSize } from '../Components/Pill/Pill';
import { Black } from '../Utils/BrandColors';

describe('Test for Pill', () => {
    const testRenderer: ReactTestRenderer = renderer.create(
        <Pill text="Love" color={Black} size={PillSize.Small} />
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
});

//  expect(screen.getByTestId('my-test-id')).toHaveTextContent('some text');
