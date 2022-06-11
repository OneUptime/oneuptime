import Route from 'Common/Types/API/Route';
import { NavigateFunction, Location } from 'react-router-dom';

abstract class Navigation {
    private static navigateHook: NavigateFunction;
    private static location: Location;

    public static setNavigateHook(navigateHook: NavigateFunction): void {
        this.navigateHook = navigateHook;
    }

    public static setLocation(location: Location): void {
        this.location = location;
    }

    public static getLocation(): Route {
        return new Route(this.location.pathname);
    }

    public static navigate(route: Route): void {
        if (this.navigateHook) {
            this.navigateHook(route.toString());
        }
    }
}

export default Navigation;
