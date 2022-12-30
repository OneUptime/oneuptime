import Route from 'Common/Types/API/Route';
import { NavigateFunction, Location, Params } from 'react-router-dom';
import URL from 'Common/Types/API/URL';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Hostname from 'Common/Types/API/Hostname';
import ObjectID from 'Common/Types/ObjectID';

abstract class Navigation {
    private static navigateHook: NavigateFunction;
    private static location: Location;
    private static params: Params;

    public static setNavigateHook(navigateHook: NavigateFunction): void {
        this.navigateHook = navigateHook;
    }

    public static setLocation(location: Location): void {
        this.location = location;
    }

    public static setParams(params: Params): void {
        this.params = params;
    }

    public static getParams(): Params {
        return this.params;
    }

    public static getParamByName(
        paramName: string,
        routeTemplate: Route
    ): string | null {
        const currentPath: Array<string> = this.location.pathname.split('/');

        if (!paramName.startsWith(':')) {
            paramName = ':' + paramName;
        }

        const routeParamTemplateIndex: number = routeTemplate
            .toString()
            .split('/')
            .indexOf(paramName);

        if (routeParamTemplateIndex === -1) {
            throw new BadDataException(
                `Param ${paramName} not found in template ${routeTemplate.toString()}`
            );
        }

        if (currentPath[routeParamTemplateIndex]) {
            return currentPath[routeParamTemplateIndex] as string;
        }

        return null;
    }

    public static getLastParam(getFromLastRoute?: number): Route | null {
        return URL.fromString(window.location.href).getLastRoute(
            getFromLastRoute
        );
    }

    public static getLastParamAsObjectID(getFromLastRoute?: number): ObjectID {
        const param: Route | null = URL.fromString(
            window.location.href
        ).getLastRoute(getFromLastRoute);

        return new ObjectID(param?.toString().replace('/', '') || '');
    }

    public static getCurrentRoute(): Route {
        return new Route(this.location.pathname);
    }

    public static getHostname(): Hostname {
        return new Hostname(window.location.hostname);
    }

    public static getCurrentURL(): URL {
        return URL.fromString(window.location.href);
    }

    public static reload(): void {
        window.location.reload();
    }

    public static isOnThisPage(route: Route | URL): boolean {
        if (route instanceof Route) {
            const current: Route = this.getCurrentRoute();

            if (current.toString() === route.toString()) {
                return true;
            }

            return false;
        }

        if (route instanceof URL) {
            const current: URL = this.getCurrentURL();

            if (current.toString() === route.toString()) {
                return true;
            }

            return false;
        }

        return false;
    }

    public static goBack(): void {
        this.navigateHook(-1);
    }

    public static navigate(to: Route | URL): void {
        if (this.navigateHook && to instanceof Route) {
            this.navigateHook(to.toString());
        }

        // if its an external link outside of react.
        if (to instanceof URL) {
            window.location.href = to.toString();
        }
    }
}

export default Navigation;
