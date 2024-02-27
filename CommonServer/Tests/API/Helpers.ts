import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../../Utils/Express';

type RouterFunction = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
) => void | Promise<void>;

type Route = {
    method: string;
    uri: string;
    middleware: RouterFunction;
    handlerFunction: RouterFunction;
};

type MockRouterForMethodFunction = (method: string) => (uri: string, middleware: RouterFunction, handlerFunction: RouterFunction) => void;

const mockRouterForMethod: MockRouterForMethodFunction = (method: string) => {
    return (
        uri: string,
        middleware: RouterFunction,
        handlerFunction: RouterFunction
    ): void => {
        mockRouter.routes.push({
            method: method.toUpperCase(),
            uri,
            middleware,
            handlerFunction,
        });
    };
};

type MockRouter = {
    get: jest.Mock;
    post: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
    routes: Route[];
    match: (method: string, uri: string) => Route;
};

export const mockRouter: MockRouter = {
    get: jest.fn().mockImplementation(mockRouterForMethod('get')),
    post: jest.fn().mockImplementation(mockRouterForMethod('post')),
    put: jest.fn().mockImplementation(mockRouterForMethod('put')),
    delete: jest.fn().mockImplementation(mockRouterForMethod('delete')),
    routes: [] as any as Route[],
    match: (method: string, uri: string) => {
        const route: Route | undefined = mockRouter.routes.find(
            (route: Route) => {
                return (
                    method.toUpperCase() === route.method && uri === route.uri
                );
            }
        );
        if (!route) {
            throw 'not found';
        }
        return route;
    },
};
