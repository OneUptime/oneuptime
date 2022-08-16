import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Alert, { AlertType } from '../Components/Alerts/Alert';

describe('Test for Alert.ts', () => {
    const type_val = AlertType.SUCCESS;
    const testRenderer: ReactTestRenderer = renderer.create(
        <Alert type={type_val} title="Spread" strongTitle="Love" />
    );
    const testInstance: ReactTestInstance = testRenderer.root;
    test('should render the component', () => {
        expect(testInstance.findAllByType('div')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('alert'),
                }),
            })
        );
    });
    test('Checking if the proper className is used', () => {
        const element = testInstance.props.type;
        expect(element).toEqual(type_val);
    });
    test('Checking if the proper title is used', () => {
        const element = testInstance.props.title;
        expect(element).toEqual('Spread');
    });
    test('Checking if the proper strongTitle title is used', () => {
        const element = testInstance.props.strongTitle;
        expect(element).toEqual('Love');
    });
});
