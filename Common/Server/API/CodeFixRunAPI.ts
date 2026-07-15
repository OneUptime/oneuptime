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
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Select from "../Types/Database/Select";
import { JSONObject } from "../../Types/JSON";
import AIRunType from "../../Types/AI/AIRunType";
import { CodeFixTaskTypeHelper } from "../../Types/AI/CodeFixTaskType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import Project from "../../Models/DatabaseModels/Project";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectService from "../Services/ProjectService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";

const MAX_EVENTS: number = 500;

/*
 * The AI fix task detail page's event trail.
 *
 * The LIST page does NOT come through here — it reads AIRuns through the
 * standard /ai-run CRUD, which AIRunService opens up for code-fix runs via a
 * forced `runType = CodeFix OR userId = <caller>` clause (see
 * Utils/AI/AIRunPrivacyFilter).
 *
 * The events cannot follow. AIRunEvent has NO runType column to key that
 * clause off, and "userId is null" does not mean "system-authored" — the
 * investigation engine writes null-userId events too — so project-scoping
 * AIRunEvent wholesale would expose other members' CHAT toolArguments, which
 * carry user-typed prompt content. Events are therefore still reached only
 * through a run this endpoint has already authorized as runType = CodeFix.
 *
 * Access is gated explicitly, the same pattern as AIInvestigationAPI: confirm
 * the caller can read the parent object (the project) under THEIR permissions,
 * then read the run and its events as root.
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
  codeFixTaskType: true,
  attemptCount: true,
  llmCallCount: true,
  toolCallCount: true,
  /*
   * Deliberately NOT selected: totalCostInUSDCents. This endpoint's gate is
   * Project read, which admits roles beyond AIRun's own table ACL, so it must
   * not return more than the detail page renders — and nothing there renders
   * per-run spend.
   */
};

/*
 * Serialize a run with codeFixTaskType normalized: a null column means
 * FixException (rows created before task recipes existed), and clients
 * should never have to know about the legacy null.
 */
function runToJson(run: AIRun): JSONObject {
  const runJson: JSONObject = BaseModel.toJSONArray([run], AIRun)[0] || {};

  runJson["codeFixTaskType"] = CodeFixTaskTypeHelper.fromDatabaseValue(
    run.codeFixTaskType,
  );

  return runJson;
}

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
            run: runToJson(run),
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
