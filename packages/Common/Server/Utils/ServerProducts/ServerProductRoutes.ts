import ServerProducts from "./ServerProducts";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "../Express";
import ProductKey from "../../../Types/Product/ProductKey";

/*
 * A PRODUCT'S OWN ROUTES, REFUSED WHILE IT IS SWITCHED OFF (#7479).
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
 * 403) - before its handler reads anything. A route that only reads is
 * left alone: products that stay on show records of others. A write such
 * a route makes with the caller's props is refused again where every
 * write is (ProductWriteRefusal); this says so first, and covers the
 * routes that write as the server once they have checked the caller.
 *
 * ProductCustomRoutesGuard (Tests/Server/API) holds every route of a
 * product's API to this or to its list of reads.
 */
export default class ServerProductRoutes {
  public static refuseWhileOff(product: ProductKey): RequestHandler {
    return async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        await ServerProducts.assertProductIsOn(product);
        next();
      } catch (err) {
        next(err);
      }
    };
  }
}
