import ServerProducts from "./ServerProducts";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "../Express";
import ProductKey from "../../../Types/Product/ProductKey";

/*
 * A PRODUCT'S OWN ROUTES, REFUSED WHILE IT IS SWITCHED OFF (#7479, #9489).
 *
 * Beside the CRUD API every product has routes of its own: Send Test Report
 * on a status page, Turn Monitoring Off for a monitor group, a cloud
 * connection's Read Now, an on-call test page, a runbook's Run. Each one
 * that changes something, or sets the product to work, names its product
 * with this middleware, after the caller is read:
 *
 *   this.router.post(
 *     `${path}/test-email-report`,
 *     UserMiddleware.getUserMiddleware,
 *     ServerProductRoutes.refuseWhileOff(ProductKey.StatusPages),
 *     handler,
 *   );
 *
 * and is refused, while the server has switched the product off, with
 * what happened and who can switch it on (ProductSwitchedOffException, a
 * 403) - before its handler reads anything. A route that acts on more than
 * one product names each (refuseWhileOff(ProductKey.OnCall,
 * ProductKey.Incidents)), and is refused while any of them is off. A route
 * whose product depends on what it is asked about - an incident's or an
 * alert's investigation, the record type in its path - names it from the
 * request itself, never from a record (refuseWhileOffFor,
 * refuseWhileRecordTableIsOff), so the answer is the same before anything
 * is read and says nothing about which records exist.
 *
 * A route that only reads is left alone: products that stay on show
 * records of others, and switching a product on again loses nothing. A
 * write such a route makes with the caller's props is refused again where
 * every write is (ProductWriteRefusal); this says so first, and covers the
 * routes that write as the server once they have checked the caller.
 *
 * ProductCustomRoutesGuard (Tests/Server/API) holds every file that
 * registers a route that is not a GET to this, route by route, or to a
 * reason written down beside it.
 */
// Every refusal made here, so a suite can tell one in a route's chain.
const REFUSALS: WeakSet<RequestHandler> = new WeakSet<RequestHandler>();

export default class ServerProductRoutes {
  // Refused while any of the products named is off.
  public static refuseWhileOff(...products: Array<ProductKey>): RequestHandler {
    return ServerProductRoutes.refuseWhileOffFor(
      (): ReadonlyArray<ProductKey> => {
        return products;
      },
    );
  }

  /*
   * Whether a middleware is one of these refusals: a route's suite that
   * pins what stands in front of its handler reads it, since each refusal
   * is a middleware of its own.
   */
  public static isRefusal(handler: unknown): boolean {
    return (
      typeof handler === "function" && REFUSALS.has(handler as RequestHandler)
    );
  }

  /*
   * Refused while any of the products the request names is off - read from
   * the request alone (its body, its path), as ProductsOfRequest does. A
   * request that names none, or one its reader cannot read, goes on to its
   * handler, which answers it as it always did.
   */
  public static refuseWhileOffFor(
    getProducts: (req: ExpressRequest) => ReadonlyArray<ProductKey>,
  ): RequestHandler {
    return ServerProductRoutes.remember(
      async (
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          for (const product of ServerProductRoutes.readProducts(
            getProducts,
            req,
          )) {
            await ServerProducts.assertProductIsOn(product);
          }

          next();
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Refused, as BaseAPI refuses a write of a record, while every product
   * the table the request names serves is off (ProductRecordTables): a rule
   * run names its rule's table, which is the product's. A table of no
   * product, or none, goes on.
   */
  public static refuseWhileRecordTableIsOff(
    getTableName: (req: ExpressRequest) => string | null | undefined,
  ): RequestHandler {
    return ServerProductRoutes.remember(
      async (
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          let tableName: string | null | undefined = null;

          try {
            tableName = getTableName(req);
          } catch {
            // Its handler says what is wrong with the request.
            tableName = null;
          }

          await ServerProducts.assertRecordTableIsOn(tableName);

          next();
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private static remember(handler: RequestHandler): RequestHandler {
    REFUSALS.add(handler);

    return handler;
  }

  // The products a request names: none when they cannot be read from it.
  private static readProducts(
    getProducts: (req: ExpressRequest) => ReadonlyArray<ProductKey>,
    req: ExpressRequest,
  ): ReadonlyArray<ProductKey> {
    try {
      return getProducts(req) || [];
    } catch {
      // Its handler says what is wrong with the request.
      return [];
    }
  }
}
