import Breadcrumbs from '../../Components/Breadcrumbs/Breadcrumbs';
import Navigation from '../../Utils/Navigation';
import { describe, expect, test } from '@jest/globals';
import Route from 'Common/Types/API/Route';
import Link from 'Common/Types/Link';
import * as React from 'react';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';

describe('Breadcrumbs', () => {
    test('Should render correctly and also contain "Home" and "Projects" string', () => {
        const links: Array<Link> = [
            {
                title: 'Home',
                to: new Route('/'),
            },
            {
                title: 'Projects',
                to: new Route('/projects'),
            },
        ];

        const testRenderer: ReactTestRenderer = renderer.create(
            <Breadcrumbs links={links} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        expect(testInstance.findAllByType('li')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('breadcrumb-item'),
                }),
            })
        );
        expect(
            testInstance.findAllByType('a')[0]?.findByType('span').props[
                'children'
            ]
        ).toEqual('Home');
        expect(
            testInstance.findAllByType('a')[1]?.findByType('span').props[
                'children'
            ]
        ).toEqual('Projects');
    });

    test('Should avoid linking to the current page', () => {
        // Mock `window.location.pathname`
        Object.defineProperty(window, 'location', {
            get() {
                return { pathname: '/projects' };
            },
        });
        // Render component
        const links: Array<Link> = [
            {
                title: 'Home',
                to: new Route('/'),
            },
            {
                title: 'Projects',
                to: new Route('/projects'),
            },
        ];
        const testRenderer: ReactTestRenderer = renderer.create(
            <Breadcrumbs links={links} />
        );
        const testInstance: ReactTestInstance = testRenderer.root;
        // Assert cursor style
        const anchors: ReactTestInstance[] = testInstance.findAllByType('a');
        expect(anchors[0]?.props['className']).toContain('cursor-pointer');
        expect(anchors[1]?.props['className']).toContain('cursor-default');
        // Set up spy on navigation
        jest.spyOn(Navigation, 'navigate');
        // Assert the second link does not navigate
        anchors[1]?.props['onClick']();
        expect(Navigation.navigate).not.toHaveBeenCalled();
        // Assert the first link navigates
        anchors[0]?.props['onClick']();
        expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
});
