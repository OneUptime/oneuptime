import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import Route from 'Common/Types/API/Route';
import renderer, {
    ReactTestInstance,
    ReactTestRenderer,
} from 'react-test-renderer';
import Breadcrumbs from '../../Components/Breadcrumbs/Breadcrumbs';
import Link from 'Common/Types/Link';
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
});
