import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import Route from 'Common/Types/API/Route';
import { create, ReactTestInstance } from 'react-test-renderer';
import Breadcrumbs from '../Components/Breadcrumbs/Breadcrumbs';
import Link from 'Common/Types/Link';

describe('Breadcrumbs', () => {
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

    const instance: ReactTestInstance = create(
        <Breadcrumbs links={links} />
    ).root;

    test('should render correctly', () => {
        expect(instance.findAllByType('li')).toContainEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    className: expect.stringContaining('breadcrumb-item'),
                }),
            })
        );
    });

    test('it should have a link to defined', () => {
        expect(instance.props['links'][0].to).toBeDefined();
    });

    test('it should have a link title defined', () => {
        const text: string | undefined = links[0]?.title;
        const element: boolean =
            instance.findByProps({ children: text }).type === 'link';
        expect(element).toBeDefined();
    });
});
