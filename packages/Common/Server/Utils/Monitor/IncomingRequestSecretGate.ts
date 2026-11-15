import MonitorService from "../../Services/MonitorService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import IncomingRequestReceivedAtStore from "./IncomingRequestReceivedAtStore";
import IncomingRequestSecretActivity from "./IncomingRequestSecretActivity";
import IncomingRequestSecretPolicy, {
  IncomingRequestSecretDecision,
  IncomingRequestSecretOfPolicy,
  IncomingRequestSecretPolicyValue,
  IncomingRequestSecretVerdict,
} from "./IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "./IncomingRequestSecretRequest";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
  MonitorSecretKeyKind,
} from "./MonitorSecretKeyCache";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
} from "../../../Utils/Monitor/MonitorPauseState";

/*
 * Where a project's incoming request secret requirement is enforced
 * (Types/Monitor/IncomingMonitor/IncomingRequestSecret, issue #7526): twice,
 * so a request that should be refused never counts for its monitor.
 *
 * AT THE EDGE - the ingest endpoint, before it answers (decideAtEdge).
 *
 *   It answers a refused request 401, with what to send, instead of the 200
 *   every request used to get: a sender being set up is told at once why its
 *   requests do not count. And it records a request's arrival for the
 *   heartbeat (IncomingRequestReceivedAtStore.advanceIfTracked) only once it
 *   has decided the request may count, so a request without the secret never
 *   keeps a silent monitor alive.
 *
 *   To decide, it needs the project of the URL's key. It has it when the key
 *   is in MonitorSecretKeyCache, and looks it up in Postgres only for a key a
 *   trusted caller has registered (IncomingRequestReceivedAtStore.isTracked):
 *   the endpoint is unauthenticated, and a flood of made-up keys must not
 *   become a flood of database reads. A key it cannot place - a new monitor's
 *   first request, one silent for a day, or a read that failed - goes on to
 *   the queue undecided, with its arrival unrecorded, and the worker decides.
 *
 * IN THE WORKER - before the request is tracked, kept or evaluated
 * (decideInWorker). Always, on the policy as it is when the job runs: the
 * edge may not have decided, and a secret deleted while the job waited no
 * longer counts. A refused request ends the job there: no arrival, no latest
 * request, no criteria.
 *
 * The secret never travels past the edge: X-OneUptime-Secret is taken off the
 * request there, and the job carries the SHA-256 of what was presented
 * (IncomingRequestSecretRequest). A bearer token that is one of the project's
 * secrets is masked by the worker before the request is kept.
 *
 * Both record, on the monitor, whether its requests send a valid secret
 * (IncomingRequestSecretActivity, issue #8498) while the project has one -
 * required yet or not: the edge for a request it refuses, which never reaches
 * the worker, and the worker for every request it processes.
 */

export interface IncomingRequestSecretEdgeDecision {
  /*
   * Whether the endpoint may record the request's arrival now: only when it
   * decided the request counts. Otherwise the worker records it, if it does.
   */
  mayRecordArrival: boolean;
  // Set when the request is refused: what the sender is told, with a 401.
  refusalMessage?: string | undefined;
}

export interface IncomingRequestSecretWorkerDecision {
  verdict: IncomingRequestSecretVerdict;
  isRefused: boolean;
  /*
   * The request's headers to keep and evaluate: without X-OneUptime-Secret,
   * and with a bearer token that is one of the project's secrets masked.
   */
  requestHeaders: Dictionary<string>;
}

export default class IncomingRequestSecretGate {
  @CaptureSpan()
  public static async decideAtEdge(data: {
    secretKey: string;
    presentedSecretHashes: Array<string>;
  }): Promise<IncomingRequestSecretEdgeDecision> {
    try {
      const monitorOfKey: MonitorOfSecretKey | null =
        await this.findMonitorAtEdge(data.secretKey);

      if (!monitorOfKey) {
        return { mayRecordArrival: false };
      }

      const policy: IncomingRequestSecretPolicyValue =
        await IncomingRequestSecretPolicy.getPolicy(monitorOfKey.projectId);

      const decision: IncomingRequestSecretDecision =
        IncomingRequestSecretPolicy.decide({
          policy,
          presentedSecretHashes: data.presentedSecretHashes,
        });

      if (IncomingRequestSecretPolicy.isRefused(decision.verdict)) {
        // It never reaches the worker: the monitor learns of it here.
        if (decision.sentValidSecret === false) {
          await IncomingRequestSecretActivity.record({
            monitorId: monitorOfKey.monitorId,
            sentValidSecret: false,
            problem: decision.problem,
          });
        }

        return {
          mayRecordArrival: false,
          refusalMessage: IncomingRequestSecretPolicy.getRefusalMessage(
            decision.verdict,
          ),
        };
      }

      return { mayRecordArrival: true };
    } catch (err) {
      /*
       * The edge could not decide - Postgres unreachable, say. The worker
       * decides on the job, and the arrival waits for it.
       */
      logger.error(
        "Could not check an incoming request against its project's secret requirement at the endpoint. The worker checks it.",
      );
      logger.error(err);

      return { mayRecordArrival: false };
    }
  }

  @CaptureSpan()
  public static async decideInWorker(data: {
    projectId: ObjectID;
    // The monitor the request is for, whose record of secrets it adds to.
    monitorId?: ObjectID | undefined;
    presentedSecretHashes: Array<string> | undefined;
    requestHeaders: Dictionary<string> | undefined;
  }): Promise<IncomingRequestSecretWorkerDecision> {
    /*
     * A job queued by an endpoint from before the requirement - during a
     * rolling deploy - still carries X-OneUptime-Secret and no hashes: read
     * it here, and take the header off, as the endpoint would have.
     */
    const presented: {
      requestHeaders: Dictionary<string>;
      secretHashes: Array<string>;
    } = IncomingRequestSecretRequest.takePresentedSecrets(data.requestHeaders);

    const presentedSecretHashes: Array<string> = Array.from(
      new Set<string>([
        ...(data.presentedSecretHashes || []),
        ...presented.secretHashes,
      ]),
    );

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(data.projectId);

    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy,
        presentedSecretHashes,
      });

    /*
     * Whatever the project requires, the monitor learns whether this request
     * sent a valid secret - while the project has one to send.
     */
    if (decision.sentValidSecret !== undefined) {
      await IncomingRequestSecretActivity.record({
        monitorId: data.monitorId,
        sentValidSecret: decision.sentValidSecret,
        problem: decision.problem,
      });
    }

    if (IncomingRequestSecretPolicy.isRefused(decision.verdict)) {
      return {
        verdict: decision.verdict,
        isRefused: true,
        requestHeaders: presented.requestHeaders,
      };
    }

    if (!decision.matchedSecretId) {
      return {
        verdict: decision.verdict,
        isRefused: false,
        requestHeaders: presented.requestHeaders,
      };
    }

    /*
     * One of the project's secrets: its Last Used moves, and a bearer token
     * that carried it is masked - required yet or not, it is a secret.
     */
    await IncomingRequestSecretPolicy.recordUse(decision.matchedSecretId);

    return {
      verdict: decision.verdict,
      isRefused: false,
      requestHeaders:
        IncomingRequestSecretRequest.withoutSecretInAuthorization({
          requestHeaders: presented.requestHeaders,
          projectSecretHashes: policy.secrets.map(
            (secret: IncomingRequestSecretOfPolicy): string => {
              return secret.secretHash;
            },
          ),
        }) || presented.requestHeaders,
    };
  }

  /*
   * The monitor (and project) of an incoming request monitor's key, as the
   * edge may learn it: kept, or looked up for a key a trusted caller
   * registered. Null when the edge cannot place it. A paused monitor is
   * placed but never kept, as the worker never keeps one
   * (ProcessIncomingRequestIngest).
   */
  private static async findMonitorAtEdge(
    secretKey: string,
  ): Promise<MonitorOfSecretKey | null> {
    if (!secretKey || !ObjectID.isValidUUID(secretKey)) {
      return null;
    }

    const kept: MonitorOfSecretKey | null =
      await MonitorSecretKeyCache.getMonitor({
        kind: MonitorSecretKeyKind.IncomingRequest,
        secretKey,
      });

    if (kept) {
      return kept;
    }

    if (!(await IncomingRequestReceivedAtStore.isTracked(secretKey))) {
      return null;
    }

    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: {
        incomingRequestSecretKey: new ObjectID(secretKey),
        monitorType: MonitorType.IncomingRequest,
      },
      select: {
        _id: true,
        projectId: true,
        ...MONITOR_PAUSE_FLAGS_SELECT,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor?._id || !monitor.projectId) {
      return null;
    }

    const monitorOfKey: MonitorOfSecretKey = {
      monitorId: new ObjectID(monitor._id.toString()),
      projectId: monitor.projectId,
    };

    if (!MonitorPauseState.isPaused(monitor)) {
      await MonitorSecretKeyCache.setMonitor({
        kind: MonitorSecretKeyKind.IncomingRequest,
        secretKey,
        monitor: monitorOfKey,
      });
    }

    return monitorOfKey;
  }
}
