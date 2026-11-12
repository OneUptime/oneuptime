import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectProductsService, {
  CHOOSE_PRODUCTS_PERMISSIONS,
  ProjectProductsCaller,
} from "../Services/ProjectProductsService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  PROJECT_PRODUCTS_PINS_ROUTE,
  PROJECT_PRODUCTS_ROUTE,
  PROJECT_PRODUCTS_VISIBILITY_ROUTE,
  ProjectProductsAnswer,
  toProjectProductsAnswerJSON,
} from "../../Types/Product/ProjectProductsAnswer";

/*
 * A PROJECT'S PRODUCTS, OVER HTTP (issue #6814). The routes and their
 * answer are described in Types/Product/ProjectProductsAnswer.ts;
 * ProjectProductsService works the answer out.
 *
 * A bare router, as WelcomeChecklistAPI is: the answer is no model's CRUD,
 * and the service reads and writes as root, so the checks here are the
 * whole gate:
 *
 *   - every route needs a signed-in member of the project in the `tenantid`
 *     header (CommonAPI.assertAuthenticatedProjectMember): no session is a
 *     401, so an expired one refreshes and sends again;
 *   - showing and hiding the project's products needs someone who may edit
 *     the project (a Project Owner or Admin, or Edit Project), or a master
 *     admin;
 *   - pins change only the caller's own.
 *
 * Every route answers with the products as they now stand, so the Dashboard
 * draws the change without a second request.
 */
const router: ExpressRouter = Express.getRouter();

async function readCaller(req: ExpressRequest): Promise<ProjectProductsCaller> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return {
    projectId: projectId,
    userId: props.userId as ObjectID,
    props: props,
  };
}

async function sendAnswer(
  req: ExpressRequest,
  res: ExpressResponse,
  caller: ProjectProductsCaller,
): Promise<void> {
  const answer: ProjectProductsAnswer =
    await ProjectProductsService.getAnswer(caller);

  return Response.sendJsonObjectResponse(
    req,
    res,
    toProjectProductsAnswerJSON(answer),
  );
}

function readBody(req: ExpressRequest): JSONObject {
  const body: unknown = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  return body as JSONObject;
}

// The project's products, for the project and the caller.
router.get(
  PROJECT_PRODUCTS_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      return await sendAnswer(req, res, await readCaller(req));
    } catch (err) {
      next(err);
    }
  },
);

// Show or hide one product, or show them all again.
router.post(
  PROJECT_PRODUCTS_VISIBILITY_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: ProjectProductsCaller = await readCaller(req);

      CommonAPI.assertPermittedInProject({
        databaseProps: caller.props,
        allowedPermissions: [...CHOOSE_PRODUCTS_PERMISSIONS],
        errorMessage:
          "Only someone who may edit the project can choose the products it shows.",
      });

      const body: JSONObject = readBody(req);

      if (body["showAll"] === true) {
        await ProjectProductsService.showEveryProduct(caller);
      } else {
        await ProjectProductsService.setProductShown(caller, {
          product: body["product"],
          isShown: body["isShown"],
        });
      }

      return await sendAnswer(req, res, caller);
    } catch (err) {
      next(err);
    }
  },
);

// The caller's pins, in order.
router.post(
  PROJECT_PRODUCTS_PINS_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: ProjectProductsCaller = await readCaller(req);
      const body: JSONObject = readBody(req);

      await ProjectProductsService.setPinnedProducts(caller, body["pinned"]);

      return await sendAnswer(req, res, caller);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
