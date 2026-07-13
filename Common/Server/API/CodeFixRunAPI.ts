import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Query from "../../Types/BaseDatabase/Query";
import Select from "../Types/Database/Select";
import { JSONObject } from "../../Types/JSON";
import AIRunType from "../../Types/AI/AIRunType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import Project from "../../Models/DatabaseModels/Project";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectService from "../Services/ProjectService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";

const DEFAULT_LIMIT: number = 25;
const MAX_LIMIT: number = 100;
const MAX_EVENTS: number = 500;

/*
 * Dedicated read endpoints for the dashboard's AI fix-task pages.
 *
 * Code-fix runs are system-authored AIRuns (runType CodeFix, userId = null)
 * and are therefore hidden by the per-user privacy pin on the generic
 * AIRun / AIRunEvent CRUD. So access is gated explicitly here — the same
 * pattern as AIInvestigationAPI: first confirm the caller can read the
 * parent object (the project) under THEIR permissions, then read the runs
 * and their events as root.
 */

const RUN_SELECT: Select<AIRun> = {
  _id: true,
  status: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
  triggeredByTelemetryExceptionId: true,
  totalTokens: true,
};

export default class CodeFixRunAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();
    this.initRoutes();
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  private initRoutes(): void {
    // List the project's code-fix runs, newest first.
    this.router.post(
      "/code-fix-run/list",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await this.getAccessCheckedProps(req);

          const body: JSONObject = (req.body as JSONObject) || {};

          let limit: number = DEFAULT_LIMIT;

          if (typeof body["limit"] === "number") {
            limit = body["limit"];
          }

          limit = Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);

          let skip: number = 0;

          if (typeof body["skip"] === "number") {
            skip = Math.max(Math.floor(body["skip"]), 0);
          }

          const query: Query<AIRun> = {
            projectId: props.tenantId!,
            runType: AIRunType.CodeFix,
          };

          // Root read after the tenant access check above.
          const runs: Array<AIRun> = await AIRunService.findBy({
            query: query,
            select: RUN_SELECT,
            sort: { createdAt: SortOrder.Descending },
            limit: limit,
            skip: skip,
            props: { isRoot: true },
          });

          const count: PositiveNumber = await AIRunService.countBy({
            query: query,
            props: { isRoot: true },
          });

          Response.sendJsonObjectResponse(req, res, {
            runs: BaseModel.toJSONArray(runs, AIRun),
            count: count.toNumber(),
          });
          return;
        } catch (err) {
          next(err);
          return;
        }
      },
    );

    // One run + its ordered glass-box event trail.
    this.router.post(
      "/code-fix-run/get/:runId",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await this.getAccessCheckedProps(req);

          const runIdString: string | undefined = req.params["runId"];

          if (!runIdString) {
            throw new BadDataException("runId is required.");
          }

          const runId: ObjectID = new ObjectID(runIdString);

          /*
           * Root read, but pinned to the caller's (access-checked) project —
           * a run id from another project resolves to "not found".
           */
          const run: AIRun | null = await AIRunService.findOneBy({
            query: {
              _id: runId.toString(),
              projectId: props.tenantId!,
              runType: AIRunType.CodeFix,
            },
            select: RUN_SELECT,
            props: { isRoot: true },
          });

          if (!run) {
            throw new BadDataException(
              "Code fix run not found (or it does not belong to this project).",
            );
          }

          const events: Array<AIRunEvent> = await AIRunEventService.findBy({
            query: { aiRunId: run.id! },
            select: {
              _id: true,
              sequence: true,
              eventType: true,
              toolName: true,
              resultSummary: true,
              createdAt: true,
            },
            sort: { sequence: SortOrder.Ascending },
            limit: MAX_EVENTS,
            skip: 0,
            props: { isRoot: true },
          });

          Response.sendJsonObjectResponse(req, res, {
            run: BaseModel.toJSONArray([run], AIRun)[0] || null,
            events: BaseModel.toJSONArray(events, AIRunEvent),
          });
          return;
        } catch (err) {
          next(err);
          return;
        }
      },
    );
  }

  /*
   * Requires a logged-in session and a tenant, then verifies project access
   * by reading the project under the USER's permissions (null when the user
   * is not a member). Returns the props for further use.
   */
  private async getAccessCheckedProps(
    req: ExpressRequest,
  ): Promise<DatabaseCommonInteractionProps> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.userId) {
      throw new NotAuthorizedException("A logged-in user session is required.");
    }

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required (tenantid header).");
    }

    // Access check under the USER's permissions (null when not allowed).
    const project: Project | null = await ProjectService.findOneById({
      id: props.tenantId,
      select: { _id: true },
      props: props,
    });

    if (!project) {
      throw new NotAuthorizedException(
        "Project not found (or you do not have access to it).",
      );
    }

    return props;
  }
}
