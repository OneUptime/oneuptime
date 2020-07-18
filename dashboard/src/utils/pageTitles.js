import { allRoutes } from '../routes';

const pageTitles = () => {
    const map = {};
    allRoutes.forEach(route => {
        map[route.title] = route.icon;
    });
    return map;
};

export default pageTitles;
