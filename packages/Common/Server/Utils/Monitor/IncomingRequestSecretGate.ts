import MonitorService from "../../Services/MonitorService";
import { ExpressRequest } from "../Express";
import logger from "../Logger";
import WrongIncomingRequestSecretLimit, {
  WRONG_INCOMING_REQUEST_SECRETS_MESSAGE,
} from "../RateLimit/WrongIncomingRequestSecretLimit";
import { WrongKeyRefusal } from "../RateLimit/WrongKeyLimit";
import CaptureSpan from "../Telemetry/CaptureSpan";
import IncomingRequestMonitorLabels from "./IncomingRequestMonitorLabels";
import IncomingRequestReceivedAtStore from "./IncomingRequestReceivedAtStore";
import IncomingRequestSecretActivity from "./IncomingRequestSecretActivity";
import IncomingRequestSecretPolicy, {
  INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE,
  IncomingRequestSecretDecision,
  IncomingRequestSecretMonitor,
  IncomingRequestSecretOfPolicy,
  IncomingRequestSecretPolicyValue,
  IncomingRequestSecretVerdict,
} from "./IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "./IncomingRequestSecretRequest";
import IncomingRequestSecretValues from "./IncomingRequestSecretValues";
import IncomingRequestSignature, {
  PresentedSignature,
  SignatureProblem,
  SignatureVerification,
  SigningSecret,
} from "./IncomingRequestSignature";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
  MonitorSecretKeyKind,
} from "./MonitorSecretKeyCache";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import { IncomingRequestSecretProblem } from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
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
 *   Two kinds of request are looked up whatever the key, and only in their
 *   exact shapes, a found key kept for the minute:
 *
 *     - a verification handshake (WebhookVerification, issue #8429): it is
 *       answered only for a monitor's key, once the project's requirement
 *       lets it through, and it is usually a new monitor's first request;
 *     - a signed request (IncomingRequestSignature, issue #8500): a
 *       signature is made over the body as it came, so it can be checked
 *       only here - the worker gets the body parsed.
 *
 *   A signature is checked with the project's secrets' values
 *   (IncomingRequestSecretValues); the secret that made it is then presented
 *   like one sent in a header: its SHA-256 goes on to the worker with the
 *   request's other presented secrets. A signed request the requirement
 *   accepts on its signature is accepted once (rememberAccepted).
 *
 *   A client that sends too many different wrong secrets to one monitor is
 *   refused with 429 until its window ends (WrongIncomingRequestSecretLimit,
 *   issue #8499) - before its secrets are compared, and whatever it sends.
 *
 * IN THE WORKER - before the request is tracked, kept or evaluated
 * (decideInWorker). Always, on the policy as it is when the job runs: the
 * edge may not have decided, and a secret deleted while the job waited no
 * longer counts. A refused request ends the job there: no arrival, no latest
 * request, no criteria.
 *
 * Both accept a secret only for a monitor it covers (issue #8501): a secret
 * limited to other monitors is refused as a wrong one is.
 *
 * The secret never travels past the edge: X-OneUptime-Secret and
 * X-OneUptime-Signature are taken off the request there, another service's
 * signature is masked, and the job carries the SHA-256 of what was presented
 * (IncomingRequestSecretRequest). A bearer token that is one of the
 * project's secrets is masked by the worker before the request is kept.
 *
 * Both record, on the monitor, whether its requests send a valid secret
 * (IncomingRequestSecretActivity, issue #8498) while the project has one -
 * required yet or not: the edge for a request it refuses, which never reaches
 * the worker, and the worker for every request it processes.
 */

export enum IncomingRequestSecretRefusalKind {
  // The request's secret is missing or not accepted: 401.
  NotAuthenticated = "NotAuthenticated",
  // The client sent too many different wrong secrets to this monitor: 429.
  TooManyWrongSecrets = "TooManyWrongSecrets",
}

export interface IncomingRequestSecretEdgeDecision {
  /*
   * Whether the endpoint may record the request's arrival now: only when it
   * decided the request counts. Otherwise the worker records it, if it does.
   */
  mayRecordArrival: boolean;
  // Set when the request is refused: what the sender is told.
  refusalMessage?: string | undefined;
  // How it is refused, when it is.
  refusalKind?: IncomingRequestSecretRefusalKind | undefined;
  // For a 429: seconds until the client may send secrets to the monitor again.
  retryAfterSeconds?: number | undefined;
  /*
   * The SHA-256 of the secret a presented signature was made with, when one
   * was: queued with the request's other presented secrets, so the worker
   * decides on it as on a secret sent in a header.
   */
  signedWithSecretHash?: string | undefined;
  /*
   * Why a presented signature was not accepted, for a request let through
   * anyway (the project does not require a secret yet): queued, so the
   * monitor's record says a wrong signature came, not that nothing did.
   */
  signatureProblem?: IncomingRequestSecretProblem | undefined;
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
    /*
     * Look the key up even when no trusted caller has registered it: for a
     * verification handshake, which is answered only for a monitor's key.
     */
    placeUntrackedKey?: boolean | undefined;
    /*
     * The request, for the address its wrong secrets are counted for. Left
     * out (a caller with no request), nothing is counted.
     */
    req?: ExpressRequest | undefined;
    // The request's headers, for the signatures it presents.
    requestHeaders?: Dictionary<string> | undefined;
    // The body as it came, for its signatures (IncomingRequestSignature.getSignedBody).
    signedBody?: Buffer | undefined;
    now?: Date | undefined;
  }): Promise<IncomingRequestSecretEdgeDecision> {
    try {
      const signatures: Array<PresentedSignature> =
        IncomingRequestSignature.readPresentedSignatures(data.requestHeaders);

      const monitorOfKey: MonitorOfSecretKey | null =
        await this.findMonitorAtEdge({
          secretKey: data.secretKey,
          placeUntrackedKey:
            Boolean(data.placeUntrackedKey) || signatures.length > 0,
        });

      if (!monitorOfKey) {
        return { mayRecordArrival: false };
      }

      const policy: IncomingRequestSecretPolicyValue =
        await IncomingRequestSecretPolicy.getPolicy(monitorOfKey.projectId);

      const monitor: IncomingRequestSecretMonitor =
        await this.getMonitorForPolicy({
          policy,
          monitorId: monitorOfKey.monitorId,
        });

      const monitorId: string = monitorOfKey.monitorId.toString();

      const presentsCredential: boolean =
        data.presentedSecretHashes.length > 0 || signatures.length > 0;

      // Only a refusal can be guessed against: only then is it counted.
      const countsWrongSecrets: boolean = Boolean(
        data.req && policy.isRequired && presentsCredential,
      );

      if (countsWrongSecrets) {
        const refusal: WrongKeyRefusal | null =
          await WrongIncomingRequestSecretLimit.checkBeforeComparing({
            req: data.req!,
            monitorId,
          });

        if (refusal) {
          return this.tooManyWrongSecrets(refusal);
        }
      }

      const verification: SignatureVerification | undefined =
        signatures.length > 0 && policy.secrets.length > 0
          ? await this.verifySignatures({
              projectId: monitorOfKey.projectId,
              policy,
              signatures,
              body: data.signedBody || Buffer.alloc(0),
              now: data.now,
            })
          : undefined;

      const signedWithSecretHash: string | undefined = this.getHashOfSecret(
        policy,
        verification?.matchedSecretId,
      );

      const decision: IncomingRequestSecretDecision =
        IncomingRequestSecretPolicy.decide({
          policy,
          presentedSecretHashes: [
            ...data.presentedSecretHashes,
            ...(signedWithSecretHash ? [signedWithSecretHash] : []),
          ],
          monitor,
          signatureProblem: this.toSecretProblem(verification?.problem),
        });

      /*
       * A request the requirement accepts on its signature alone is accepted
       * once: the same signed request sent again - captured, or replayed
       * from somewhere it was kept - is refused.
       */
      if (
        policy.isRequired &&
        decision.verdict === IncomingRequestSecretVerdict.Accepted &&
        verification?.matchedSignature &&
        !this.isAcceptedWithoutSignature({
          policy,
          monitor,
          presentedSecretHashes: data.presentedSecretHashes,
        }) &&
        !(await IncomingRequestSignature.rememberAccepted(
          verification.matchedSignature,
        ))
      ) {
        return {
          mayRecordArrival: false,
          refusalMessage: INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE,
          refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
        };
      }

      if (IncomingRequestSecretPolicy.isRefused(decision.verdict)) {
        // Each secret it presented, and each signature no secret made.
        const wrongValues: Array<string> = [
          ...decision.wrongSecretHashes,
          ...(verification?.wrongDigests || []),
        ];

        if (countsWrongSecrets && wrongValues.length > 0) {
          const refusal: WrongKeyRefusal | null =
            await WrongIncomingRequestSecretLimit.countWrong({
              req: data.req!,
              monitorId,
              wrongValues,
            });

          if (refusal) {
            await this.recordRefusal({ monitorId, decision });

            return this.tooManyWrongSecrets(refusal);
          }
        }

        // It never reaches the worker: the monitor learns of it here.
        await this.recordRefusal({ monitorId, decision });

        return {
          mayRecordArrival: false,
          refusalMessage: IncomingRequestSecretPolicy.getRefusalMessage(
            decision.verdict,
            decision.problem,
          ),
          refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
        };
      }

      return {
        mayRecordArrival: true,
        signedWithSecretHash: signedWithSecretHash,
        signatureProblem: signedWithSecretHash
          ? undefined
          : this.toSecretProblem(verification?.problem),
      };
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
    // Why a signature the edge checked was not accepted (signatureProblem).
    signatureProblem?: IncomingRequestSecretProblem | undefined;
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

    const monitor: IncomingRequestSecretMonitor =
      await this.getMonitorForPolicy({
        policy,
        monitorId: data.monitorId,
      });

    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy,
        presentedSecretHashes,
        monitor,
        signatureProblem: this.readSignatureProblem(data.signatureProblem),
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
   * The monitor as the policy needs it: its id, and its labels only when one
   * of the project's secrets is limited to monitors with labels.
   */
  private static async getMonitorForPolicy(data: {
    policy: IncomingRequestSecretPolicyValue;
    monitorId: ObjectID | undefined;
  }): Promise<IncomingRequestSecretMonitor> {
    const monitorId: string | undefined = data.monitorId?.toString();

    return {
      monitorId,
      labelIds:
        monitorId &&
        IncomingRequestSecretPolicy.hasLabelScopedSecret(data.policy)
          ? await IncomingRequestMonitorLabels.getLabelIds(monitorId)
          : [],
    };
  }

  // The signatures checked with the values of the project's secrets.
  private static async verifySignatures(data: {
    projectId: ObjectID;
    policy: IncomingRequestSecretPolicyValue;
    signatures: Array<PresentedSignature>;
    body: Buffer;
    now?: Date | undefined;
  }): Promise<SignatureVerification> {
    const secrets: Array<SigningSecret> =
      await IncomingRequestSecretValues.getSigningSecrets({
        projectId: data.projectId,
        policy: data.policy,
      });

    return IncomingRequestSignature.verify({
      signatures: data.signatures,
      body: data.body,
      secrets,
      now: data.now,
    });
  }

  /*
   * What a signature that was not accepted means for the request, when it
   * presented nothing else: one no secret made is a wrong secret, one too
   * old to check is an expired signature.
   */
  private static toSecretProblem(
    problem: SignatureProblem | undefined,
  ): IncomingRequestSecretProblem | undefined {
    switch (problem) {
      case SignatureProblem.NoMatch:
        return IncomingRequestSecretProblem.WrongSecret;
      case SignatureProblem.Expired:
        return IncomingRequestSecretProblem.ExpiredSignature;
      default:
        return undefined;
    }
  }

  // A signature problem as a job carries it: one of the two, or none.
  private static readSignatureProblem(
    value: unknown,
  ): IncomingRequestSecretProblem | undefined {
    return value === IncomingRequestSecretProblem.WrongSecret ||
      value === IncomingRequestSecretProblem.ExpiredSignature
      ? value
      : undefined;
  }

  // The SHA-256 the policy keeps for one of its secrets.
  private static getHashOfSecret(
    policy: IncomingRequestSecretPolicyValue,
    secretId: string | undefined,
  ): string | undefined {
    if (!secretId) {
      return undefined;
    }

    return policy.secrets.find(
      (secret: IncomingRequestSecretOfPolicy): boolean => {
        return secret.secretId === secretId;
      },
    )?.secretHash;
  }

  /*
   * Whether the secrets sent in headers alone are accepted: then the
   * request's signature, if it has one too, is not what lets it in.
   */
  private static isAcceptedWithoutSignature(data: {
    policy: IncomingRequestSecretPolicyValue;
    monitor: IncomingRequestSecretMonitor;
    presentedSecretHashes: Array<string>;
  }): boolean {
    return (
      data.presentedSecretHashes.length > 0 &&
      IncomingRequestSecretPolicy.decide({
        policy: data.policy,
        presentedSecretHashes: data.presentedSecretHashes,
        monitor: data.monitor,
      }).verdict === IncomingRequestSecretVerdict.Accepted
    );
  }

  private static async recordRefusal(data: {
    monitorId: string;
    decision: IncomingRequestSecretDecision;
  }): Promise<void> {
    if (data.decision.sentValidSecret === false) {
      await IncomingRequestSecretActivity.record({
        monitorId: data.monitorId,
        sentValidSecret: false,
        problem: data.decision.problem,
      });
    }
  }

  private static tooManyWrongSecrets(
    refusal: WrongKeyRefusal,
  ): IncomingRequestSecretEdgeDecision {
    return {
      mayRecordArrival: false,
      refusalMessage: WRONG_INCOMING_REQUEST_SECRETS_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.TooManyWrongSecrets,
      retryAfterSeconds: refusal.retryAfterSeconds,
    };
  }

  /*
   * The monitor (and project) of an incoming request monitor's key, as the
   * edge may learn it: kept, or looked up for a key a trusted caller
   * registered - or for any key, when asked to place an untracked one. Null
   * when the edge cannot place it. A paused monitor is placed but never
   * kept, as the worker never keeps one (ProcessIncomingRequestIngest).
   */
  private static async findMonitorAtEdge(data: {
    secretKey: string;
    placeUntrackedKey: boolean;
  }): Promise<MonitorOfSecretKey | null> {
    const secretKey: string = data.secretKey;

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

    if (
      !data.placeUntrackedKey &&
      !(await IncomingRequestReceivedAtStore.isTracked(secretKey))
    ) {
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
