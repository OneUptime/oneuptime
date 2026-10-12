import ToolImportRun from "../../Models/DatabaseModels/ToolImportRun";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { getToolImportSourceDefinition } from "../../Types/ToolImport/ToolImportCatalog";
import {
  countToolImportOutcomes,
  readToolImportReport,
  ToolImportPlan,
  ToolImportProgress,
  ToolImportReport,
  ToolImportRunView,
} from "../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  isToolImportResourceKind,
} from "../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "../../Types/ToolImport/ToolImportRunStatus";
import { isToolImportSource } from "../../Types/ToolImport/ToolImportSource";
import UserMiddleware from "../Middleware/UserAuthorization";
import ToolImportRunService from "../Services/ToolImportRunService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import CallerPlan from "../Utils/Billing/CallerPlan";
import CallerPermission from "../Utils/Permission/CallerPermission";
import Response from "../Utils/Response";
import ToolImportProjectStateReader, {
  TOOL_IMPORT_KIND_TARGETS,
} from "../Utils/ToolImport/ToolImportProjectStateReader";
import ToolImportRunExecutor from "../Utils/ToolImport/ToolImportRunExecutor";
import CommonAPI from "./CommonAPI";
import TeamMember from "../../Models/DatabaseModels/TeamMember";

/*
 * IMPORT FROM ANOTHER TOOL, OVER HTTP (Project Settings > Import from another
 * tool).
 *
 *   GET  /tool-import/runs                  the project's imports, newest first
 *   POST /tool-import/read                  read a tool: { source, region, apiKey },
 *                                           plus apiKeyId (Splunk On-Call) or
 *                                           apiUrl (Grafana OnCall)
 *   POST /tool-import/upload                read a tool's file: { source,
 *                                           fileName, content } (Uptime Kuma)
 *   GET  /tool-import/run/:runId            one import: its status, progress,
 *                                           the preview (while it waits to be
 *                                           started) and the report
 *   POST /tool-import/run/:runId/start      { selectedKeys, inviteTeamId }
 *   POST /tool-import/run/:runId/cancel     discard a preview
 *
 * A bare router (as OnCallReadinessAPI): the runs are internal rows with no
 * CRUD API, read here as root, so these handlers are the whole gate:
 *
 *  - Every route needs a person signed in to the project
 *    (assertAuthenticatedProjectMember). An import acts as a person - it
 *    invites people in their name and creates records as them - so a
 *    project API key cannot start one.
 *  - Reading a tool needs the right to create at least one thing it brings
 *    over: what the person may not create is skipped in the preview anyway,
 *    so someone who may create nothing is refused before the tool is called.
 *  - A run's preview, and starting or discarding it, belong to the person
 *    who read the tool. Project owners and admins see every import's status
 *    and report; everyone else sees their own.
 *  - The API key goes in once, in the read request, and never comes back:
 *    no response here selects it, and its column is readable by nobody.
 */
const router: ExpressRouter = Express.getRouter();

const RUN_LIST_LIMIT: number = 20;

const SEES_EVERY_IMPORT: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

function canSeeEveryImport(props: DatabaseCommonInteractionProps): boolean {
  return CallerPermission.holdsAnyOf(props, SEES_EVERY_IMPORT);
}

function readRunId(req: ExpressRequest): ObjectID {
  const runId: string | undefined = req.params["runId"];

  if (!runId || !ObjectID.isValidUUID(runId)) {
    throw new BadDataException("This import was not found.");
  }

  return new ObjectID(runId);
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

const RUN_VIEW_SELECT: {
  [key: string]: boolean | { [key: string]: boolean };
} = {
  _id: true,
  projectId: true,
  source: true,
  region: true,
  status: true,
  accountName: true,
  progress: true,
  report: true,
  error: true,
  createdAt: true,
  completedAt: true,
  createdByUserId: true,
  createdByUser: {
    name: true,
    email: true,
  },
};

export function toToolImportRunView(
  run: ToolImportRun,
  props: DatabaseCommonInteractionProps,
): ToolImportRunView {
  const report: ToolImportReport | null = run.report
    ? readToolImportReport(run.report)
    : null;

  const view: ToolImportRunView = {
    id: run.id!.toString(),
    source: run.source!,
    status: run.status!,
    createdAt: (run.createdAt || new Date()).toISOString(),
    isMine: Boolean(
      props.userId &&
        run.createdByUserId?.toString() === props.userId.toString(),
    ),
  };

  if (run.completedAt) {
    view.completedAt = new Date(run.completedAt).toISOString();
  }

  if (run.accountName) {
    view.accountName = run.accountName;
  }

  if (run.region) {
    view.region = run.region;
  }

  const userName: string =
    run.createdByUser?.name?.toString() ||
    run.createdByUser?.email?.toString() ||
    "";

  if (userName) {
    view.createdByUserName = userName;
  }

  const progress: ToolImportProgress | null = readProgress(run.progress);

  if (progress) {
    view.progress = progress;
  }

  if (run.error) {
    view.error = run.error;
  }

  if (report) {
    view.counts = countToolImportOutcomes(report);
  }

  return view;
}

function readProgress(value: unknown): ToolImportProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const done: number = Number(record["done"]);
  const total: number = Number(record["total"]);

  if (!Number.isFinite(done) || !Number.isFinite(total)) {
    return null;
  }

  const progress: ToolImportProgress = {
    done: Math.max(0, done),
    total: Math.max(0, total),
  };

  if (isToolImportResourceKind(record["kind"])) {
    progress.kind = record["kind"] as ToolImportResourceKind;
  }

  return progress;
}

/*
 * The props of a person signed in to the project, with the project's plan,
 * or a refusal: imports act as a person.
 */
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

async function findRunForCaller(data: {
  runId: ObjectID;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  select?: { [key: string]: boolean | { [key: string]: boolean } } | undefined;
}): Promise<ToolImportRun> {
  const run: ToolImportRun | null = await ToolImportRunService.findOneBy({
    query: {
      _id: data.runId.toString(),
      projectId: data.projectId,
    },
    select: (data.select || RUN_VIEW_SELECT) as never,
    props: { isRoot: true },
  });

  const isMine: boolean = Boolean(
    run &&
      data.props.userId &&
      run.createdByUserId?.toString() === data.props.userId.toString(),
  );

  if (!run || (!isMine && !canSeeEveryImport(data.props))) {
    throw new BadDataException("This import was not found.");
  }

  return run;
}

router.get(
  "/tool-import/runs",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      const runs: Array<ToolImportRun> = await ToolImportRunService.findBy({
        query: canSeeEveryImport(props)
          ? { projectId: projectId }
          : { projectId: projectId, createdByUserId: props.userId! },
        select: RUN_VIEW_SELECT as never,
        sort: { createdAt: SortOrder.Descending },
        limit: RUN_LIST_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

      return Response.sendJsonObjectResponse(req, res, {
        runs: runs.map((run: ToolImportRun): JSONObject => {
          return toToolImportRunView(run, props) as unknown as JSONObject;
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/tool-import/read",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      if (!isToolImportSource(body["source"])) {
        throw new BadDataException("Choose a tool to import from.");
      }

      ToolImportAPIAccess.assertCanImportAnything({
        props: props,
        kinds: getToolImportSourceDefinition(body["source"]).kinds,
      });

      const runId: ObjectID = await ToolImportRunExecutor.startRead({
        projectId: projectId,
        userId: props.userId!,
        source: body["source"],
        region: body["region"],
        apiKey: body["apiKey"],
        apiKeyId: body["apiKeyId"],
        apiUrl: body["apiUrl"],
      });

      return Response.sendJsonObjectResponse(req, res, {
        runId: runId.toString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

/*
 * A tool read from a file (Uptime Kuma's backup or metrics page): the
 * file's text, read in the browser, comes in once and is read at once into
 * a preview. It is never stored. Same gate as a read.
 */
router.post(
  "/tool-import/upload",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      if (!isToolImportSource(body["source"])) {
        throw new BadDataException("Choose a tool to import from.");
      }

      ToolImportAPIAccess.assertCanImportAnything({
        props: props,
        kinds: getToolImportSourceDefinition(body["source"]).kinds,
      });

      const runId: ObjectID = await ToolImportRunExecutor.startUpload({
        projectId: projectId,
        userId: props.userId!,
        source: body["source"],
        fileName: body["fileName"],
        content: body["content"],
      });

      return Response.sendJsonObjectResponse(req, res, {
        runId: runId.toString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/tool-import/run/:runId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const runId: ObjectID = readRunId(req);

      const run: ToolImportRun = await findRunForCaller({
        runId: runId,
        projectId: projectId,
        props: props,
      });

      const view: ToolImportRunView = toToolImportRunView(run, props);
      const response: JSONObject = {
        run: view as unknown as JSONObject,
      };

      if (run.status === ToolImportRunStatus.ReadyToReview && view.isMine) {
        if (ToolImportRunExecutor.isReviewExpired(run)) {
          view.status = ToolImportRunStatus.Expired;
        } else {
          const withSnapshot: ToolImportRun = await findRunForCaller({
            runId: runId,
            projectId: projectId,
            props: props,
            select: {
              _id: true,
              source: true,
              snapshot: true,
              createdByUserId: true,
            },
          });

          const plan: ToolImportPlan = await ToolImportRunExecutor.getPlan({
            run: withSnapshot,
            projectId: projectId,
            props: props,
          });

          response["plan"] = plan as unknown as JSONObject;
        }
      }

      if (run.report) {
        response["report"] = readToolImportReport(
          run.report,
        ) as unknown as JSONObject;
      }

      return Response.sendJsonObjectResponse(req, res, response);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/tool-import/run/:runId/start",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      await ToolImportRunExecutor.startImport({
        runId: readRunId(req),
        projectId: projectId,
        props: props,
        selection: readBody(req),
      });

      return Response.sendJsonObjectResponse(req, res, { started: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/tool-import/run/:runId/cancel",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      await ToolImportRunExecutor.cancel({
        runId: readRunId(req),
        projectId: projectId,
        props: props,
      });

      return Response.sendJsonObjectResponse(req, res, { cancelled: true });
    } catch (err) {
      next(err);
    }
  },
);

export class ToolImportAPIAccess {
  /*
   * Refused unless the person may create at least one kind of thing the
   * tool brings over (or invite people), on the project's plan.
   */
  public static assertCanImportAnything(data: {
    props: DatabaseCommonInteractionProps;
    kinds: Array<ToolImportResourceKind>;
  }): void {
    for (const kind of data.kinds) {
      const allowed: boolean =
        kind === ToolImportResourceKind.Person
          ? !ToolImportProjectStateReader.getCreateRefusal(
              [TeamMember],
              data.props,
            )
          : !ToolImportProjectStateReader.getCreateRefusal(
              TOOL_IMPORT_KIND_TARGETS[kind].createModels,
              data.props,
            );

      if (allowed) {
        return;
      }
    }

    throw new NotAuthorizedException(
      "You may not create anything an import brings over. Ask a project owner or admin to run the import.",
    );
  }
}

export default router;
