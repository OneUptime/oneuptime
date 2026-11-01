import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import AIRun from "../../Models/DatabaseModels/AIRun";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TelemetryExceptionService, {
  DashboardServiceSummary,
  DashboardSummaryResult,
  ExceptionOfGroup,
  Service as TelemetryExceptionServiceType,
} from "../Services/TelemetryExceptionService";
import { AIFixReadiness } from "../../Types/AI/AIFixReadiness";
import AIRunService from "../Services/AIRunService";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import FixProductionCheck, {
  FixProductionCheckHelper,
} from "../../Types/AI/FixProductionCheck";
import AIAgentTaskPullRequestService from "../Services/AIAgentTaskPullRequestService";
import QueryHelper from "../Types/Database/QueryHelper";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import logger from "../Utils/Logger";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIRunStatus, { AIRunStatusHelper } from "../../Types/AI/AIRunStatus";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ExceptionExplainer, {
  ExceptionExplanationResult,
} from "../Utils/AI/TelemetryAi/ExceptionExplanation";
import ExceptionDigester, {
  ExceptionDigestResult,
} from "../Utils/AI/TelemetryAi/ExceptionDigest";
import ExceptionDuplicateChecker, {
  ExceptionDuplicateCheckResult,
} from "../Utils/AI/TelemetryAi/ExceptionDuplicateCheck";
import SimilarExceptionsReader from "../Utils/Telemetry/SimilarExceptionsReader";
import { SimilarException } from "../../Types/Telemetry/SimilarExceptions";
import ExceptionListStatsReader from "../Utils/Telemetry/ExceptionListStatsReader";
import { ExceptionListStats } from "../../Types/Telemetry/ExceptionListStats";
import {
  ExceptionOfFingerprint,
  MAX_EXCEPTION_FINGERPRINT_LENGTH,
  MAX_EXCEPTION_FINGERPRINT_LOOKUP,
} from "../../Types/Telemetry/ExceptionFingerprintLookup";
import {
  ExceptionGroupFingerprintsOfException,
  MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP,
} from "../../Types/Telemetry/ExceptionGroupFingerprints";
import TelemetryExceptionMerge, {
  ExceptionMergeResult,
  ExceptionUnmergeResult,
} from "../Utils/Telemetry/TelemetryExceptionMerge";

/*
 * User-facing wording for a code-fix run's status on the exception page —
 * the AIRun analogue of the old AIAgentTaskStatusHelper titles.
 */
const CODE_FIX_STATUS_TEXT: {
  [key in AIRunStatus]: { title: string; description: string };
} = {
  [AIRunStatus.Queued]: {
    title: "Queued",
    description:
      "The fix task is queued and waiting to be picked up by an AI agent.",
  },
  [AIRunStatus.Running]: {
    title: "In Progress",
    description: "An AI agent is working on a fix for this exception.",
  },
  [AIRunStatus.WaitingForApproval]: {
    title: "Waiting for Approval",
    description: "The run is paused waiting for an approval.",
  },
  [AIRunStatus.Completed]: {
    title: "Completed",
    description:
      "The AI agent finished. Review the pull request it opened for the proposed fix.",
  },
  [AIRunStatus.NoFixFound]: {
    title: "No Fix Found",
    description:
      "The AI agent reviewed the code and did not find a fix to propose, so it opened no pull request.",
  },
  [AIRunStatus.Error]: {
    title: "Error",
    description: "The AI agent could not complete the fix.",
  },
  [AIRunStatus.Cancelled]: {
    title: "Cancelled",
    description: "The fix task was cancelled before an agent completed it.",
  },
  [AIRunStatus.Stale]: {
    title: "Stale",
    description:
      "The AI agent stopped reporting progress and the run was marked as stale. You can retry the fix.",
  },
};

export default class TelemetryExceptionAPI extends BaseAPI<
  TelemetryException,
  TelemetryExceptionServiceType
> {
  public constructor() {
    super(TelemetryException, TelemetryExceptionService);

    // Create AI Agent Task for an exception
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/create-ai-agent-task/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.createAIAgentTask(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Get AI Agent Task for an exception
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/get-ai-agent-task/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getAIAgentTaskForException(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Everything "Fix with AI Agent" needs, checked up front so the
     * dashboard can render a setup checklist instead of a button that
     * fails minutes later inside the agent container.
     */
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/ai-fix-readiness/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getAIFixReadiness(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * OneUptime AI's explanation of the exception: what happened, the likely
     * root cause and a suggested fix (ExceptionExplainer), kept on the
     * exception and returned. Anyone who may read the exception may ask for
     * one; the project's Enable AI switch, credits and limits apply.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/ai-explanation/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.explainWithAI(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The exceptions that look like this one (SimilarExceptionsReader), read
     * as the caller: no AI, so anyone who may read the exception may ask.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/similar/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.findSimilar(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * OneUptime AI's verdict on each similar exception - duplicate, related
     * or different (ExceptionDuplicateChecker). The project's Enable AI
     * switch, credits and limits apply; with none similar, no model is
     * asked.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/similar-ai-check/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.checkDuplicatesWithAI(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * OneUptime AI's summary of the project's exceptions that are new, or
     * came back after they were resolved, in the last day
     * (ExceptionDigester): read as the caller, not kept. The project's
     * Enable AI switch, credits and limits apply; with nothing new, no
     * model is asked.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/ai-digest`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.digestWithAI(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The numbers beside each row of the exceptions list, for one page:
     * each exception's affected users and its occurrences over the list's
     * range (ExceptionListStatsReader), read as the caller. No AI, so
     * anyone who may read the exceptions may ask.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/list-stats`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getListStats(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The exception each of a batch of fingerprints of occurrences counts
     * on - its own, or the one it was merged into - as a session replay
     * links the exceptions it names (findByOccurrenceFingerprints). Read as
     * the caller: only the exceptions they may read are answered.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/by-fingerprints`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.findByFingerprints(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The fingerprints the occurrences of each of a batch of exceptions
     * carry: its own, then those of the exceptions merged into it
     * (TelemetryExceptionService.getGroupFingerprints) - what an
     * exception's page reads its security events by, and what the
     * Exceptions monitor form's preview leaves out with a resolved one.
     * Read as the caller: only the exceptions they may read are answered.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/group-fingerprints`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.findGroupFingerprints(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Merge other exceptions into this one as the same bug, and undo it
     * (TelemetryExceptionMerge). Both take permission to edit the
     * exceptions involved.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/merge/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.mergeExceptions(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/unmerge/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.unmergeException(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Aggregated dashboard summary for the Exceptions overview page.
     * Returns counts, top/recent exceptions, and per-service summaries
     * in a single round-trip with one SQL GROUP BY for service aggregation.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/dashboard-summary`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getDashboardSummary(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async explainWithAI(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const idParam: string | undefined = req.params["telemetryExceptionId"];

    if (!idParam) {
      throw new BadDataException("Telemetry Exception ID is required");
    }

    // ObjectID takes any string: a malformed one is refused here.
    if (!ObjectID.isValidUUID(idParam)) {
      throw new BadDataException("Invalid Telemetry Exception ID");
    }

    const telemetryExceptionId: ObjectID = new ObjectID(idParam);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const result: ExceptionExplanationResult = await ExceptionExplainer.explain(
      { telemetryExceptionId, props },
    );

    return Response.sendJsonObjectResponse(req, res, {
      explanation: result.explanation as unknown as JSONObject,
      generatedAt: result.generatedAt.toISOString(),
    });
  }

  // The exception's id from the path; ObjectID takes any string.
  private readExceptionId(req: ExpressRequest): ObjectID {
    const idParam: string | undefined = req.params["telemetryExceptionId"];

    if (!idParam) {
      throw new BadDataException("Telemetry Exception ID is required");
    }

    if (!ObjectID.isValidUUID(idParam)) {
      throw new BadDataException("Invalid Telemetry Exception ID");
    }

    return new ObjectID(idParam);
  }

  private async findSimilar(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const telemetryExceptionId: ObjectID = this.readExceptionId(req);
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const similar: Array<SimilarException> = await SimilarExceptionsReader.find(
      { telemetryExceptionId, props },
    );

    return Response.sendJsonObjectResponse(req, res, {
      similar: similar as unknown as JSONArray,
    });
  }

  private async mergeExceptions(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Refused before anything is read: the survivor's id, then the others'.
    const telemetryExceptionId: ObjectID = this.readExceptionId(req);
    const body: JSONObject = (req.body as JSONObject) || {};
    const mergedTelemetryExceptionIds: Array<ObjectID> =
      TelemetryExceptionMerge.readIds(body["mergedTelemetryExceptionIds"]);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const result: ExceptionMergeResult = await TelemetryExceptionMerge.merge({
      telemetryExceptionId,
      mergedTelemetryExceptionIds,
      props,
    });

    return Response.sendJsonObjectResponse(req, res, {
      telemetryExceptionId: result.telemetryExceptionId,
      merged: result.merged as unknown as JSONArray,
    });
  }

  private async unmergeException(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const telemetryExceptionId: ObjectID = this.readExceptionId(req);
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const result: ExceptionUnmergeResult =
      await TelemetryExceptionMerge.unmerge({ telemetryExceptionId, props });

    return Response.sendJsonObjectResponse(req, res, {
      telemetryExceptionId: result.telemetryExceptionId,
      unmergedFromTelemetryExceptionId: result.unmergedFromTelemetryExceptionId,
      outcome: result.outcome,
    });
  }

  // The fingerprints a request asks about: each once, at most the most one request takes.
  public static readFingerprints(raw: unknown): Array<string> {
    if (!Array.isArray(raw)) {
      throw new BadDataException("fingerprints must be a list");
    }

    if (raw.length > MAX_EXCEPTION_FINGERPRINT_LOOKUP) {
      throw new BadDataException(
        `Ask about at most ${MAX_EXCEPTION_FINGERPRINT_LOOKUP} fingerprints at once`,
      );
    }

    const fingerprints: Array<string> = [];

    for (const value of raw) {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > MAX_EXCEPTION_FINGERPRINT_LENGTH
      ) {
        throw new BadDataException("Invalid fingerprint");
      }

      const fingerprint: string = value.trim();

      if (!fingerprints.includes(fingerprint)) {
        fingerprints.push(fingerprint);
      }
    }

    return fingerprints;
  }

  private async findByFingerprints(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const body: JSONObject = (req.body as JSONObject) || {};

    // Refused before anything is read.
    const fingerprints: Array<string> = TelemetryExceptionAPI.readFingerprints(
      body["fingerprints"],
    );

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const exceptionsByFingerprint: Map<
      string,
      Array<TelemetryException>
    > = fingerprints.length > 0
      ? await this.service.findByOccurrenceFingerprints({
          projectId: props.tenantId,
          fingerprints,
          select: {
            _id: true,
            fingerprint: true,
            exceptionType: true,
            message: true,
          },
          limit: fingerprints.length * 2,
          props,
        })
      : new Map();

    const exceptions: Array<ExceptionOfFingerprint> = [];

    for (const fingerprint of fingerprints) {
      for (const exception of exceptionsByFingerprint.get(fingerprint) || []) {
        if (!exception.id) {
          continue;
        }

        exceptions.push({
          fingerprint,
          telemetryExceptionId: exception.id.toString(),
          exceptionType: exception.exceptionType || null,
          message: exception.message || null,
        });
      }
    }

    return Response.sendJsonObjectResponse(req, res, {
      exceptions: exceptions as unknown as JSONArray,
    });
  }

  // The exceptions a group fingerprint request names: ids, each once.
  public static readGroupFingerprintIds(raw: unknown): Array<ObjectID> {
    if (!Array.isArray(raw)) {
      throw new BadDataException("telemetryExceptionIds must be a list");
    }

    if (raw.length > MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP) {
      throw new BadDataException(
        `Ask about at most ${MAX_EXCEPTION_GROUP_FINGERPRINTS_LOOKUP} exceptions at once`,
      );
    }

    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const value of raw) {
      if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
        throw new BadDataException("Invalid Telemetry Exception ID");
      }

      if (!seen.has(value.toLowerCase())) {
        seen.add(value.toLowerCase());
        ids.push(new ObjectID(value));
      }
    }

    return ids;
  }

  private async findGroupFingerprints(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const body: JSONObject = (req.body as JSONObject) || {};

    // Refused before anything is read.
    const ids: Array<ObjectID> = TelemetryExceptionAPI.readGroupFingerprintIds(
      body["telemetryExceptionIds"],
    );

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    // The ones the caller may read, merged ones named by id included.
    const exceptions: Array<TelemetryException> =
      ids.length > 0
        ? await this.service.findBy({
            query: {
              projectId: props.tenantId,
              _id: QueryHelper.any(ids),
            },
            select: { _id: true, fingerprint: true },
            limit: ids.length,
            skip: 0,
            props,
          })
        : [];

    const groups: Map<
      string,
      Array<string>
    > = await this.service.getGroupFingerprints({
      projectId: props.tenantId,
      exceptions: exceptions
        .filter((exception: TelemetryException): boolean => {
          return Boolean(exception.id && exception.fingerprint);
        })
        .map((exception: TelemetryException): ExceptionOfGroup => {
          return { id: exception.id!, fingerprint: exception.fingerprint! };
        }),
    });

    // In the order asked.
    const answer: Array<ExceptionGroupFingerprintsOfException> = [];

    for (const id of ids) {
      const fingerprints: Array<string> | undefined = groups.get(
        id.toString().toLowerCase(),
      );

      if (fingerprints) {
        answer.push({ telemetryExceptionId: id.toString(), fingerprints });
      }
    }

    return Response.sendJsonObjectResponse(req, res, {
      exceptions: answer as unknown as JSONArray,
    });
  }

  private async getListStats(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const body: JSONObject = (req.body as JSONObject) || {};

    // Refused before anything is read: ids, then the range.
    const telemetryExceptionIds: Array<ObjectID> =
      ExceptionListStatsReader.readIds(body["telemetryExceptionIds"]);

    const readTime: (key: string) => Date = (key: string): Date => {
      const value: unknown = body[key];

      if (typeof value !== "string" || value.length > 64) {
        throw new BadDataException(`${key} is required`);
      }

      // An ISO time, as the list sends it.
      const time: Date = new Date(value);

      if (Number.isNaN(time.getTime())) {
        throw new BadDataException(`Invalid ${key}`);
      }

      return time;
    };

    const startTime: Date = readTime("startTime");
    const endTime: Date = readTime("endTime");
    ExceptionListStatsReader.checkRange(startTime, endTime);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const stats: ExceptionListStats = await ExceptionListStatsReader.read({
      telemetryExceptionIds,
      startTime,
      endTime,
      props,
    });

    return Response.sendJsonObjectResponse(req, res, {
      stats: stats.items as unknown as JSONArray,
      bucketSizeInSeconds: stats.bucketSizeInSeconds,
      startTime: stats.startTime,
      endTime: stats.endTime,
    });
  }

  private async checkDuplicatesWithAI(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const telemetryExceptionId: ObjectID = this.readExceptionId(req);
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const result: ExceptionDuplicateCheckResult =
      await ExceptionDuplicateChecker.check({ telemetryExceptionId, props });

    return Response.sendJsonObjectResponse(req, res, {
      similar: result.similar as unknown as JSONArray,
      verdicts: result.verdicts as unknown as JSONArray,
      generatedAt: result.generatedAt.toISOString(),
    });
  }

  private async digestWithAI(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const result: ExceptionDigestResult = await ExceptionDigester.digest({
      projectId: props.tenantId,
      props,
    });

    return Response.sendJsonObjectResponse(req, res, {
      digest: result.digest as unknown as JSONObject,
      exceptionCount: result.exceptionCount,
      generatedAt: result.generatedAt.toISOString(),
      windowHours: result.windowHours,
    });
  }

  private async createAIAgentTask(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const telemetryExceptionIdParam: string | undefined =
      req.params["telemetryExceptionId"];

    if (!telemetryExceptionIdParam) {
      throw new BadDataException("Telemetry Exception ID is required");
    }

    let telemetryExceptionId: ObjectID;

    try {
      telemetryExceptionId = new ObjectID(telemetryExceptionIdParam);
    } catch {
      throw new BadDataException("Invalid Telemetry Exception ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    /*
     * Optional body: { taskType?: "FixException" | "WriteRegressionTest" }.
     * Unknown strings are rejected here; known-but-not-yet-triggerable
     * recipes (ImproveInstrumentation, ...) are rejected by the service.
     */
    const body: JSONObject = (req.body as JSONObject) || {};

    let taskType: CodeFixTaskType = CodeFixTaskType.FixException;

    if (body["taskType"] !== undefined && body["taskType"] !== null) {
      const rawTaskType: unknown = body["taskType"];

      if (
        typeof rawTaskType !== "string" ||
        !CodeFixTaskTypeHelper.isValidTaskType(rawTaskType)
      ) {
        throw new BadDataException(
          `Invalid taskType. Valid values: ${Object.values(
            CodeFixTaskType,
          ).join(", ")}.`,
        );
      }

      taskType = rawTaskType;
    }

    // Create the code-fix AIRun using the service
    const createdRun: AIRun = await this.service.createCodeFixRunForException({
      telemetryExceptionId,
      props,
      taskType,
    });

    /*
     * `aiAgentTaskId` is the legacy JSON key the dashboard still navigates
     * with — it now carries the AIRun id. `aiRunId` is the honest name.
     */
    return Response.sendJsonObjectResponse(req, res, {
      aiAgentTaskId: createdRun.id!.toString(),
      aiRunId: createdRun.id!.toString(),
      taskType: taskType,
    });
  }

  private async getAIAgentTaskForException(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const telemetryExceptionIdParam: string | undefined =
      req.params["telemetryExceptionId"];

    if (!telemetryExceptionIdParam) {
      throw new BadDataException("Telemetry Exception ID is required");
    }

    let telemetryExceptionId: ObjectID;

    try {
      telemetryExceptionId = new ObjectID(telemetryExceptionIdParam);
    } catch {
      throw new BadDataException("Invalid Telemetry Exception ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    /*
     * Access check under the USER's permissions: code-fix runs are
     * system-written AIRuns (hidden from the caller by the per-user privacy
     * pin on the generic CRUD), so confirm the caller can read the
     * exception first and then read the run as root — the same pattern as
     * AIInvestigationAPI.
     */
    const telemetryException: TelemetryException | null =
      await this.service.findOneById({
        id: telemetryExceptionId,
        select: {
          _id: true,
        },
        props,
      });

    if (!telemetryException) {
      throw new BadDataException(
        "Telemetry Exception not found (or you do not have access to it).",
      );
    }

    /*
     * Return the LATEST run PER TASK TYPE (at most one per CodeFixTaskType,
     * newest first) so the exception page can show a FixException run and a
     * WriteRegressionTest run side by side. Runs are returned regardless of
     * status: errored runs must stay visible (a failed fix must not silently
     * vanish with the button just reappearing).
     *
     * Back-compat: `hasActiveTask` / `aiAgentTask` still reflect the latest
     * run OVERALL, for clients that predate task recipes.
     */
    const runs: Array<AIRun> =
      await AIRunService.getLatestCodeFixRunPerTaskType({
        telemetryExceptionId,
      });

    if (runs.length === 0) {
      return Response.sendJsonObjectResponse(req, res, {
        hasActiveTask: false,
        aiAgentTask: null,
        aiAgentTasks: [],
      });
    }

    /*
     * Whether each run's merged fix fixed the exception in production
     * (FixProductionVerifier), read as root like the runs themselves: the
     * caller may read the exception, and these are its runs' pull requests.
     */
    const productionByRunId: Map<string, JSONObject> =
      await this.readFixProduction(runs);

    const toTaskJson: (run: AIRun) => JSONObject = (run: AIRun): JSONObject => {
      const status: AIRunStatus = run.status || AIRunStatus.Queued;
      const production: JSONObject | undefined = productionByRunId.get(
        run.id?.toString() || "",
      );

      return {
        _id: run.id?.toString(),
        status: status,
        statusMessage: run.errorMessage,
        statusTitle: CODE_FIX_STATUS_TEXT[status]?.title,
        statusDescription: CODE_FIX_STATUS_TEXT[status]?.description,
        createdAt: run.createdAt,
        // Normalized by the service: legacy null rows read as FixException.
        taskType: CodeFixTaskTypeHelper.fromDatabaseValue(run.codeFixTaskType),
        ...(production ? { production } : {}),
      };
    };

    // Newest first — the first element is the latest run overall.
    const latestRunOverall: AIRun = runs[0]!;
    const latestStatus: AIRunStatus =
      latestRunOverall.status || AIRunStatus.Queued;

    return Response.sendJsonObjectResponse(req, res, {
      hasActiveTask: !AIRunStatusHelper.isTerminalStatus(latestStatus),
      aiAgentTask: toTaskJson(latestRunOverall),
      aiAgentTasks: runs.map(toTaskJson),
    });
  }

  /*
   * The production verdict of each run's merged fix pull request: the one
   * whose status changed last, when a run opened more than one.
   */
  private async readFixProduction(
    runs: Array<AIRun>,
  ): Promise<Map<string, JSONObject>> {
    const byRunId: Map<string, JSONObject> = new Map<string, JSONObject>();
    const runIds: Array<ObjectID> = runs
      .map((run: AIRun): ObjectID | undefined => {
        return run.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (runIds.length === 0) {
      return byRunId;
    }

    try {
      const pullRequests: Array<AIAgentTaskPullRequest> =
        await AIAgentTaskPullRequestService.findBy({
          query: {
            aiRunId: QueryHelper.any(runIds),
            productionStatus: QueryHelper.notNull(),
          } as never,
          select: {
            _id: true,
            aiRunId: true,
            pullRequestUrl: true,
            productionStatus: true,
            productionCheck: true,
            productionStatusAt: true,
            productionSummary: true,
            deployedAt: true,
            deployedVersion: true,
            deployedCommitSha: true,
          },
          sort: { productionStatusAt: SortOrder.Descending } as never,
          limit: runIds.length * 5,
          skip: 0,
          props: { isRoot: true },
        });

      for (const pullRequest of pullRequests) {
        const runId: string = pullRequest.aiRunId?.toString() || "";

        if (!runId || byRunId.has(runId)) {
          continue;
        }

        byRunId.set(runId, {
          status: pullRequest.productionStatus || null,
          // An exception's fixes are watched for the exception.
          check:
            FixProductionCheckHelper.fromDatabaseValue(
              pullRequest.productionCheck,
            ) || FixProductionCheck.Exception,
          summary: pullRequest.productionSummary || null,
          statusAt: pullRequest.productionStatusAt || null,
          deployedAt: pullRequest.deployedAt || null,
          deployedVersion: pullRequest.deployedVersion || null,
          deployedCommitSha: pullRequest.deployedCommitSha || null,
          pullRequestUrl: pullRequest.pullRequestUrl?.toString() || null,
        } as JSONObject);
      }
    } catch (error) {
      // The panel still shows the runs; only their production line is missing.
      logger.error(
        `Could not read the production verdicts of the exception's fixes: ${error}`,
      );
    }

    return byRunId;
  }

  private async getAIFixReadiness(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const telemetryExceptionIdParam: string | undefined =
      req.params["telemetryExceptionId"];

    if (!telemetryExceptionIdParam) {
      throw new BadDataException("Telemetry Exception ID is required");
    }

    let telemetryExceptionId: ObjectID;

    try {
      telemetryExceptionId = new ObjectID(telemetryExceptionIdParam);
    } catch {
      throw new BadDataException("Invalid Telemetry Exception ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const readiness: AIFixReadiness = await this.service.getAIFixReadiness({
      telemetryExceptionId,
      props,
    });

    return Response.sendJsonObjectResponse(req, res, {
      ready: readiness.ready,
      checks: readiness.checks as unknown as JSONArray,
    });
  }

  private async getDashboardSummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const summary: DashboardSummaryResult =
      await this.service.getDashboardSummary(props);

    const topExceptionsJson: JSONArray = BaseModel.toJSONArray(
      summary.topExceptions,
      TelemetryException,
    );

    const recentExceptionsJson: JSONArray = BaseModel.toJSONArray(
      summary.recentExceptions,
      TelemetryException,
    );

    const serviceSummariesJson: JSONArray = summary.serviceSummaries.map(
      (entry: DashboardServiceSummary): JSONObject => {
        /*
         * serviceId is polymorphic; the client resolves the display name
         * per serviceType (no Service relation to serialize anymore).
         */
        return {
          primaryEntityId: entry.primaryEntityId,
          primaryEntityType: entry.primaryEntityType,
          unresolvedCount: entry.unresolvedCount,
          totalOccurrences: entry.totalOccurrences,
        };
      },
    );

    return Response.sendJsonObjectResponse(req, res, {
      unresolvedCount: summary.unresolvedCount,
      resolvedCount: summary.resolvedCount,
      archivedCount: summary.archivedCount,
      topExceptions: topExceptionsJson,
      recentExceptions: recentExceptionsJson,
      serviceSummaries: serviceSummariesJson,
    });
  }
}
