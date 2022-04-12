import { allRoutes } from '../routes';

const pageTitles = (): void => {
    const map = {};
    allRoutes.forEach(route => {
        map[route.title] = route.icon;
    });
    return map;
};

export default pageTitles;
