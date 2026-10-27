import BadRequestException from "Common/Types/Exception/BadRequestException";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import {
  ProjectSignInMethods,
  SignInMethods,
  SsoSignInProvider,
} from "Common/Types/SSO/SignInMethods";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import SsoSignInMethods from "Common/Server/Utils/SsoSignInMethods";

/*
 * How this server signs people in, for its sign-in pages - asked before
 * anyone is signed in, so served to anyone (Common/Types/SSO/SignInMethods):
 *
 *   GET /identity/sign-in-methods
 *       Whether the whole server requires single sign-on, its instance-wide
 *       providers that are on, and - while it requires SSO - whether any
 *       project has a provider of its own. The Accounts pages offer only SSO
 *       while it is required.
 *
 *   GET /identity/project-sign-in-methods/:projectId
 *       The providers that sign people in to one project: its own, and the
 *       instance-wide ones that reach it, or only the one it requires. The
 *       page a project that requires SSO sends people to lists them.
 *
 * Neither says more than the sign-in pages draw: kinds, ids, names and
 * descriptions of providers, never their settings. Never cached by the
 * browser or a proxy: turning a requirement or a provider on or off shows on
 * the next visit.
 */

const router: ExpressRouter = Express.getRouter();

// What a sign-in page is told of a provider, and nothing else.
const toJson: (provider: SsoSignInProvider) => JSONObject = (
  provider: SsoSignInProvider,
): JSONObject => {
  return {
    type: provider.type,
    id: provider.id,
    name: provider.name,
    description: provider.description,
  };
};

router.get(
  "/sign-in-methods",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const methods: SignInMethods = await SsoSignInMethods.getSignInMethods();

      return Response.sendJsonObjectResponse(req, res, {
        isSsoRequired: methods.isSsoRequired,
        ssoProviders: methods.ssoProviders.map(toJson),
        hasProjectSsoProviders: methods.hasProjectSsoProviders,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  "/project-sign-in-methods/:projectId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      Response.setNoCacheHeaders(res);

      const projectIdValue: unknown = req.params["projectId"];

      if (
        typeof projectIdValue !== "string" ||
        !ObjectID.isValidUUID(projectIdValue)
      ) {
        throw new BadRequestException("Invalid project id.");
      }

      const methods: ProjectSignInMethods =
        await SsoSignInMethods.getProjectSignInMethods(
          new ObjectID(projectIdValue),
        );

      return Response.sendJsonObjectResponse(req, res, {
        ssoProviders: methods.ssoProviders.map(toJson),
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
