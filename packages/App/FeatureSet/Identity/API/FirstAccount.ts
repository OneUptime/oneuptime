import { isWaitingForFirstAccount } from "../Utils/FirstAccount";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * POST /identity/first-account: whether this self-hosted server is waiting
 * for its first account (Utils/FirstAccount.ts). The register page asks, to
 * say that the account it creates becomes the server's admin.
 *
 * Anyone may ask, signed in or not: the answer is what the register page
 * would show anyone anyway, it names nobody, and on OneUptime Cloud it is
 * always no. A POST, as the other sign-in requests are, so no page fallback
 * answers it.
 */
const router: ExpressRouter = Express.getRouter();

router.post(
  "/first-account",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      res.setHeader("Cache-Control", "no-store");

      return Response.sendJsonObjectResponse(req, res, {
        isAwaitingFirstAccount: await isWaitingForFirstAccount(),
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
