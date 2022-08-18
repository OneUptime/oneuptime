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
    test('Should have the class of alert-success', () => {
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
                .findByProps({ id: 'alertId' })
                .props['className'].includes('alert-success')
        ).toBe(true);
    });
    test('Should have the class of alert-info', () => {
        const Alertoptions: ComponentProps = {
            strongTitle: 'Strong Alert title',
            title: 'Alert title',
            type: AlertType.INFO,
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
                .findByProps({ id: 'alertId' })
                .props['className'].includes('alert-info')
        ).toBe(true);
    });
    test('Should have the class of alert-warning', () => {
        const Alertoptions: ComponentProps = {
            strongTitle: 'Strong Alert title',
            title: 'Alert title',
            type: AlertType.WARNING,
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
                .findByProps({ id: 'alertId' })
                .props['className'].includes('alert-warning')
        ).toBe(true);
    });
    test('Should have the class of alert-danger', () => {
        const Alertoptions: ComponentProps = {
            strongTitle: 'Strong Alert title',
            title: 'Alert title',
            type: AlertType.DANGER,
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
                .findByProps({ id: 'alertId' })
                .props['className'].includes('alert-danger')
        ).toBe(true);
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

        expect(testInstance.findByType('strong')?.props['children']).toEqual(
            'Strong Alert title'
        );
    });
    test('Should not render a strong title', () => {
        const testRenderer: ReactTestRenderer = renderer.create(<Alert />);
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance.findByProps({ id: 'strongTitleId' }).props['children']
        ).toBeFalsy();
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

        expect(
            testInstance
                .findByProps({ id: 'titleId' })
                .props['children'].includes('Alert title')
        ).toBeTruthy();
    });
    test('Should not render a title', () => {
        const testRenderer: ReactTestRenderer = renderer.create(<Alert />);
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(
            testInstance
                .findByProps({ id: 'titleId' })
                .props['children'].includes('Alert title')
        ).toBeFalsy();
    });

    test('Should render a close button', () => {
        const Alertoptions: ComponentProps = {
            strongTitle: 'Strong Alert title',
            title: 'Alert title',
            type: AlertType.SUCCESS,
            onClose: () => {},
        };
        const testRenderer: ReactTestRenderer = renderer.create(
            <Alert
                type={Alertoptions.type}
                title={Alertoptions.title}
                strongTitle={Alertoptions.strongTitle}
                onClose={Alertoptions.onClose}
            />
        );
        const testInstance: ReactTestInstance = testRenderer.root;

        expect(
            testInstance.findByProps({ id: 'closeBtnId' }).props['className']
        ).toBe('close');
    });
});
