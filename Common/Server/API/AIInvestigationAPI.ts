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
import Query from "../../Types/BaseDatabase/Query";
import { JSONArray, JSONObject } from "../../Types/JSON";
import AIRunType from "../../Types/AI/AIRunType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import Service from "../../Models/DatabaseModels/Service";
import Span from "../../Models/AnalyticsModels/Span";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentService from "../Services/IncidentService";
import AlertService from "../Services/AlertService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";
import ServiceService from "../Services/ServiceService";
import SpanService from "../Services/SpanService";
import FixFromIncidentTaskTrigger from "../Utils/AI/Sentinel/FixFromIncidentTaskTrigger";
import FixPerformanceTaskTrigger from "../Utils/AI/Sentinel/FixPerformanceTaskTrigger";
import { AnalyzableSpan } from "../Utils/AI/PerfEvidence/SpanTreeAnalyzer";

const router: ExpressRouter = Express.getRouter();

/*
 * Upper bound on spans analyzed for one performance-fix trigger — mirrors
 * the trace waterfall's own cap (TraceTools.MAX_TRACE_SPANS). Findings are
 * computed over the first 500 spans by start time; a truncated giant trace
 * still yields honest evidence about the loaded portion.
 */
const MAX_ANALYZED_TRACE_SPANS: number = 500;

const MAX_EVENTS: number = 500;

/*
 * Returns the latest Sentinel investigation (the AIRun + its ordered
 * AIRunEvents) for an incident or alert, so the dashboard can render a live
 * "watch it think" panel.
 *
 * Investigation runs are system-authored (userId = null) and are therefore
 * hidden by the per-user privacy pin on the generic AIRun / AIRunEvent CRUD. So
 * we gate access explicitly here: first confirm the caller can read the
 * incident/alert under THEIR permissions, then read the run + events as root.
 */

async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  if (!props.userId) {
    throw new NotAuthorizedException("A logged-in user session is required.");
  }

  return props;
}

/*
 * Read the latest investigation run + its events as root (bypasses the
 * per-user pin) and send them. Callers must have already access-checked the
 * subject under the USER's permissions.
 */
async function sendLatestInvestigation(
  req: ExpressRequest,
  res: ExpressResponse,
  runQuery: Query<AIRun>,
): Promise<void> {
  const runs: Array<AIRun> = await AIRunService.findBy({
    query: runQuery,
    select: {
      _id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      errorMessage: true,
      llmCallCount: true,
      toolCallCount: true,
      totalTokens: true,
      createdAt: true,
    },
    sort: { createdAt: SortOrder.Descending },
    limit: 1,
    skip: 0,
    props: { isRoot: true },
  });

  const run: AIRun | undefined = runs[0];

  if (!run) {
    Response.sendJsonObjectResponse(req, res, {
      run: null,
      events: [],
    });
    return;
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

  const runJson: JSONObject | undefined = BaseModel.toJSONArray(
    [run],
    AIRun,
  )[0];

  const eventsJson: JSONArray = BaseModel.toJSONArray(events, AIRunEvent);

  Response.sendJsonObjectResponse(req, res, {
    run: runJson || null,
    events: eventsJson,
  });
}

router.post(
  "/ai-investigation/incident",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const incidentIdString: string | undefined = req.body["incidentId"] as
        | string
        | undefined;

      if (!incidentIdString) {
        throw new BadDataException("incidentId is required.");
      }

      const incidentId: ObjectID = new ObjectID(incidentIdString);

      // Access check under the USER's permissions (null when not allowed).
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: { _id: true },
        props,
      });

      if (!incident) {
        throw new BadDataException(
          "Incident not found (or you do not have access to it).",
        );
      }

      await sendLatestInvestigation(req, res, {
        triggeredByIncidentId: incidentId,
        runType: AIRunType.Investigation,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  "/ai-investigation/alert",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const alertIdString: string | undefined = req.body["alertId"] as
        | string
        | undefined;

      if (!alertIdString) {
        throw new BadDataException("alertId is required.");
      }

      const alertId: ObjectID = new ObjectID(alertIdString);

      // Access check under the USER's permissions (null when not allowed).
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        select: { _id: true },
        props,
      });

      if (!alert) {
        throw new BadDataException(
          "Alert not found (or you do not have access to it).",
        );
      }

      await sendLatestInvestigation(req, res, {
        triggeredByAlertId: alertId,
        runType: AIRunType.Investigation,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Human-triggered `code_fix` (the FixFromIncident recipe): after a Sentinel
 * investigation completes on an incident/alert, the user can ask the agent
 * to open a fix pull request from the posted analysis. The subject is
 * access-checked under the USER's permissions first (same idiom as the read
 * routes above); the trigger's gates (completed investigation, GitHub-App
 * repository, per-subject dedupe) fail early with a clear message.
 * Body: { subjectType: "incident" | "alert", subjectId }. Response:
 * { aiRunId } — the Queued CodeFix run the agent worker will claim.
 */
router.post(
  "/ai-investigation/create-fix-task",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const subjectType: string | undefined = req.body["subjectType"] as
        | string
        | undefined;

      if (subjectType !== "incident" && subjectType !== "alert") {
        throw new BadDataException(
          'subjectType must be "incident" or "alert".',
        );
      }

      const subjectIdString: string | undefined = req.body["subjectId"] as
        | string
        | undefined;

      if (!subjectIdString) {
        throw new BadDataException("subjectId is required.");
      }

      const subjectId: ObjectID = new ObjectID(subjectIdString);

      // Access check under the USER's permissions (null when not allowed).
      let projectId: ObjectID | undefined = undefined;

      if (subjectType === "incident") {
        const incident: Incident | null = await IncidentService.findOneById({
          id: subjectId,
          select: { _id: true, projectId: true },
          props,
        });

        if (!incident || !incident.projectId) {
          throw new BadDataException(
            "Incident not found (or you do not have access to it).",
          );
        }

        projectId = incident.projectId;
      } else {
        const alert: Alert | null = await AlertService.findOneById({
          id: subjectId,
          select: { _id: true, projectId: true },
          props,
        });

        if (!alert || !alert.projectId) {
          throw new BadDataException(
            "Alert not found (or you do not have access to it).",
          );
        }

        projectId = alert.projectId;
      }

      const run: AIRun =
        await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
          projectId,
          ...(subjectType === "incident"
            ? { incidentId: subjectId }
            : { alertId: subjectId }),
          userId: props.userId!,
        });

      Response.sendJsonObjectResponse(req, res, {
        aiRunId: run.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Human-triggered FixPerformance: from a slow trace, one click opens a
 * performance-fix PR grounded in deterministic span-tree evidence. The
 * spans are loaded under the USER's permissions (the same telemetry-read
 * ACL the trace explorer enforces — a user who cannot read the trace gets
 * "not found"), the SpanTreeAnalyzer gates on a mechanical finding, and
 * the trigger's remaining gates (GitHub-App repository, per-trace dedupe)
 * fail early with a clear message. Body: { traceId }. Response:
 * { aiRunId } — the Queued CodeFix run the agent worker will claim.
 */
router.post(
  "/ai-investigation/create-performance-fix-task",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const traceId: string | undefined = req.body["traceId"] as
        | string
        | undefined;

      if (!traceId) {
        throw new BadDataException("traceId is required.");
      }

      const projectId: ObjectID | undefined = props.tenantId;

      if (!projectId) {
        throw new BadDataException("A project scope is required.");
      }

      /*
       * Access check + data load in one: the analytics permission layer
       * pins this query to the user's tenant and telemetry-read
       * permissions (the Span model's read ACL — same enforcement the
       * trace explorer's list API applies). No spans back means the trace
       * does not exist or the user may not see it.
       */
      const spans: Array<Span> = await SpanService.findBy({
        query: {
          traceId: traceId,
        } as never,
        select: {
          spanId: true,
          parentSpanId: true,
          name: true,
          startTimeUnixNano: true,
          endTimeUnixNano: true,
          durationUnixNano: true,
          attributes: true,
          primaryEntityId: true,
        } as never,
        sort: {
          startTimeUnixNano: SortOrder.Ascending,
        } as never,
        limit: MAX_ANALYZED_TRACE_SPANS,
        skip: 0,
        props: props,
      });

      if (spans.length === 0) {
        throw new BadDataException(
          "Trace not found (or you do not have access to it).",
        );
      }

      // Nanoseconds -> milliseconds for the analyzer.
      const analyzableSpans: Array<AnalyzableSpan> = spans.map(
        (span: Span): AnalyzableSpan => {
          const attributes: Record<string, string> = {};

          for (const [key, value] of Object.entries(span.attributes || {})) {
            if (value !== null && value !== undefined) {
              attributes[key] = String(value);
            }
          }

          return {
            spanId: span.spanId?.toString() || "",
            parentSpanId: span.parentSpanId?.toString() || undefined,
            name: span.name || "",
            startMs: Number(span.startTimeUnixNano) / 1_000_000,
            endMs: Number(span.endTimeUnixNano) / 1_000_000,
            durationMs: Number(span.durationUnixNano) / 1_000_000,
            attributes,
          };
        },
      );

      /*
       * Best-effort service attribution: the trace's most frequent
       * primaryEntityId, resolved to a Service name when it IS a Service
       * (findOneById returns null for hosts/clusters/unattributed ids).
       * Only feeds the repository name-match fallback — null is fine.
       */
      const entityIdCounts: Map<string, number> = new Map();
      for (const span of spans) {
        const entityId: string | undefined = span.primaryEntityId?.toString();
        if (entityId) {
          entityIdCounts.set(entityId, (entityIdCounts.get(entityId) || 0) + 1);
        }
      }

      let dominantEntityId: string | null = null;
      let dominantEntityCount: number = 0;
      for (const [entityId, count] of entityIdCounts) {
        if (count > dominantEntityCount) {
          dominantEntityId = entityId;
          dominantEntityCount = count;
        }
      }

      const service: Service | null = dominantEntityId
        ? await ServiceService.findOneById({
            id: new ObjectID(dominantEntityId),
            select: { name: true },
            props: { isRoot: true },
          })
        : null;

      const run: AIRun =
        await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
          projectId,
          traceId,
          spans: analyzableSpans,
          serviceName: service?.name,
          userId: props.userId!,
        });

      Response.sendJsonObjectResponse(req, res, {
        aiRunId: run.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
