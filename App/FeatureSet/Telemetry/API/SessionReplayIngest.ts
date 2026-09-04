import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyGuard, {
  TelemetryIngestionKeyRefusal,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyGuard";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import logger from "Common/Server/Utils/Logger";
import StatusCode from "Common/Types/API/StatusCode";
import ObjectID from "Common/Types/ObjectID";
import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_USER_REF_HEADER,
  SessionReplayChunkResponse,
  SessionReplayConfigResponse,
  SessionReplayDisabledReason,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayTargeting from "Common/Server/Utils/SessionReplay/SessionReplayTargeting";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { JSONObject } from "Common/Types/JSON";
import {
  SESSION_REPLAY_DEBUG,
  SESSION_REPLAY_ENABLED_BY_DEFAULT,
  SESSION_REPLAY_INGEST_ENABLED,
  SESSION_REPLAY_TRUSTED_GEO_HEADER,
} from "../Config";
import {
  ARTIFACT_CONTENT_TYPE,
  LOADER_CACHE_CONTROL,
  RECORDER_CACHE_CONTROL,
  RECORDER_VERSION_PATTERN,
  getArtifactFilePath,
  getPinnedRecorderPath,
  getRecorderIntegrity,
  getRecorderVersion,
} from "../../BrowserRecorder/Manifest";
import SessionReplayRequestMiddleware from "../Middleware/SessionReplayRequestMiddleware";
import SessionReplayIngestService, {
  SessionReplayGateDecision,
  SessionReplayGateOutcome,
} from "../Services/SessionReplayIngestService";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";
import SessionReplayEnvelopeParser, {
  ParsedSessionReplayFrame,
  SessionReplayEnvelopeError,
  SessionReplayParseResult,
} from "../Utils/SessionReplayEnvelopeParser";

const router: ExpressRouter = Express.getRouter();

/*
 * Session replay ingest.
 *
 * Mounted under TELEMETRY_PREFIXES, so both /session-replay/v1/... and
 * /telemetry/session-replay/v1/... are live. That is precisely why the
 * body-parser bypass predicates in StartServer test `.includes()` rather
 * than `.startsWith()`: the prefixed path would otherwise fall into the
 * global gzip fast-path, which has no size limit at all and would hand this
 * router an already-decompressed body, silently skipping the byte cap.
 *
 * Response vocabulary, and why each one:
 *
 *   202 - staged and enqueued. Only ever sent AFTER the enqueue succeeds.
 *   204 - deliberately not recording (disabled, unsampled, over budget),
 *         with a directive telling the recorder to stand down. Not an error.
 *   400 - malformed frame. Terminal for the recorder.
 *   401 - bad or missing ingestion key (from the shared auth middleware).
 *   403 - origin not on the application's allowlist. Terminal.
 *   413 - body over the cap (sent from the middleware, before it stops
 *         reading, and without destroying the socket).
 *   422 - an indivisible full snapshot that will not fit. The session
 *         survives with a fidelity notice instead of vanishing.
 *   429 - over the per-minute rate. Carries Retry-After.
 *   503 - our storage could not accept it. Retryable, and never 202.
 */

/*
 * Ingest metric for the replay signal. A local copy rather than a shared
 * helper because the one in OTelIngest.ts is keyed to a closed union of the
 * four OTel signals and is not exported.
 */
type ReplayMetricsMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void;

const replayIngestMetricsMiddleware: ReplayMetricsMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  const startNs: bigint = process.hrtime.bigint();

  const body: unknown = (req as { body?: unknown }).body;
  let payloadBytes: number = 0;

  if (Buffer.isBuffer(body)) {
    payloadBytes = body.length;
  } else if (body instanceof Uint8Array) {
    payloadBytes = body.byteLength;
  }

  if (payloadBytes > 0) {
    AppMetrics.getIngestPayloadBytes().record(payloadBytes, {
      "telemetry.signal": "session-replay",
    });
  }

  let recorded: boolean = false;

  const recordOnce: () => void = (): void => {
    if (recorded) {
      return;
    }
    recorded = true;

    const elapsedNs: bigint = process.hrtime.bigint() - startNs;
    const statusCode: number = res.statusCode || 0;

    /*
     * 204 is counted as "refused" rather than "accepted": it means we chose
     * not to record, and conflating it with a stored chunk would make the
     * accept rate meaningless.
     */
    const outcome: string =
      statusCode === 202
        ? "accepted"
        : statusCode === 204
          ? "refused"
          : statusCode >= 400 && statusCode < 500
            ? "rejected"
            : statusCode >= 500
              ? "error"
              : "other";

    const attributes: Record<string, string> = {
      "telemetry.signal": "session-replay",
      outcome,
    };

    /*
     * The gate's reason ("budget-exhausted", "not-sampled", ...) is a small
     * closed vocabulary, so it is safe as a metric label - and it is the
     * difference between an alertable "replay refused: budget" series and
     * an undifferentiated refusal count nobody can act on.
     */
    const gateReason: unknown = res.locals
      ? res.locals["replayGateReason"]
      : undefined;

    if (typeof gateReason === "string" && gateReason.length > 0) {
      attributes["reason"] = gateReason;
    }

    AppMetrics.getIngestCounter().add(1, attributes);
    AppMetrics.getIngestDuration().record(Number(elapsedNs) / 1e6, attributes);
  };

  res.on("finish", recordOnce);
  res.on("close", recordOnce);

  next();
};

function readAppIdentifier(req: ExpressRequest): string {
  return (
    headerValueToString(
      req.headers[SESSION_REPLAY_APP_IDENTIFIER_HEADER],
    )?.trim() || ""
  );
}

/*
 * Did a dashboard user ask for this end user's next session?
 *
 * The recorder URI-component-encodes the reference (a raw non-ASCII header
 * value would make its fetch() throw), so decode here; a value that does
 * not decode is matched as sent, since an older or third-party client may
 * not encode at all. Every failure path answers false: targeting is a
 * convenience, and it must never break a config response.
 */
async function resolveIsTargeted(
  req: ExpressRequest,
  projectId: ObjectID,
  appIdentifier: string,
): Promise<boolean> {
  const rawHeader: string =
    headerValueToString(req.headers[SESSION_REPLAY_USER_REF_HEADER]) || "";

  if (!rawHeader) {
    return false;
  }

  let userRef: string = rawHeader;

  try {
    userRef = decodeURIComponent(rawHeader);
  } catch {
    /* Malformed percent-encoding; match the literal value instead. */
  }

  if (!SessionReplayTargeting.isUsableUserRef(userRef)) {
    return false;
  }

  return SessionReplayTargeting.consumeTarget({
    projectId: projectId,
    appIdentifier: appIdentifier,
    userRef: userRef,
  });
}

/*
 * Country from a CDN-supplied header, and ONLY when the deployment declares
 * that it is actually behind that CDN.
 *
 * There is no IP-geolocation database in this deployment, and adding one to
 * satisfy a nice-to-have column would be a poor trade. But a request header
 * is client-controlled unless something in front of the app overwrites it:
 * nothing in Nginx/default.conf.template strips cf-ipcountry, so on an
 * install that is not behind Cloudflare any client - including a plain curl
 * with a scraped ingestion key - could stamp arbitrary countries onto
 * RumSession.countryCode and poison every per-country analytic or compliance
 * filter built on that column.
 *
 * So the header to honour is named explicitly by SESSION_REPLAY_TRUSTED_GEO_
 * HEADER, and the default is to trust none and leave the column empty. That
 * is the fail-closed direction: an empty country is a missing nice-to-have,
 * a forged one is bad data that looks derived.
 */
const TWO_LETTER_COUNTRY_CODE: RegExp = new RegExp("^[A-Z]{2}$");

function readCountryCode(req: ExpressRequest): string {
  if (!SESSION_REPLAY_TRUSTED_GEO_HEADER) {
    return "";
  }

  const candidate: string | undefined = headerValueToString(
    req.headers[SESSION_REPLAY_TRUSTED_GEO_HEADER],
  );

  const trimmed: string = (candidate || "").trim().toUpperCase();

  /*
   * Cloudflare sends "XX" for an unknown country and "T1" for Tor exits;
   * neither is a country, so only real two-letter codes are kept.
   */
  if (
    TWO_LETTER_COUNTRY_CODE.test(trimmed) &&
    trimmed !== "XX" &&
    trimmed !== "T1"
  ) {
    return trimmed;
  }

  return "";
}

/*
 * Session replay traffic is telemetry, so it keeps the application ALIVE.
 *
 * RumApplicationService.updateLastSeen used to be reachable only from the
 * OTel path (OtelIngestBaseService), so an application instrumented with the
 * replay snippet alone never had its lastSeenAt refreshed at all:
 * markDisconnectedApplications flipped it to "disconnected" fifteen minutes
 * after whatever OTel batch last touched it, and the Dashboard showed
 * "Disconnected" with a Last Seen days old while recorders on the customer's
 * site were talking to this very process. That is issue #3527's headline
 * symptom, and it is not a cosmetic one: "Disconnected" is what somebody
 * reads before concluding their install is broken and giving up.
 *
 * Called from BOTH replay entry points, and the config fetch is the
 * load-bearing one. Under the shipped default policy - capture trigger
 * OnErrorOrFrustration, sample percentage 0 - a perfectly healthy page makes
 * exactly ONE request per page load and posts no chunk unless something goes
 * wrong, so a chunk-only heartbeat would leave a working installation looking
 * dead for as long as nothing went wrong.
 *
 * Fire-and-forget, and throttled to one Postgres write per application per
 * minute inside ResourceHeartbeat. It must never delay or fail a response on
 * either path.
 */
function markApplicationAlive(rumApplicationId: ObjectID): void {
  RumApplicationService.updateLastSeen(rumApplicationId).catch(
    (err: unknown) => {
      logger.warn(
        "Could not refresh RUM application liveness from session replay:",
      );
      logger.warn(err);
    },
  );
}

/*
 * Stamp a disabled config with WHY, and with the debug flag.
 *
 * A helper rather than five inline spreads so no future disabled branch can
 * quietly ship without a reason: the customer-visible symptom of a missing
 * one is total silence in the browser, which is precisely the failure mode
 * the field exists to end.
 */
function sendDisabledConfig(
  disabledResponse: SessionReplayConfigResponse,
  reason: SessionReplayDisabledReason,
): JSONObject {
  return {
    ...disabledResponse,
    disabledReason: reason,
    debug: SESSION_REPLAY_DEBUG,
  } as unknown as JSONObject;
}

function sendChunkDirective(
  req: ExpressRequest,
  res: ExpressResponse,
  statusCode: number,
  decision: SessionReplayGateDecision,
): void {
  const payload: SessionReplayChunkResponse = {
    directive: decision.directive,
    configEpoch: decision.configEpoch,
    reason: decision.reason,
  };

  /*
   * Stashed for the metrics middleware, which fires on response finish and
   * has no other way to see WHY a request was refused. Without the label an
   * operator cannot tell budget exhaustion from sampling on a dashboard.
   */
  if (res.locals) {
    res.locals["replayGateReason"] = decision.reason;
  }

  if (decision.retryAfterSeconds !== undefined) {
    payload.retryAfterSeconds = decision.retryAfterSeconds;
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
  }

  /*
   * 204 must not carry a body, so the directive rides in a header for that
   * one case. The recorder reads the header when the body is empty.
   */
  if (statusCode === 204) {
    res.setHeader("x-oneuptime-replay-directive", decision.directive);
    res.setHeader(
      "x-oneuptime-replay-config-epoch",
      String(decision.configEpoch),
    );

    if (decision.reason) {
      res.setHeader("x-oneuptime-replay-reason", decision.reason);
    }

    res.status(204).end();
    return;
  }

  Response.sendJsonObjectResponse(req, res, payload as unknown as JSONObject, {
    statusCode: new StatusCode(statusCode),
  });
}

router.post(
  "/session-replay/v1/chunk",
  TelemetryIngestionDisabled.middleware,
  SessionReplayRequestMiddleware.parseBody,
  replayIngestMetricsMiddleware,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SessionReplay),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const serverReceiveUnixMs: number = Date.now();

      const projectId: ObjectID = (req as TelemetryRequest).projectId;

      const body: unknown = req.body;

      if (!Buffer.isBuffer(body)) {
        Response.sendJsonObjectResponse(
          req,
          res,
          {
            error: "malformed-body",
            message:
              "Session replay chunks must be posted as a raw body. Received a parsed value instead, which means the request did not reach the replay body reader.",
          },
          { statusCode: new StatusCode(400) },
        );
        return;
      }

      const appIdentifier: string = readAppIdentifier(req);

      if (!appIdentifier) {
        /*
         * The identifier has to be a header: all three gates below need the
         * RumApplication while the body is still an undecoded gzip Buffer.
         * Moving the gates to the worker instead would mean the client has
         * already been told 202 and can never learn it was dropped.
         */
        Response.sendJsonObjectResponse(
          req,
          res,
          {
            error: "missing-app-identifier",
            message: `Send the RUM application identifier in the ${SESSION_REPLAY_APP_IDENTIFIER_HEADER} header.`,
          },
          { statusCode: new StatusCode(400) },
        );
        return;
      }

      const parsed: SessionReplayParseResult =
        SessionReplayEnvelopeParser.parse(body, appIdentifier);

      if (!parsed.isValid) {
        /*
         * Running past the per-session chunk cap is a NORMAL end-of-session
         * condition for a long-lived tab, not a malformed frame. The parser
         * rejects the index before the gate can ever see it, so the orderly
         * 204 + directive "stop" stand-down the design specifies has to be
         * mapped here; answering 400 would tell the recorder its frames are
         * broken and give it nothing to act on.
         */
        if (parsed.error === SessionReplayEnvelopeError.ChunkIndexOutOfRange) {
          sendChunkDirective(req, res, 204, {
            outcome: SessionReplayGateOutcome.Stop,
            /*
             * configEpoch 0 because no policy was resolved for this request:
             * the parse failed before the gate ran. The recorder treats 0 as
             * "unknown", which is correct - it must not overwrite its cached
             * epoch on the strength of a response that never read the policy.
             */
            directive: "stop",
            configEpoch: 0,
            reason: "session-chunk-cap",
          });
          return;
        }

        Response.sendJsonObjectResponse(
          req,
          res,
          {
            error: parsed.error,
            message: parsed.message,
          },
          {
            statusCode: new StatusCode(
              SessionReplayIngestService.isUnprocessableParseError(parsed.error)
                ? 422
                : 400,
            ),
          },
        );
        return;
      }

      const sessionIds: Array<string> = Array.from(
        new Set(
          parsed.frames.map((frame: ParsedSessionReplayFrame): string => {
            return frame.envelope.sessionId;
          }),
        ),
      );

      const maxChunkIndex: number = parsed.frames.reduce(
        (highest: number, frame: ParsedSessionReplayFrame): number => {
          return Math.max(highest, frame.envelope.chunkIndex);
        },
        0,
      );

      /*
       * Carried into the gate so a frame uploaded because something actually
       * went wrong is not then re-judged by the sample percentage.
       */
      const triggerReasons: Array<string> = parsed.frames.map(
        (frame: ParsedSessionReplayFrame): string => {
          return frame.envelope.triggerReason;
        },
      );

      const decision: SessionReplayGateDecision =
        await SessionReplayIngestService.gateChunkRequest({
          projectId: projectId,
          appIdentifier: appIdentifier,
          origin: headerValueToString(req.headers["origin"]),
          sessionIds: sessionIds,
          triggerReasons: triggerReasons,
          maxChunkIndex: maxChunkIndex,
          chunkCount: parsed.frames.length,
          payloadBytes: body.length,
        });

      /*
       * Budget exhaustion is recorded on the application row (throttled,
       * fire-and-forget) so the Dashboard can show WHY recordings stopped.
       * Without this the customer's only signal is silence.
       */
      if (
        decision.policy?.rumApplicationId &&
        (decision.reason === "budget-exhausted" ||
          decision.reason === "app-monthly-budget-exhausted")
      ) {
        RumApplicationService.markSessionReplayBudgetExceeded(
          decision.policy.rumApplicationId,
        ).catch((err: unknown) => {
          logger.warn("Could not record replay budget exhaustion:");
          logger.warn(err);
        });
      }

      switch (decision.outcome) {
        case SessionReplayGateOutcome.Stop:
          sendChunkDirective(req, res, 204, decision);
          return;

        case SessionReplayGateOutcome.OriginRefused:
          sendChunkDirective(req, res, 403, decision);
          return;

        case SessionReplayGateOutcome.RateLimited:
          sendChunkDirective(req, res, 429, decision);
          return;

        case SessionReplayGateOutcome.StorageUnavailable:
          sendChunkDirective(req, res, 503, decision);
          return;

        case SessionReplayGateOutcome.Accepted:
          break;

        default:
          sendChunkDirective(req, res, 503, decision);
          return;
      }

      /*
       * ENQUEUE FIRST, THEN RESPOND. The trace path sends 200 and awaits the
       * enqueue afterwards, which loses the payload behind a success
       * response when Redis is down - StartServer's error handler bails out
       * once headersSent. A recording cannot be re-derived, and the recorder
       * releases its buffer on success, so it has to be able to learn that
       * its chunk did not land.
       */
      try {
        await TelemetryQueueService.addSessionReplayIngestJob({
          projectId: projectId,
          appIdentifier: appIdentifier,
          body: body,
          serverReceiveUnixMs: serverReceiveUnixMs,
          samplePercentageAtCapture: decision.policy?.samplePercentage ?? 0,
          countryCode: readCountryCode(req),
          inlineStagingMaxBytes:
            SessionReplayIngestService.getInlineStagingMaxBytes(),
        });
      } catch (err) {
        logger.error("Error staging a session replay chunk:");
        logger.error(err);

        sendChunkDirective(req, res, 503, {
          outcome: SessionReplayGateOutcome.StorageUnavailable,
          directive: "throttle",
          configEpoch: decision.configEpoch,
          retryAfterSeconds: 30,
          reason: "staging-failed",
        });
        return;
      }

      /*
       * Recording health, written after the enqueue so "last chunk
       * received" means "accepted", not merely "arrived". Throttled and
       * fire-and-forget - it must never delay or fail the response.
       */
      if (decision.policy?.rumApplicationId) {
        RumApplicationService.markSessionReplayChunkReceived(
          decision.policy.rumApplicationId,
        ).catch((err: unknown) => {
          logger.warn("Could not record replay chunk receipt:");
          logger.warn(err);
        });

        markApplicationAlive(decision.policy.rumApplicationId);
      }

      sendChunkDirective(req, res, 202, decision);
      return;
    } catch (err) {
      logger.error("Error in /session-replay/v1/chunk:");
      logger.error(err);
      return next(err);
    }
  },
);

/*
 * Policy snapshot for a live recorder.
 *
 * This endpoint is what makes every server-side privacy control actually
 * reachable: without it, changing a masking mode or a block selector would
 * never take effect in a browser that had already loaded the recorder. It
 * also carries the pinned artifact version, which is the staged-rollout and
 * instant-rollback mechanism, and a directive so a disabled application
 * stops recording rather than merely stopping ingest.
 *
 * Cached privately for 5 minutes. The gate's Redis kill key is what closes
 * the resulting window on the server side within ~5 seconds.
 */
router.get(
  "/session-replay/v1/config",
  TelemetryIngest.forSurface(TelemetryIngestSurface.SessionReplay),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const projectId: ObjectID = (req as TelemetryRequest).projectId;
      const appIdentifier: string = readAppIdentifier(req);

      if (!appIdentifier) {
        Response.sendJsonObjectResponse(
          req,
          res,
          {
            error: "missing-app-identifier",
            message: `Send the RUM application identifier in the ${SESSION_REPLAY_APP_IDENTIFIER_HEADER} header.`,
          },
          { statusCode: new StatusCode(400) },
        );
        return;
      }

      /*
       * The disabled response is a complete, well-formed config with
       * enabled=false rather than a 404. A recorder that cannot parse the
       * config must refuse to record, so handing it something it understands
       * and that says "no" is strictly safer than handing it an error it
       * might treat as transient and retry past.
       */
      /*
       * The published artifact version comes from the build manifest, never
       * from an env var. Those were two independent answers to one question
       * and they were never equal: esbuild names the file after package.json's
       * version (which SyncPackageVersions.js rewrites every release) while
       * the env var defaulted to a constant. A loader told to fetch a version
       * that was never published 404s and silently no-ops on the customer's
       * page - a failure the server cannot see.
       *
       * null means nothing has been built, in which case replay reports
       * itself disabled rather than advertising an artifact that is not there.
       */
      const publishedRecorderVersion: string | null = getRecorderVersion();

      const disabledResponse: SessionReplayConfigResponse = {
        enabled: false,
        recorderVersion: publishedRecorderVersion || "",
        maskingMode: SessionReplayMaskingMode.MaskAllText,
        captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
        consentMode: SessionReplayConsentMode.RequireExplicit,
        samplePercentage: 0,
        maskSelectors: [],
        blockSelectors: [],
        urlAllowlist: [],
        ignoreErrorPatterns: [],
        tracePropagationOrigins: [],
        lcpBudgetMs: 0,
        longTaskBudgetMs: 0,
        slowRequestBudgetMs: 0,
        isTargeted: false,
        recordCanvas: false,
        captureUserIdentity: false,
        respectDoNotTrack: true,
        configEpoch: 0,
        directive: "stop",
      };

      if (
        !SESSION_REPLAY_INGEST_ENABLED ||
        !SESSION_REPLAY_ENABLED_BY_DEFAULT ||
        !publishedRecorderVersion
      ) {
        /*
         * Three deployment-level causes that a customer cannot fix from the
         * Dashboard, and which used to be indistinguishable from "somebody
         * switched this application off". `recorder-not-built` in particular
         * is a self-hosted install whose recorder bundle was never produced:
         * there is no artifact to serve, replay has never worked there and
         * never will until the build runs, and nothing anywhere said so.
         */
        Response.sendJsonObjectResponse(
          req,
          res,
          sendDisabledConfig(
            disabledResponse,
            !SESSION_REPLAY_INGEST_ENABLED
              ? SessionReplayDisabledReason.IngestDisabled
              : !SESSION_REPLAY_ENABLED_BY_DEFAULT
                ? SessionReplayDisabledReason.DisabledByDefault
                : SessionReplayDisabledReason.RecorderNotBuilt,
          ),
        );
        return;
      }

      let policy: SessionReplayGatePolicy | null = null;

      try {
        policy = await SessionReplayGateCache.getPolicy({
          projectId: projectId,
          appIdentifier: appIdentifier,
        });
      } catch (err) {
        /*
         * Fail CLOSED even here. A recorder told "enabled" by mistake starts
         * recording real people; a recorder told "disabled" by mistake loses
         * five minutes of coverage.
         */
        logger.error("Error resolving the session replay config policy:");
        logger.error(err);

        Response.sendJsonObjectResponse(
          req,
          res,
          sendDisabledConfig(
            disabledResponse,
            SessionReplayDisabledReason.PolicyUnavailable,
          ),
        );
        return;
      }

      if (!policy) {
        Response.sendJsonObjectResponse(
          req,
          res,
          sendDisabledConfig(
            disabledResponse,
            SessionReplayDisabledReason.NotEnabledForApplication,
          ),
        );
        return;
      }

      /*
       * A recorder asked this application for its policy, so a recorder is
       * running on it right now. See markApplicationAlive: for the default
       * policy this is the ONLY request a healthy page makes, and therefore
       * the only honest liveness signal replay has.
       */
      markApplicationAlive(policy.rumApplicationId);

      const config: SessionReplayConfigResponse = {
        enabled: true,
        recorderVersion: publishedRecorderVersion,
        maskingMode: policy.maskingMode,
        captureTrigger: policy.captureTrigger,
        consentMode: policy.consentMode,
        samplePercentage: policy.samplePercentage,
        maskSelectors: policy.maskSelectors,
        blockSelectors: policy.blockSelectors,
        /*
         * No query parameter survives scrubbing by default. Per-application
         * allowlisting is a settings-page concern; shipping an empty list
         * here means the default cannot leak a reset token or a magic link.
         */
        urlAllowlist: [],
        /*
         * Trigger noise control, not a privacy control, so it ships to the
         * recorder verbatim: patterns are matched against error messages
         * and source URLs in the browser, and a live recorder picks up a
         * dashboard edit on its next config refresh.
         */
        ignoreErrorPatterns: policy.ignoreErrorPatterns,
        /*
         * Correlation and performance knobs ship to the recorder verbatim;
         * the artifact normalises them defensively (see the recorder's
         * ExtendedConfig). Empty origins mean the injection code never
         * runs, which is the safe default the column migration sets.
         */
        tracePropagationOrigins: policy.tracePropagationOrigins,
        lcpBudgetMs: policy.lcpBudgetMs,
        longTaskBudgetMs: policy.longTaskBudgetMs,
        slowRequestBudgetMs: policy.slowRequestBudgetMs,
        isTargeted: await resolveIsTargeted(req, projectId, appIdentifier),
        recordCanvas: policy.recordCanvas,
        captureUserIdentity: policy.captureUserIdentity,
        /*
         * The deployment's default answer on DNT, not the final word. A page
         * that explicitly sets data-oneuptime-respect-do-not-track="false" on
         * its own script tag overrides it, because the customer owns the
         * lawful basis for their own site. Omitting the attribute leaves this
         * in force, so doing nothing still honours the signal.
         */
        respectDoNotTrack: true,
        configEpoch: policy.configEpoch,
        directive: "continue",
      };

      /*
       * SRI for the pinned artifact. Without it the loader injects the script
       * with no integrity attribute, which throws away the whole point of
       * publishing an immutable, hash-pinned build. Optional on the wire: a
       * server that cannot produce one yields a script tag without integrity
       * rather than no recording at all.
       */
      /*
       * Deployment-wide recorder diagnostics. Adds console output on the
       * customer's page and changes no policy; see SESSION_REPLAY_DEBUG.
       */
      if (SESSION_REPLAY_DEBUG) {
        config.debug = true;
      }

      const recorderIntegrity: string | null = getRecorderIntegrity();

      if (recorderIntegrity) {
        (config as unknown as Record<string, unknown>)["recorderIntegrity"] =
          recorderIntegrity;
      }

      /*
       * Cache semantics carry the whole targeting handshake:
       *
       *  - Any response to a request that IDENTIFIED a user is no-store,
       *    not just the targeted ones. The primary flow is "support agent
       *    arms the target, asks the user to reload" - if that user's
       *    browser can serve a cached isTargeted:false for up to 300s,
       *    "record the NEXT session" silently becomes "record no session
       *    for five minutes".
       *  - The inverse is as bad: a cached isTargeted:true would re-arm
       *    capture on every reload, turning "next" into "every".
       *  - Vary tells any shared/HTTP cache that an anonymous response
       *    must never be reused for an identified fetch.
       *
       * Anonymous fetches (no user ref on the page - the overwhelming
       * majority) keep the 5-minute private cache.
       */
      res.setHeader("Vary", SESSION_REPLAY_USER_REF_HEADER);

      const hasUserRef: boolean = Boolean(
        headerValueToString(req.headers[SESSION_REPLAY_USER_REF_HEADER]),
      );

      if (config.isTargeted || hasUserRef) {
        res.setHeader("Cache-Control", "no-store");
      } else {
        res.setHeader("Cache-Control", "private, max-age=300");
      }

      Response.sendJsonObjectResponse(
        req,
        res,
        config as unknown as JSONObject,
      );
      return;
    } catch (err) {
      logger.error("Error in /session-replay/v1/config:");
      logger.error(err);
      return next(err);
    }
  },
);

/*
 * Key-validity probe, mirroring /otlp/v1/validate.
 *
 * The chunk endpoint answers 401 for a bad key, but a recorder embedded in a
 * customer's page has nowhere useful to surface that. This gives an install
 * script or a "Test your installation" panel a real answer. It ingests
 * nothing and writes nothing, and reads the token from headers only so it
 * cannot leak into access logs.
 *
 * `valid` means "the chunk endpoint would accept this key", so it also
 * accounts for the kill switch, the expiry and the browser-key surface rule.
 * A key that resolves but is switched off answers false, because answering
 * true would send someone away believing their install works while every
 * chunk is refused. Existing keys are all enabled and never expire, so their
 * answer is unchanged.
 *
 * What this deliberately does NOT check is the ORIGIN allowlist, even though
 * ingest enforces it for a browser key. This probe is overwhelmingly run
 * from curl, CI or a settings page - none of which sends the Origin the
 * recorder will send - so enforcing it here would report a correctly
 * configured key as broken and send customers hunting a problem they do not
 * have. Origin is a property of the real recorder request, and that is where
 * it is checked.
 */
router.get(
  "/session-replay/v1/validate",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token: string | undefined =
        headerValueToString(req.headers["x-oneuptime-token"]) ||
        headerValueToString(req.headers["x-oneuptime-service-token"]) ||
        headerValueToString(req.headers["x-oneuptime-ingestion-key"]);

      if (!token) {
        Response.sendJsonObjectResponse(
          req,
          res,
          {
            tokenProvided: false,
            valid: false,
            message:
              "No ingestion token provided. Send it in the x-oneuptime-token header.",
          },
          { statusCode: new StatusCode(401) },
        );
        return;
      }

      const keyPolicy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(
          token.toString(),
        );

      if (!keyPolicy) {
        Response.sendJsonObjectResponse(
          req,
          res,
          {
            tokenProvided: true,
            valid: false,
            message:
              "This ingestion token is unknown or has been revoked. Create or copy a live key from Project Settings > Telemetry Ingestion Keys, then update the recorder snippet.",
          },
          { statusCode: new StatusCode(401) },
        );
        return;
      }

      /*
       * The same kill-switch / expiry / browser-surface triad the ingest
       * guard applies, evaluated against the session-replay surface so the
       * probe and the chunk endpoint can never disagree about the same key.
       *
       * Session replay IS one of the surfaces a browser key may write to, so
       * this rejects a browser key only if that ever stops being true. It is
       * written as the shared check rather than an inline isEnabled/expiresAt
       * pair precisely so that change lands here for free.
       */
      const refusal: TelemetryIngestionKeyRefusal | null =
        TelemetryIngestionKeyGuard.getRefusal({
          policy: keyPolicy,
          surface: TelemetryIngestSurface.SessionReplay,
        });

      if (refusal) {
        Response.sendJsonObjectResponse(
          req,
          res,
          {
            tokenProvided: true,
            valid: false,
            keyType: keyPolicy.keyType,
            reason: refusal.reason,
            message: refusal.message,
          },
          { statusCode: new StatusCode(401) },
        );
        return;
      }

      const projectId: ObjectID = keyPolicy.projectId;

      const appIdentifier: string = readAppIdentifier(req);

      /*
       * When an app identifier is supplied we also report whether replay is
       * actually enabled for it. A valid key against a disabled application
       * is the single most common "why are there no recordings?" case, and
       * without this the customer has no way to tell the two apart.
       */
      let isSessionReplayEnabled: boolean = false;

      if (appIdentifier) {
        try {
          const policy: SessionReplayGatePolicy | null =
            await SessionReplayGateCache.getPolicy({
              projectId: projectId,
              appIdentifier: appIdentifier,
            });

          isSessionReplayEnabled = Boolean(policy);
        } catch (err) {
          logger.warn(
            "Error resolving the session replay policy during validation:",
          );
          logger.warn(err);
        }
      }

      Response.sendJsonObjectResponse(req, res, {
        tokenProvided: true,
        valid: true,
        projectId: projectId.toString(),
        appIdentifierProvided: Boolean(appIdentifier),
        isSessionReplayEnabled: isSessionReplayEnabled,
        isIngestEnabledOnThisInstance: SESSION_REPLAY_INGEST_ENABLED,
        /*
         * A recorder snippet is meant to carry a Browser key, so unlike
         * /otlp/v1/validate this is reported without editorialising - a
         * Server key here still works and is not a misconfiguration, it just
         * gives up the origin binding that makes a published key safe. The
         * field lets a "Test your installation" panel say so.
         */
        keyType: keyPolicy.keyType,
        message: "Ingestion token is valid.",
      });
      return;
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Artifact delivery.
 *
 * Both routes are deliberately UNAUTHENTICATED: this is a public static
 * script that a customer's page loads with a plain <script src> from an
 * arbitrary origin, exactly like any CDN-hosted analytics snippet. It
 * contains no secrets and no project data - the ingestion key lives in the
 * customer's own markup, not in the bundle - and the recorder can do nothing
 * at all until the authenticated /config call succeeds.
 *
 * They are mounted here, in the Telemetry featureset, and not at the root,
 * because Frontend's DashboardFallbackRoutePrefixesToSkip contains
 * "/telemetry" and FrontendRoutes.init() runs BEFORE TelemetryRoutes.init().
 * A root-level /recorder.js would be swallowed by the Dashboard SPA fallback
 * and served as HTML on self-hosted installs - a failure that looks like a
 * broken recorder rather than a routing mistake.
 */

type ArtifactSender = (
  res: ExpressResponse,
  filePath: string,
  cacheControl: string,
) => void;

const sendArtifact: ArtifactSender = (
  res: ExpressResponse,
  filePath: string,
  cacheControl: string,
): void => {
  res.setHeader("Content-Type", ARTIFACT_CONTENT_TYPE);
  res.setHeader("Cache-Control", cacheControl);

  /*
   * Any origin may load it, and it is served without credentials. The
   * explicit header matters for a customer who adds crossorigin="anonymous"
   * to get useful error reporting, or an SRI integrity attribute - both
   * require CORS to be granted or the browser refuses the script outright.
   */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");

  res.sendFile(filePath, (err: Error | undefined): void => {
    if (!err) {
      return;
    }

    logger.error("Error sending the session replay artifact:");
    logger.error(err);

    if (!res.headersSent) {
      res.status(500).end();
    }
  });
};

/*
 * The loader stub, at a FIXED v1 path with a short cache. This is the URL
 * customers paste into their site and never change. Everything version-
 * specific is resolved at runtime from the config response, which is what
 * makes a bad recorder release rollback-able by changing one field instead
 * of waiting out an immutable cache in browsers we cannot reach.
 */
router.get(
  "/session-replay/v1/recorder.js",
  (_req: ExpressRequest, res: ExpressResponse): void => {
    const filePath: string | null = getArtifactFilePath("loader.js");

    if (!filePath) {
      /*
       * Not built. 404 rather than a stub, so a misconfigured deployment is
       * loud in the customer's console instead of silently never recording.
       */
      res.status(404).end();
      return;
    }

    sendArtifact(res, filePath, LOADER_CACHE_CONTROL);
  },
);

/*
 * The pinned, immutable artifact. Served ONLY for an exact version match:
 * serving today's bytes under yesterday's version number, cached for a year,
 * is unrecoverable in browsers we do not control.
 */
router.get(
  "/session-replay/v:version/recorder.js",
  (req: ExpressRequest, res: ExpressResponse): void => {
    const requestedVersion: string = String(req.params["version"] || "");

    /*
     * Validated against the version pattern before it reaches the manifest.
     * getPinnedRecorderPath is name-based and never joins this segment onto a
     * directory, but rejecting a malformed version here keeps the traversal
     * argument local and obvious rather than resting on a callee's contract.
     */
    if (!RECORDER_VERSION_PATTERN.test(requestedVersion)) {
      res.status(404).end();
      return;
    }

    const filePath: string | null = getPinnedRecorderPath(requestedVersion);

    if (!filePath) {
      res.status(404).end();
      return;
    }

    sendArtifact(res, filePath, RECORDER_CACHE_CONTROL);
  },
);

export default router;
