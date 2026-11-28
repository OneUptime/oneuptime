import MonitorTemplateChange from "../../Models/DatabaseModels/MonitorTemplateChange";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import CallerPlan from "../Utils/Billing/CallerPlan";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import MonitorTemplateChangeRunner from "../Utils/Monitor/MonitorTemplateChangeRunner";
import Response from "../Utils/Response";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import CommonAPI from "./CommonAPI";

/*
 * CHANGING MANY MONITORS' TEMPLATE, OVER HTTP (issues #11260, #11266).
 *
 *   POST /monitor-template-change/start
 *        { monitorTemplateId?, settings,
 *          monitorIds | allLinkedToTemplate | autoImportRuleId }
 *                                                 ask for a change
 *   GET  /monitor-template-change/change/:changeId[?lines=all]
 *                                                 one change, as it stands
 *   GET  /monitor-template-change/template/:monitorTemplateId/active
 *                                                 the template's changes
 *                                                 that have not finished
 *   GET  /monitor-template-change/project/active
 *                                                 the project's changes the
 *                                                 Monitors list shows: still
 *                                                 running, or finished in the
 *                                                 last hour with monitors left
 *                                                 out or failed (#11454)
 *   GET  /monitor-template-change/auto-import-rule/:ruleId/monitors
 *                                                 what a move of an auto
 *                                                 import rule's monitors
 *                                                 would move (#11451)
 *   POST /monitor-template-change/change/:changeId/stop
 *   POST /monitor-template-change/change/:changeId/retry
 *
 * A bare router (NetworkDeviceDiscoveryImportAPI is the precedent): changes
 * are internal rows with no CRUD API, read here as root, so these handlers
 * are the gate.
 *
 *  - Every route needs a person signed in to the project. A change acts as
 *    a person - each monitor is changed with their permissions - so a
 *    project API key cannot ask for one; an API key links and unlinks one
 *    monitor at a time (MonitorTemplateAPI).
 *  - Seeing a change needs the right to read the project's monitors: it is
 *    a team's shared state - everybody who can see the monitors can see that
 *    someone is moving them, how far it has got and what was left out.
 *  - Asking for one, retrying one and stopping one need the right to edit
 *    monitors, checked by the runner with the person's own permissions.
 */
const router: ExpressRouter = Express.getRouter();

async function getPersonProps(req: ExpressRequest): Promise<{
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
}> {
  const props: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
    await CommonAPI.getDatabaseCommonInteractionProps(req),
  );

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return { props: props, projectId: projectId };
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

function readIdParam(
  req: ExpressRequest,
  name: string,
  notFound: string = "This change was not found. Reload the page, then try again.",
): ObjectID {
  const value: unknown = req.params[name];

  if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
    throw new BadDataException(notFound);
  }

  return new ObjectID(value);
}

async function sendView(data: {
  req: ExpressRequest;
  res: ExpressResponse;
  row: MonitorTemplateChange;
  allLines?: boolean | undefined;
}): Promise<void> {
  return Response.sendJsonObjectResponse(data.req, data.res, {
    change: MonitorTemplateChangeRunner.toView({
      row: data.row,
      allLines: data.allLines,
    }) as unknown as JSONObject,
  });
}

router.post(
  "/monitor-template-change/start",
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      const created: MonitorTemplateChange =
        await MonitorTemplateChangeRunner.start({
          projectId: projectId,
          props: props,
          monitorTemplateId: body["monitorTemplateId"],
          settings: body["settings"],
          monitorIds: body["monitorIds"],
          allLinkedToTemplate: body["allLinkedToTemplate"],
          autoImportRuleId: body["autoImportRuleId"],
        });

      return await sendView({
        req,
        res,
        row: await MonitorTemplateChangeRunner.findChange({
          changeId: created.id!,
          projectId: projectId,
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/monitor-template-change/change/:changeId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      MonitorTemplateChangeRunner.assertCanSeeChanges(props);

      return await sendView({
        req,
        res,
        row: await MonitorTemplateChangeRunner.findChange({
          changeId: readIdParam(req, "changeId"),
          projectId: projectId,
        }),
        allLines: req.query["lines"] === "all",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/monitor-template-change/template/:monitorTemplateId/active",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      MonitorTemplateChangeRunner.assertCanSeeChanges(props);

      const rows: Array<MonitorTemplateChange> =
        await MonitorTemplateChangeRunner.findActiveChangesOfTemplate({
          projectId: projectId,
          monitorTemplateId: readIdParam(req, "monitorTemplateId"),
        });

      return Response.sendJsonObjectResponse(req, res, {
        changes: rows.map((row: MonitorTemplateChange): JSONObject => {
          return MonitorTemplateChangeRunner.toView({
            row: row,
          }) as unknown as JSONObject;
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/monitor-template-change/project/active",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      MonitorTemplateChangeRunner.assertCanSeeChanges(props);

      const rows: Array<MonitorTemplateChange> =
        await MonitorTemplateChangeRunner.findChangesToShowOfProject({
          projectId: projectId,
        });

      return Response.sendJsonObjectResponse(req, res, {
        changes: rows.map((row: MonitorTemplateChange): JSONObject => {
          return MonitorTemplateChangeRunner.toView({
            row: row,
          }) as unknown as JSONObject;
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/monitor-template-change/auto-import-rule/:ruleId/monitors",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      return Response.sendJsonObjectResponse(
        req,
        res,
        (await MonitorTemplateChangeRunner.getAutoImportRuleMonitorsToMove({
          projectId: projectId,
          props: props,
          ruleId: readIdParam(
            req,
            "ruleId",
            "The auto import rule was not found. Reload the page, then try again.",
          ),
        })) as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/monitor-template-change/change/:changeId/stop",
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      return await sendView({
        req,
        res,
        row: await MonitorTemplateChangeRunner.stop({
          projectId: projectId,
          props: props,
          changeId: readIdParam(req, "changeId"),
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/monitor-template-change/change/:changeId/retry",
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      const retried: MonitorTemplateChange =
        await MonitorTemplateChangeRunner.retry({
          projectId: projectId,
          props: props,
          changeId: readIdParam(req, "changeId"),
        });

      return await sendView({
        req,
        res,
        row: await MonitorTemplateChangeRunner.findChange({
          changeId: retried.id!,
          projectId: projectId,
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
