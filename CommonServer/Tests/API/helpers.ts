import { ExpressRequest, ExpressResponse, NextFunction} from '../../Utils/Express';

type RouterFunction = (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => void;
type Route = {method: String, uri: String, middleware: RouterFunction, handlerFunction: RouterFunction}

const mockRouterForMethod = (method: string) => (
  uri: string, 
  middleware: RouterFunction, 
  handlerFunction: RouterFunction
): void => {
  mockRouter.routes.push({method: method.toUpperCase(), uri, middleware, handlerFunction})
}

export const mockRouter = {
  get: jest.fn().mockImplementation(mockRouterForMethod('get')),
  post: jest.fn().mockImplementation(mockRouterForMethod('post')),
  put: jest.fn().mockImplementation(mockRouterForMethod('put')),
  delete: jest.fn().mockImplementation(mockRouterForMethod('delete')),
  routes: [] as any as Route[],
  match: (method: String, uri: String) => {
    const route = mockRouter.routes.find((route: Route) => 
      method.toUpperCase() === route.method && uri === route.uri
    )
    if (!route) throw "not found"
    return route
  }
};
