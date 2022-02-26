import { allRoutes } from '../routes';

const pageTitles = () => {
    const map = {};
    allRoutes.forEach(route => {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[route.title] = route.icon;
    });
    return map;
};

export default pageTitles;
