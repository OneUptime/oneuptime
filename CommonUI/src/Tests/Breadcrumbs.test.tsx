import * as React from 'react';
import { describe, test, expect } from '@jest/globals';
import Route from 'Common/Types/API/Route';
import renderer from 'react-test-renderer';
import Breadcrumbs from '../Components/Breadcrumbs/Breadcrumbs';
import RouteMap from '../../../Dashboard/src/Utils/RouteMap';
import PageMap from '../../../Dashboard/src/Utils/PageMap';
import Link from 'Common/Types/Link';
const links: Array<Link> = [
    {
        title: 'Project Name',
        to: RouteMap[PageMap.HOME] as Route,
    },
    {
        title: 'Home',
        to: RouteMap[PageMap.HOME] as Route,
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
