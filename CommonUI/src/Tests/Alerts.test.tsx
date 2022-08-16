import * as React from 'react';
import { describe, test } from '@jest/globals';

import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Alert, { AlertType, ComponentProps } from '../Components/Alerts/Alert';

describe('Alert', () => {
    test('Should render correctly', () => {
        const testRenderer: ReactTestRenderer = renderer.create(<Alert />);
        const testInstance: ReactTestInstance = testRenderer.root;

        expect(testInstance.findAllByType('div')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('alert'),
                }),
            })
        );
    });
    test('Should match props', () => {
        const Alertoptions: ComponentProps = {
            strongTitle: 'Strong Alert title',
            title: 'Alert title',
            type: AlertType.SUCCESS,
        };
        const testRenderer: ReactTestRenderer = renderer.create(
            <Alert
                type={Alertoptions.type}
                title={Alertoptions.title}
                strongTitle={Alertoptions.strongTitle}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(testInstance?.props['strongTitle']).toEqual(
            Alertoptions.strongTitle
        );
        expect(testInstance?.props['title']).toBe(Alertoptions.title);
        expect(testInstance?.props['type']).toBe(Alertoptions.type);
    });
    test('Should have the class of Alert type', () => {
        const Alertoptions: ComponentProps = {
            strongTitle: 'Strong Alert title',
            title: 'Alert title',
            type: AlertType.SUCCESS,
        };
        const testRenderer: ReactTestRenderer = renderer.create(
            <Alert
                type={Alertoptions.type}
                title={Alertoptions.title}
                strongTitle={Alertoptions.strongTitle}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;

        expect(
            testInstance
                .findAllByType('div')[2]
                ?.props['className'].includes('alert-success')
        ).toBe(true);
    });
});
test('Should render a strong title', () => {
    const Alertoptions: ComponentProps = {
        strongTitle: 'Strong Alert title',
        title: 'Alert title',
        type: AlertType.SUCCESS,
    };
    const testRenderer: ReactTestRenderer = renderer.create(
        <Alert
            type={Alertoptions.type}
            title={Alertoptions.title}
            strongTitle={Alertoptions.strongTitle}
        />
    );
    const testInstance: ReactTestInstance = testRenderer.root;

    expect(testInstance.findAllByType('strong')[0]?.props['children']).toEqual(
        'Strong Alert title'
    );
});
test('Should render a title', () => {
    const Alertoptions: ComponentProps = {
        strongTitle: 'Strong Alert title',
        title: 'Alert title',
        type: AlertType.SUCCESS,
    };
    const testRenderer: ReactTestRenderer = renderer.create(
        <Alert
            type={Alertoptions.type}
            title={Alertoptions.title}
            strongTitle={Alertoptions.strongTitle}
        />
    );
    const testInstance: ReactTestInstance = testRenderer.root;
    const allElements = testInstance
        .findAllByType('div')[2]
        ?.findAllByType('div')[2]
        ?.findAllByType('div')[2];
    expect(allElements?.props['children'].includes('Alert title')).toBe(true);
});
