import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import Route from 'Common/Types/API/Route';
import renderer from 'react-test-renderer';
import Breadcrumbs from '../Components/Breadcrumbs/Breadcrumbs';
import Link from 'Common/Types/Link';
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

describe('Breadcrumbs', () => {
    test('should render correctly', () => {
        const tree: any = renderer
            .create(<Breadcrumbs links={links} />)
            .toJSON();
        expect(tree).toMatchSnapshot();
    });
});
