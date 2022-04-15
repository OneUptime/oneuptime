import { allRoutes } from '../routes';

const pageTitles: Function = (): void => {
    const map: $TSFixMe = {};
    allRoutes.forEach((route: $TSFixMe) => {
        map[route.title] = route.icon;
    });
    return map;
};

export default pageTitles;
