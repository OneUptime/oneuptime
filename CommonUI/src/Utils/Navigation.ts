import Route from 'Common/Types/API/Route';
import { NavigateFunction, Location, Params } from 'react-router-dom';
import URL from 'Common/Types/API/URL';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Hostname from 'Common/Types/API/Hostname';
import ObjectID from 'Common/Types/ObjectID';
import { Dictionary } from 'lodash';

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

    public static getCurrentPath(): Route {
        return new Route(window.location.pathname);
    }

    public static getQueryStringByName(paramName: string): string | null {
        const urlSearchParams: URLSearchParams = new URLSearchParams(
            window.location.search
        );
        const params: Dictionary<string> = Object.fromEntries(
            urlSearchParams.entries()
        );
        if (params && params[paramName]) {
            return params[paramName] as string;
        }

        return null;
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

    public static getFirstParam(
        getFromFirstRoute?: number
    ): string | undefined {
        const pathname: string = window.location.pathname;

        return pathname.split('/')[getFromFirstRoute || 1];
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

    public static containsInPath(text: string): boolean {
        return window.location.pathname.includes(text);
    }

    public static isOnThisPage(route: Route | URL): boolean {
        if (route instanceof Route) {
            const current: Route = this.getCurrentRoute();

            let isOnThisPage: boolean = true;

            const routeItems: Array<string> = route.toString().split('/');
            const currentPathItems: Array<string> = current
                .toString()
                .split('/');
            if (routeItems.length !== currentPathItems.length) {
                return false;
            }

            let start: number = 0;
            for (const item of currentPathItems) {
                if (routeItems[start]?.startsWith(':') && item) {
                    start++;
                    continue;
                }

                if (routeItems[start]?.toString() !== item.toString()) {
                    isOnThisPage = false;
                    break;
                }

                start++;
            }

            return isOnThisPage;
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

    public static navigate(
        to: Route | URL,
        options?: {
            openInNewTab?: boolean | undefined;
            forceNavigate?: boolean | undefined;
        }
    ): void {
        if (options?.openInNewTab) {
            // open in new tab
            window.open(to.toString(), '_blank');
            return;
        }

        if (options?.forceNavigate && to instanceof Route) {
            window.location.href = to.toString();
        }

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
