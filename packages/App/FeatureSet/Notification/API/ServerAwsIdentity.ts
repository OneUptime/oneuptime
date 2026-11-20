import ServerAwsIdentityService from "../Services/ServerAwsIdentityService";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { ServerAwsIdentityAnswer } from "Common/Types/Email/ServerAwsIdentity";
import { JSONObject } from "Common/Types/JSON";

/*
 * GET /server-aws-identity?region=<Region> - which AWS identity this
 * server signs in as (#7380), for the Admin Dashboard's Amazon SES card
 * when the server's own email signs in with its IAM role
 * (ServerAwsIdentityService): the identity's ARN and account and where
 * its credentials came from, or why it has none. Never a key or a token.
 *
 * Master admins only, as a test send is, and never the master API key:
 * the answer names the server's AWS account and role, and asking it runs
 * the server's own sign-in (a credential_process included).
 */

const router: ExpressRouter = Express.getRouter();

// The Region the email sends from, when it is one; the service checks it again.
export const readIdentityRegion: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 40)
    : undefined;
};

router.get(
  "/",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const answer: ServerAwsIdentityAnswer =
        await ServerAwsIdentityService.check({
          region: readIdentityRegion(req.query["region"]),
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
