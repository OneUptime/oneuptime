import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ProductType from "../../Types/MeteredPlan/ProductType";
import ObjectID from "../../Types/ObjectID";
import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  parseSessionReplayRecorderKindHeader,
} from "../../Types/Rum/SessionReplay";
import TelemetryIngestionKeyPolicy, {
  DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
  DEFAULT_MOBILE_KEY_REQUESTS_PER_MINUTE,
} from "../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType, {
  PUBLIC_INGESTION_KEY_TYPES,
} from "../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  IDENTITY_REGISTRATION_SURFACES,
  MOBILE_ALLOWED_INGEST_SURFACES,
  getIngestSurfaceReadableName,
} from "../../Types/Telemetry/TelemetryIngestSurface";
import OriginAllowList from "../../Utils/Telemetry/OriginAllowList";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
  headerValueToString,
} from "../../Server/Utils/Express";
import TelemetryIngestionKeyService from "../../Server/Services/TelemetryIngestionKeyService";
import Response, { ErrorResponseOptions } from "../Utils/Response";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "../Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import TelemetryIngestionBudget, {
  TelemetryIngestionBudgetAdmission,
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetCharge,
} from "../Utils/Telemetry/TelemetryIngestionBudget";
import {
  DEFERRED_BODY_SURFACES,
  getTelemetryIngestionBudgetSignalForSurface,
  measureTelemetryIngestRequest,
  sendTelemetryIngestionBudgetRefusal,
} from "../Utils/Telemetry/TelemetryIngestionBudgetHttp";
import { TelemetryIngestionBudgetSignal } from "../../Types/Telemetry/TelemetryIngestionBudget";
import {
  TelemetryIngestRefusalReason,
  getTelemetryIngestRefusalReasonForBudget,
} from "../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestRefusalRecorder, {
  recordTelemetryIngestBillingRefusal,
} from "../Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestionKeyLastUsed from "../Utils/Telemetry/TelemetryIngestionKeyLastUsed";
import {
  getMobileKeySessionReplayRefusalMessage,
  getMobileKeySurfaceRefusalMessage,
} from "../Utils/Telemetry/TelemetryIngestionKeyGuard";
import type TelemetryIngestAttribution from "../Utils/Telemetry/TelemetryIngestAttribution";
import TelemetryIngestUnknownKeyRefusals, {
  UnknownIngestionKeyRefusal,
} from "../Utils/Telemetry/TelemetryIngestUnknownKeyRefusals";

export interface TelemetryRequest extends ExpressRequest {
  projectId: ObjectID; // Project ID
  productType: ProductType; // what is the product type of the request - logs, metrics or traces.

  /*
   * The resolved key policy that admitted this request. Downstream handlers
   * and queue workers need it - the pinned service name is applied when the
   * payload is processed, not here - and having it on the request means they
   * never have to re-resolve the token, which would mean carrying the secret
   * further into the system than it needs to go.
   */
  ingestionKeyPolicy: TelemetryIngestionKeyPolicy;

  /*
   * The identity already used to authorize a public ingestion key. Session
   * replay's application-level allowlist must consume this exact value rather
   * than re-reading Origin and disagreeing with the outer guard. For native
   * replay this is a synthesized, normalized app:// origin.
   */
  resolvedClientOrigin?: string;

  /*
   * When the ingest endpoint accepted this request: set on the copy a queue
   * worker processes, from the job's ingestionTimestamp (a string once it
   * has been through the queue). Processing can run minutes behind arrival
   * while the queue drains; anything that must be placed on the timeline the
   * data arrived on - the synthetic host heartbeat - reads this instead of
   * the worker's clock (issue #2825).
   */
  receivedAt?: Date | string | undefined;

  /*
   * What the ingestion budget gate counted for this request
   * (TelemetryIngestionBudget), set by whichever producer admitted it so the
   * queue counts it once - pending when the gate could not size the body yet,
   * so the queue counts it with the size it stores. null when a gate ran and
   * counted nothing (no budget in force, or the counters were unavailable);
   * undefined when no gate ran, and the queue decides.
   */
  telemetryIngestionBudgetCharge?: TelemetryIngestionBudgetCharge | null;

  /*
   * The size an ingestion budget counts this request at, set where it is
   * not the size of the body the worker reads back: an OTLP/gRPC export's
   * protobuf size, which the worker - holding the export as JSON - cannot
   * measure, or a Fluent or syslog request's, whose handler reshapes the
   * body before it is queued (TelemetryIngestAttribution
   * .getRequestBytesToShare, #10102). The worker shares it out over the
   * batch's resources (TelemetryIngestAttribution, #6355, #6386).
   */
  telemetryIngestBytes?: number | undefined;

  /*
   * On the copy a queue worker processes: the batch's attribution to the
   * teams, labels and usage of the resources it is filed under
   * (TelemetryIngestAttribution), or null when its project needs none. The
   * ingest services ask it about each resource and settle it once done.
   */
  telemetryIngestAttribution?: TelemetryIngestAttribution | null | undefined;
}

/*
 * A Redis outage puts EVERY ingest request on the counter-unavailable path,
 * so an unguarded log line there is one line per ingested request for as long
 * as the outage lasts. The ingest path is the highest-volume surface in the
 * product, so that buries the very incident it is reporting. Same throttle as
 * PublicDashboardRateLimit and the limiter itself.
 */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

/*
 * How every refusal here is answered: as a refusal of what the client sent,
 * logged at debug rather than error (Response.sendErrorResponse, #10703).
 * They come from clients - most of them before anyone is known - and each
 * keeps sending: a missing or unknown key is counted per process
 * (TelemetryIngestUnknownKeyRefusals), the rest against their key
 * (TelemetryIngestRefusalRecorder), and the rate limit logs its first
 * rejection in a window. An error-level line each was a flood the client
 * paid nothing for.
 */
const CLIENT_REFUSAL: ErrorResponseOptions = { isClientRefusal: true };

/*
 * What a route's body reader resolves with when it answered the request
 * itself, or the connection closed, before it went on (readBodyAfterKey):
 * the request is over, and nothing more runs.
 */
const ANSWERED_BY_READER: unique symbol = Symbol("answered by its reader");

/*
 * Readable name used when a legacy call site did not name its surface. See
 * isAuthorizedServiceMiddleware for why such call sites are treated as
 * server-only.
 */
const UNNAMED_SURFACE_READABLE_NAME: string = "this ingest endpoint";

/*
 * The ceiling a server key gets on an identity registration surface
 * (IDENTITY_REGISTRATION_SURFACES: the Kubernetes agent Runner, the
 * Kubernetes AI agent and the resource AI agents) when its policy names
 * none. Registration is a handful
 * of calls per pod lifetime (start-up, then heartbeats through the minted
 * identity's own key), so a leaked ingestion key hammering it is abuse, not
 * traffic - unlike OTLP ingest, where "no limit" is the historical contract
 * and must stay that way. An explicit per-key limit still wins.
 */
export const DEFAULT_IDENTITY_REGISTRATION_REQUESTS_PER_MINUTE: number = 30;

// The name this ceiling shipped under, when only the Runner registered.
export const DEFAULT_KUBERNETES_AGENT_RUNNER_REQUESTS_PER_MINUTE: number =
  DEFAULT_IDENTITY_REGISTRATION_REQUESTS_PER_MINUTE;

/*
 * The refusal a service-pinned key gets on an identity registration surface.
 * Worded for whichever identity the surface mints, and it never names the
 * key, its pinned service or anything else about it. The Kubernetes
 * surfaces keep their wording exactly; a resource AI agent (Docker, Proxmox,
 * a database, a host, ...) is told about infrastructure instead.
 */
export const getPinnedKeyRegistrationRefusalMessage: (
  surface: TelemetryIngestSurface,
) => string = (surface: TelemetryIngestSurface): string => {
  if (surface === TelemetryIngestSurface.ResourceAiAgent) {
    return `This telemetry ingestion key is pinned to a single service, so it cannot be used for ${getIngestSurfaceReadableName(
      surface,
    )}: that grants access to your infrastructure, not to one service's telemetry. Use an unpinned server ingestion key for the AI agent.`;
  }

  return `This telemetry ingestion key is pinned to a single service, so it cannot be used for ${getIngestSurfaceReadableName(
    surface,
  )}: that grants access to a Kubernetes cluster, not to one service's telemetry. Use an unpinned server ingestion key for the Kubernetes agent.`;
};

type GetEffectiveRequestsPerMinuteLimitFunction = (
  policy: TelemetryIngestionKeyPolicy,
  surface?: TelemetryIngestSurface | null | undefined,
) => number | null;

/*
 * How many requests per minute this key may make, or null for "no limit".
 *
 * Exported so the branches can be pinned directly in tests without standing
 * up an Express request, a Redis client and a mocked service just to observe
 * an arithmetic decision.
 *
 * The asymmetry in the fallback is the whole backwards-compatibility story of
 * this feature: an existing Server key has requestsPerMinuteLimit NULL and
 * must keep behaving exactly as it did before this shipped, which means no
 * limit and - see the call site - not even a Redis round trip. A Browser key
 * with NULL falls back to the shipped default instead, because a public key
 * with no ceiling is the thing we are trying to stop shipping: "the customer
 * did not configure a limit" cannot be allowed to mean "unlimited" there.
 *
 * The one surface-dependent case is identity registration
 * (IDENTITY_REGISTRATION_SURFACES: the Kubernetes agent Runner, the
 * Kubernetes AI agent and the resource AI agents): a server key with no
 * configured limit is held to a
 * conservative default there (see
 * DEFAULT_IDENTITY_REGISTRATION_REQUESTS_PER_MINUTE), because those
 * endpoints mint identities rather than accepting telemetry. Every other
 * surface keeps the server-key contract above untouched.
 */
export const getEffectiveRequestsPerMinuteLimit: GetEffectiveRequestsPerMinuteLimitFunction =
  (
    policy: TelemetryIngestionKeyPolicy,
    surface?: TelemetryIngestSurface | null | undefined,
  ): number | null => {
    /*
     * An explicit limit wins for both key types, including a Server key: a
     * customer who deliberately set a ceiling on a server key asked for one
     * and should get it.
     */
    if (
      typeof policy.requestsPerMinuteLimit === "number" &&
      Number.isFinite(policy.requestsPerMinuteLimit) &&
      policy.requestsPerMinuteLimit > 0
    ) {
      return policy.requestsPerMinuteLimit;
    }

    if (policy.keyType === TelemetryIngestionKeyType.Browser) {
      return DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE;
    }

    // Published in every copy of an app: never unlimited (issue #6457).
    if (policy.keyType === TelemetryIngestionKeyType.Mobile) {
      return DEFAULT_MOBILE_KEY_REQUESTS_PER_MINUTE;
    }

    if (surface && IDENTITY_REGISTRATION_SURFACES.has(surface)) {
      return DEFAULT_IDENTITY_REGISTRATION_REQUESTS_PER_MINUTE;
    }

    return null;
  };

type TelemetryIngestMiddlewareFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

interface ResolveTelemetryClientOriginOptions {
  req: ExpressRequest;
  surface: TelemetryIngestSurface | null;
  // A Browser or a Mobile key: a key published with a page or an app.
  isPublicKey: boolean;
}

/*
 * Resolve the client identity used by a public (Browser or Mobile)
 * ingestion key.
 *
 * A real Origin always wins, including on a request that also carries mobile
 * headers. Browsers attach Origin themselves and page JavaScript cannot
 * remove or replace it, so permitting a header-selected fallback in that
 * case would let a web page choose the weaker native identity path.
 *
 * Native applications do not have that browser-controlled header. Only the
 * session replay surface, only an exact rn-view-tree kind, only a public key
 * and only a validated package/bundle id receive the app:// fallback. A
 * Browser key's allowed origins are checked against it; a Mobile key, which
 * records only its own app's sessions (issue #10540), carries it to the
 * application's own allowed origins, as a Browser key does. Server keys
 * retain their historical behaviour and never need to invent an origin.
 */
export function resolveTelemetryClientOrigin(
  options: ResolveTelemetryClientOriginOptions,
): string | undefined {
  const hasStandardOriginHeader: boolean = Object.prototype.hasOwnProperty.call(
    options.req.headers,
    "origin",
  );
  const standardOrigin: string | undefined = headerValueToString(
    options.req.headers["origin"],
  );

  if (hasStandardOriginHeader) {
    /*
     * A blank/malformed-but-present Origin is still authoritative: it must be
     * refused as missing, never replaced with caller-selected mobile headers.
     * app:// is never accepted from this caller-controlled header either. It
     * is an internal authorization identity that may only be synthesized by
     * the origin-less native replay branch below after all mobile headers and
     * the ingest surface have been validated.
     */
    if (
      standardOrigin &&
      OriginAllowList.normalizeOrigin(standardOrigin).startsWith("app://")
    ) {
      return "";
    }

    return standardOrigin || "";
  }

  if (
    !options.isPublicKey ||
    options.surface !== TelemetryIngestSurface.SessionReplay
  ) {
    return undefined;
  }

  const recorderKind: string | null = parseSessionReplayRecorderKindHeader(
    options.req.headers[SESSION_REPLAY_RECORDER_KIND_HEADER],
  );

  if (recorderKind !== "rn-view-tree") {
    return undefined;
  }

  const mobileAppIdentifier: string | undefined = headerValueToString(
    options.req.headers[SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER],
  );

  if (!mobileAppIdentifier) {
    return undefined;
  }

  return OriginAllowList.getMobileAppOrigin(mobileAppIdentifier);
}

/*
 * Why a Mobile key (issue #6457) may not send this request, or null when it
 * may. Exported so every branch is pinned in a test without a request
 * pipeline around it.
 *
 *   - Not a surface a mobile app's SDK sends to (MOBILE_ALLOWED_INGEST_SURFACES):
 *     a key copied out of an app is refused on every server pipe - profiles,
 *     source maps, dSYMs, syslog, security events, agent registration - and
 *     the unnamed legacy guard, which is server-only.
 *   - Sent with an Origin header: only a browser sends one, and a mobile
 *     SDK never does, so the request came from a web page. A page sends
 *     with a Browser key, whose origins are checked; a Mobile key, which has
 *     none to check, would otherwise be a Browser key without them.
 *   - A session replay request (issue #10540) not from the React Native
 *     recorder, or for a RUM application other than the one the key is
 *     pinned to (getMobileKeySessionReplayRefusalMessage): a Mobile key
 *     records its own app's sessions, never another's.
 *
 * None is a wall against someone who has the app: any client can leave
 * the Origin header out, and send the app's own recorder headers. What
 * bounds that is the rest of the key: its pinned app, its rate limit, its
 * expiry and its kill switch.
 */
export function getMobileKeyRefusalMessage(data: {
  req: ExpressRequest;
  surface: TelemetryIngestSurface | null;
  // The key's pinned service name: the one app it may record.
  pinnedServiceName: string | null;
}): string | null {
  if (
    data.surface === null ||
    !MOBILE_ALLOWED_INGEST_SURFACES.has(data.surface)
  ) {
    // The sentence gRPC, MQTT and the probes send too (TelemetryIngestionKeyGuard).
    return getMobileKeySurfaceRefusalMessage(data.surface);
  }

  const origin: string = (
    headerValueToString(data.req.headers["origin"]) || ""
  ).trim();

  if (origin) {
    return "A mobile ingestion key cannot be used from a web page: this request sent an Origin header, which only a browser sends. Use a browser ingestion key in a web page.";
  }

  if (data.surface === TelemetryIngestSurface.SessionReplay) {
    return getMobileKeySessionReplayRefusalMessage({
      pinnedServiceName: data.pinnedServiceName,
      appIdentifier: headerValueToString(
        data.req.headers[SESSION_REPLAY_APP_IDENTIFIER_HEADER],
      ),
      recorderKind: parseSessionReplayRecorderKindHeader(
        data.req.headers[SESSION_REPLAY_RECORDER_KIND_HEADER],
      ),
    });
  }

  return null;
}

export default class TelemetryIngest {
  /*
   * Build the ingest guard for one named surface.
   *
   * Every ingest route says which surface it is, and the guard answers
   * "may this key write here?" against BROWSER_ALLOWED_INGEST_SURFACES. That
   * is what stops a key scraped off a public page from being replayed into
   * profile / syslog / Fluent / Pyroscope / source-map / Kubernetes-cost /
   * change-event / security-event ingest, none of which any browser has
   * business calling.
   *
   * This returns a thin closure around a single @CaptureSpan-decorated
   * method rather than being decorated itself: a decorator on a factory would
   * open a span when the route table is built at boot, once, and never again
   * per request. Passing the surface as an argument keeps exactly one
   * decorated frame, on the function that actually handles a request.
   *
   * `readBody` is for a route whose body StartServer leaves unread
   * (RequestBodyLimit's readsBodyAfterAuthentication, #10702): the route's
   * reader (RequestBodyAfterAuthentication.readBody), run once the key is
   * known to be right and within its rate, and before the ingestion budget
   * - which measures the body in Refuse mode, to count exactly what it
   * admits and what it refuses. A request without the right key has
   * nothing of its body read, inflated or parsed: its refusal is sent and
   * the connection closed under the rest (UnreadRequestBody), which the
   * client still reads.
   *
   * The reader goes on (next()), refuses the body (next(err), answered by
   * the error handler), or answers the request itself and goes no further,
   * as OTLP's parseBody does a body over its cap and the Vercel drain's
   * signature check a delivery Vercel did not sign (#10814): its answer ends
   * the request.
   */
  public static forSurface(
    surface: TelemetryIngestSurface,
    readBody?: RequestHandler | undefined,
  ): TelemetryIngestMiddlewareFunction {
    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      return TelemetryIngest.authorizeIngestRequest(
        surface,
        req,
        res,
        next,
        readBody,
      );
    };
  }

  /**
   * Backwards-compatible alias for call sites that have not been moved to
   * forSurface().
   *
   * It authorizes with NO named surface, which is treated as SERVER-ONLY: a
   * Browser key is refused here. That direction is deliberate. Routes are
   * being migrated to forSurface() one by one, and a route that is missed
   * must fail CLOSED - a missed browser-capable route is a public credential
   * reaching an endpoint nobody decided it should reach, whereas a missed
   * server-only route is a customer seeing "use a server ingestion key" and
   * filing a bug we can fix in a line. The default must never be the
   * permissive one.
   */
  public static async isAuthorizedServiceMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    return TelemetryIngest.authorizeIngestRequest(null, req, res, next);
  }

  /*
   * The single decorated frame that does the work.
   *
   * `surface` is null only for the legacy alias above, and null means
   * "server-only, unnamed".
   */
  @CaptureSpan()
  private static async authorizeIngestRequest(
    surface: TelemetryIngestSurface | null,
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    readBody?: RequestHandler | undefined,
  ): Promise<void> {
    try {
      // check header.

      let oneuptimeToken: string | undefined = req.headers[
        "x-oneuptime-token"
      ] as string | undefined;

      // if x-oneuptime-service-token header is present then use that as token.
      if (!oneuptimeToken) {
        oneuptimeToken = req.headers["x-oneuptime-service-token"] as
          | string
          | undefined;
      }

      // if x-oneuptime-ingestion-key header is present then use that as token.
      if (!oneuptimeToken) {
        oneuptimeToken = req.headers["x-oneuptime-ingestion-key"] as
          | string
          | undefined;
      }

      if (!oneuptimeToken) {
        /*
         * At debug, and counted (#10703): this comes from anyone, before
         * anyone is known, and a client that sends no key wrote one
         * error-level line a request, at no cost to itself. The count is
         * logged at warn at most once a minute, by surface
         * (TelemetryIngestUnknownKeyRefusals).
         */
        logger.debug(
          "Missing header: x-oneuptime-token",
          getLogAttributesFromRequest(req as any),
        );
        TelemetryIngestUnknownKeyRefusals.record({
          refusal: UnknownIngestionKeyRefusal.Missing,
          surface: surface,
        });

        /*
         * 401 is deliberate: the OTLP spec classifies it as
         * non-retryable, so compliant SDKs / collectors surface the
         * error in their own logs instead of retry-storming. A silent
         * 200 here would make the client believe the data landed and
         * leave the user staring at empty dashboards with no clue why.
         *
         * The gRPC OTLP server sends this sentence and the invalid-token
         * one below word for word (GrpcServer keeps copies, and
         * GrpcServerAuthStatusLive.test.ts fails if they drift), so
         * reword them together.
         */
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
          ),
          CLIENT_REFUSAL,
        );
      }

      /*
       * One lookup resolves everything the guard needs. The policy is NOT a
       * decision - a disabled or expired key still resolves - so that each
       * refusal below can say precisely why, rather than every failure mode
       * collapsing into an indistinguishable "invalid token".
       */
      const policy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(
          oneuptimeToken.toString(),
        );

      if (!policy) {
        /*
         * The token value itself is deliberately NOT logged: ingestion
         * keys are secrets, and a mistyped-but-nearly-valid token in a
         * log line is a credential leak. The request attributes give
         * operators enough to correlate with the sender. At debug, and
         * counted, as a missing token is (#10703).
         */
        logger.debug(
          "Invalid service token.",
          getLogAttributesFromRequest(req as any),
        );
        TelemetryIngestUnknownKeyRefusals.record({
          refusal: UnknownIngestionKeyRefusal.Unknown,
          surface: surface,
        });

        /*
         * 401 is deliberate (see the missing-token branch above): a
         * silent 200 drops the payload while the client believes the
         * export succeeded.
         */
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Invalid ingestion token. Send a valid OneUptime telemetry ingestion key in the x-oneuptime-token header.",
          ),
          CLIENT_REFUSAL,
        );
      }

      /*
       * Kill switch, checked before anything else about the key, so that
       * turning a leaked key off is the one action guaranteed to stop it
       * regardless of which surface it is hitting or what its allowlist says.
       *
       * 422 (NotAuthorizedException) rather than 401: the credential was
       * recognised, it is simply not permitted to write. That distinction is
       * what lets a customer tell "I pasted the wrong key" apart from
       * "someone switched my key off", which are very different Tuesday
       * afternoons. Like 401, 422 is non-retryable under the OTLP spec.
       */
      if (policy.isEnabled === false) {
        TelemetryIngest.recordRefusal(
          policy,
          TelemetryIngestRefusalReason.KeyDisabled,
          surface,
        );

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "This telemetry ingestion key has been disabled.",
          ),
          CLIENT_REFUSAL,
        );
      }

      /*
       * Expiry. 401, like the missing- and invalid-token branches above,
       * rather than the kill switch's 422: an expired key no longer
       * authenticates anyone. OTLP treats 401 as non-retryable, so a
       * collector holding an expired key logs the failure instead of
       * retry-storming an endpoint that will never accept it again.
       *
       * The exact expiry timestamp is deliberately kept out of the response.
       * The caller has failed to authenticate; the key's configuration is
       * visible in the dashboard to the people actually entitled to it, and
       * there is no reason to hand details of a project's credentials to
       * whoever happens to be holding a dead one.
       */
      if (policy.expiresAt && policy.expiresAt.getTime() <= Date.now()) {
        TelemetryIngest.recordRefusal(
          policy,
          TelemetryIngestRefusalReason.KeyExpired,
          surface,
        );

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "This telemetry ingestion key expired.",
          ),
          CLIENT_REFUSAL,
        );
      }

      const isBrowserKey: boolean =
        policy.keyType === TelemetryIngestionKeyType.Browser;

      const resolvedClientOrigin: string | undefined =
        resolveTelemetryClientOrigin({
          req: req,
          surface: surface,
          isPublicKey: PUBLIC_INGESTION_KEY_TYPES.has(policy.keyType),
        });

      if (resolvedClientOrigin !== undefined) {
        (req as TelemetryRequest).resolvedClientOrigin = resolvedClientOrigin;
      }

      if (isBrowserKey) {
        /*
         * Surface allowlist. `surface === null` (the legacy alias) is not in
         * the set by construction, so an un-migrated route refuses browser
         * keys - see isAuthorizedServiceMiddleware for why that is the safe
         * direction.
         */
        const isSurfaceAllowedForBrowserKey: boolean =
          surface !== null && BROWSER_ALLOWED_INGEST_SURFACES.has(surface);

        if (!isSurfaceAllowedForBrowserKey) {
          const readableSurfaceName: string = surface
            ? getIngestSurfaceReadableName(surface)
            : UNNAMED_SURFACE_READABLE_NAME;

          TelemetryIngest.recordRefusal(
            policy,
            TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere,
            surface,
          );

          return Response.sendErrorResponse(
            req,
            res,
            new NotAuthorizedException(
              `A browser ingestion key cannot be used for ${readableSurfaceName}. Use a server ingestion key.`,
            ),
            CLIENT_REFUSAL,
          );
        }

        const originRefusalMessage: string | null =
          TelemetryIngest.getOriginRefusalMessage(resolvedClientOrigin, policy);

        if (originRefusalMessage) {
          TelemetryIngest.recordRefusal(
            policy,
            TelemetryIngestRefusalReason.OriginNotAllowed,
            surface,
          );

          return Response.sendErrorResponse(
            req,
            res,
            new NotAuthorizedException(originRefusalMessage),
            CLIENT_REFUSAL,
          );
        }
      }

      /*
       * A Mobile key (issue #6457): a mobile app's OTLP traces, logs and
       * metrics over HTTP, and its own React Native session replays (issue
       * #10540), and nothing else - never another surface, another app's
       * recordings or a web page. Checked before the rate limit, as the
       * browser rules are, so a key copied out of an app and pointed
       * somewhere else is refused without spending its fleet's requests.
       */
      if (policy.keyType === TelemetryIngestionKeyType.Mobile) {
        const mobileRefusalMessage: string | null = getMobileKeyRefusalMessage({
          req: req,
          surface: surface,
          pinnedServiceName: policy.pinnedServiceName,
        });

        if (mobileRefusalMessage) {
          TelemetryIngest.recordRefusal(
            policy,
            TelemetryIngestRefusalReason.MobileKeyNotAllowedHere,
            surface,
          );

          return Response.sendErrorResponse(
            req,
            res,
            new NotAuthorizedException(mobileRefusalMessage),
            CLIENT_REFUSAL,
          );
        }
      }

      /*
       * An identity registration surface (the Kubernetes agent Runner, the
       * Kubernetes AI agent) mints the identity every kubectl job for a
       * cluster is targeted at, so it takes a project-wide server key. A key
       * pinned to one service's name was scoped by its owner to that
       * service's telemetry; it is refused here, before the rate limiter,
       * rather than letting it stand up cluster access it was never meant
       * to reach.
       */
      if (
        surface &&
        IDENTITY_REGISTRATION_SURFACES.has(surface) &&
        policy.pinnedServiceName
      ) {
        TelemetryIngest.recordRefusal(
          policy,
          TelemetryIngestRefusalReason.PinnedKeyNotAllowedHere,
          surface,
        );

        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            getPinnedKeyRegistrationRefusalMessage(surface),
          ),
          CLIENT_REFUSAL,
        );
      }

      /*
       * Rate limit.
       *
       * A null effective limit means "no limit", and it short-circuits BEFORE
       * Redis is touched. That is why the limit is computed here rather than
       * left to the limiter: the overwhelmingly common case is an existing
       * Server key with no configured limit, and that path must pay literally
       * nothing - no client lookup, no round trip, no added latency on every
       * OTLP payload the product accepts. This feature is not allowed to make
       * today's ingest slower.
       */
      const effectiveLimitPerMinute: number | null =
        getEffectiveRequestsPerMinuteLimit(policy, surface);

      if (effectiveLimitPerMinute !== null) {
        const decision: TelemetryIngestionKeyLimitDecision =
          await TelemetryIngestionKeyRateLimiter.consume({
            ingestionKeyId: policy.ingestionKeyId,
            limitPerMinute: effectiveLimitPerMinute,
          });

        if (
          decision.outcome === TelemetryIngestionKeyLimitOutcome.RateLimited
        ) {
          if (decision.retryAfterSeconds) {
            TelemetryIngest.setRetryAfterHeader(
              res,
              decision.retryAfterSeconds,
            );
          }

          /*
           * Log only the request that crossed the line. A rejected client
           * keeps knocking by definition, so logging every refusal turns an
           * ingest flood into a second flood in the log pipeline - which is
           * exactly what an operator does not need while trying to work out
           * WHICH key is being abused.
           */
          if (decision.isFirstRejectionInWindow) {
            logger.warn(
              `TelemetryIngest: ingestion key ${policy.ingestionKeyId.toString()} exceeded its limit of ${effectiveLimitPerMinute} requests per minute`,
            );
          }

          TelemetryIngest.recordRefusal(
            policy,
            TelemetryIngestRefusalReason.KeyRequestsPerMinute,
            surface,
          );

          return Response.sendErrorResponse(
            req,
            res,
            new TooManyRequestsException(
              "Too many telemetry requests for this ingestion key. Please retry later.",
            ),
            CLIENT_REFUSAL,
          );
        }

        if (
          decision.outcome ===
          TelemetryIngestionKeyLimitOutcome.CounterUnavailable
        ) {
          /*
           * FAIL OPEN. Redis is unreachable, so no ceiling can be honoured
           * either way, and we admit the request.
           *
           * This limit bounds ABUSE of a key that leaked; it is not a privacy
           * control and not a hard billing quota. Failing closed would stop
           * every paying customer's production telemetry for the length of a
           * Redis blip, and the gap is permanent because dropped spans are
           * never replayed - an infrastructure hiccup would become
           * customer-visible data loss, with the operator's incident
           * dashboards dark at exactly the wrong moment. Failing open hands
           * an attacker who already holds a scraped key an unbounded window
           * for the duration of the blip, while the origin allowlist, the
           * surface allowlist and the kill switch all still apply (they
           * resolve from Postgres, not Redis) and Redis being down is itself
           * alarmed on.
           *
           * SessionReplayRateLimiter makes the opposite call for the opposite
           * reason: a recording is a video of a real person, and accepting an
           * unbounded volume of that is not a recoverable mistake.
           */
          if (TelemetryIngest.shouldLogCounterUnavailable()) {
            logger.warn(
              "TelemetryIngest: ingestion key rate limit counter unavailable, admitting telemetry unthrottled",
            );
          }
        }
      }

      /*
       * The body, now that its sender is known (#10702): read here, after
       * every check of the key and its rate, and before the budget, which
       * measures it. A refused read (over the route's limit, a gzip body
       * that does not inflate) is answered by the error handler, as
       * StartServer's was.
       */
      if (readBody) {
        const readError: unknown = await TelemetryIngest.readBodyAfterKey(
          readBody,
          req,
          res,
        );

        /*
         * A reader that answered the request itself - OTLP's 413 for a body
         * over its cap, or 415 for a coding the worker cannot undo; the
         * Vercel drain's 403 for a delivery Vercel did not sign - or whose
         * connection closed first ends it here: nothing more is counted or
         * run (#10814).
         */
        if (readError === ANSWERED_BY_READER) {
          return;
        }

        if (readError) {
          return next(readError);
        }
      }

      /*
       * Ingestion budgets: the project's daily budget and per-second rate for
       * this surface's signal, and the key's own. Nothing is read from Redis
       * - or measured - unless one is in force (TelemetryIngestionBudget), so
       * a project without a budget pays two in-process lookups here.
       */
      const budgetSignal: TelemetryIngestionBudgetSignal | null =
        getTelemetryIngestionBudgetSignalForSurface(surface);

      if (budgetSignal && surface) {
        const admission: TelemetryIngestionBudgetAdmission =
          await TelemetryIngestionBudget.admit({
            projectId: policy.projectId,
            signal: budgetSignal,
            ingestionKeyPolicy: policy,
            mode: DEFERRED_BODY_SURFACES.has(surface)
              ? TelemetryIngestionBudgetAdmissionMode.Check
              : TelemetryIngestionBudgetAdmissionMode.Refuse,
            measure: () => {
              return measureTelemetryIngestRequest({
                req: req,
                surface: surface,
              });
            },
          });

        if (admission.refusal) {
          SpanUtil.addAttributesToCurrentSpan({
            projectId: policy.projectId.toString(),
            telemetryIngestionBudgetRefusal: admission.refusal.kind,
            telemetryIngestionBudgetScope: admission.refusal.scope,
          });

          TelemetryIngest.recordRefusal(
            policy,
            getTelemetryIngestRefusalReasonForBudget(admission.refusal),
            surface,
          );

          return sendTelemetryIngestionBudgetRefusal({
            req: req,
            res: res,
            refusal: admission.refusal,
            surface: surface,
          });
        }

        // Even null: the queue then knows this request was already decided.
        (req as TelemetryRequest).telemetryIngestionBudgetCharge =
          admission.charge;
      }

      (req as TelemetryRequest).projectId = policy.projectId;
      (req as TelemetryRequest).ingestionKeyPolicy = policy;

      /*
       * Tag span with project context for telemetry ingestion observability.
       * Key type and surface are here because they are the two dimensions
       * this feature is judged on: "are browser keys actually being used, and
       * where" is unanswerable without them, and they turn "refusal rate by
       * key type" into a one-line query.
       */
      SpanUtil.addAttributesToCurrentSpan({
        projectId: policy.projectId.toString(),
        telemetryIngestionKeyType: policy.keyType,
        telemetryIngestSurface: surface ? surface.toString() : "unspecified",
      });

      /*
       * The key is in use once the route has accepted what it sent, not
       * yet: admitted here, the request can still be refused by its route
       * (a body it cannot read, a 503 while the queue cannot take it).
       * Stamped when the route answers with a success, which every ingest
       * route does only once it has taken the data - the moment the OTLP
       * gRPC server stamps at, the export already in the queue (issue
       * #8021). Through the helper every ingest path shares, fire and
       * forget.
       */
      TelemetryIngestionKeyLastUsed.stampWhenAccepted(policy, res);

      next();
    } catch (err) {
      /*
       * Record on THIS middleware's own @CaptureSpan span before handing the
       * error to Express. The decorator sees a normal return (we call
       * next(err) rather than rethrowing — Express 4 does not catch a
       * rejection from an async middleware), so its recorder never runs and
       * without this the error is invisible on the span it actually belongs
       * to. Goes through SpanUtil so the event is typed by class name rather
       * than by HTTP status, and so a rejected credential produces a `fault`
       * event instead of an Issue.
       */
      SpanUtil.recordExceptionOnCurrentSpan(err);

      /*
       * A billing refusal (no payment method, a blocked project) is thrown
       * while the key resolves, so it reaches here, not a branch above. The
       * key service noted which key it was thrown for; count it against
       * that key, on this surface. Anything else counts nothing.
       */
      recordTelemetryIngestBillingRefusal({ err, surface });

      return next(err);
    }
  }

  /*
   * Run a route's body reader and resolve with what it passed on: nothing
   * once the body is read, or the error it was refused with - or
   * ANSWERED_BY_READER once the request was answered, or its connection
   * closed, before the reader went on: a reader that answers its own
   * refusal goes no further (OTLP's parseBody, the Vercel drain's signature
   * check), and would otherwise leave this waiting. What comes first wins.
   * Never rejects: a reader that throws is refused with what it threw.
   */
  private static readBodyAfterKey(
    readBody: RequestHandler,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve: (err: unknown) => void): void => {
      let isSettled: boolean = false;

      const settle: (outcome: unknown) => void = (outcome: unknown): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        resolve(outcome);
      };

      TelemetryIngest.onceAnswered(res, (): void => {
        settle(ANSWERED_BY_READER);
      });

      try {
        readBody(req, res, ((err?: unknown): void => {
          settle(err);
        }) as NextFunction);
      } catch (err) {
        settle(err);
      }
    });
  }

  /*
   * Calls `answered` once the response is sent ("finish") or its connection
   * closes ("close"), whichever is first. Reached through a runtime check,
   * as setRetryAfterHeader is: unit tests hand this middleware a bare
   * response object.
   */
  private static onceAnswered(
    res: ExpressResponse,
    answered: () => void,
  ): void {
    const once: unknown = (res as unknown as Record<string, unknown>)["once"];

    if (typeof once !== "function") {
      return;
    }

    for (const event of ["finish", "close"]) {
      (once as (event: string, listener: () => void) => void).call(
        res,
        event,
        answered,
      );
    }
  }

  /*
   * Count a refusal against the key that sent it (issue #6378), for the
   * RUM setup check and the key's own page. In memory, written in batches
   * (TelemetryIngestRefusalRecorder: a key refused again and again is
   * written at most once per five minutes), so a flood of refusals is never
   * a flood of writes. Never throws.
   */
  private static recordRefusal(
    policy: TelemetryIngestionKeyPolicy,
    reason: TelemetryIngestRefusalReason,
    surface: TelemetryIngestSurface | null,
  ): void {
    TelemetryIngestRefusalRecorder.record({
      projectId: policy.projectId,
      ingestionKeyId: policy.ingestionKeyId,
      reason,
      surface,
    });
  }

  /*
   * Origin enforcement for a Browser key. Returns the refusal message, or
   * null when the request may proceed.
   *
   * NOTE THE DELIBERATE ASYMMETRY WITH SessionReplayGateCache: there an empty
   * allowlist means "any origin", because session replay shipped that way and
   * tightening it would break live installations. Here an empty allowlist
   * REFUSES. A browser key is only safe to publish in a page because the
   * allowlist exists - it is the one thing standing between "a credential
   * anyone can read" and "a credential anyone can use" - so reading "no
   * allowlist" as "any origin" would hand out precisely the unbounded public
   * write key this whole feature exists to eliminate. Empty must fail closed.
   *
   * TelemetryIngestionKeyService refuses to create or update a Browser key
   * with an empty allowlist, so for keys created after this ships the branch
   * is unreachable; it is here for rows that predate it and for anything that
   * writes the table without going through the service.
   *
   * AND BE HONEST ABOUT WHAT THIS BUYS: Origin is a browser-enforced header.
   * A browser will not let page JavaScript forge it, which is what makes it
   * meaningful against the actual threat here - someone lifting a key out of
   * one site's page source and using it from another site. A non-browser
   * client (curl, a script, a proxy) sets any Origin it likes, so this stops
   * casual key reuse and nothing more. What actually contains a determined
   * attacker is the rest of the set: the per-key rate limit bounds the
   * volume, the pinned service.name stops forged data masquerading as backend
   * telemetry, and the kill switch ends it outright.
   */
  private static getOriginRefusalMessage(
    origin: string | undefined,
    policy: TelemetryIngestionKeyPolicy,
  ): string | null {
    if (!origin) {
      /*
       * Say the header is missing rather than echoing an empty string into
       * the message - "Origin  is not allowed" reads like a bug and tells the
       * customer nothing about what to fix.
       */
      return "This request did not send an Origin header, so it cannot be checked against the allowed origins of this browser ingestion key. Use a mobile ingestion key in a mobile app, and a server ingestion key on a server.";
    }

    if (
      policy.allowedOrigins.length === 0 ||
      !OriginAllowList.matches(origin, policy.allowedOrigins)
    ) {
      /*
       * The origin is echoed back on purpose. It is the caller's own value,
       * never a secret, and it is the single most useful thing a customer can
       * be told while debugging an allowlist - the usual cause is a scheme,
       * port or trailing-slash mismatch that stays invisible until the two
       * strings are put side by side.
       */
      return `Origin ${origin} is not allowed for this browser ingestion key.`;
    }

    return null;
  }

  private static counterUnavailableLastLoggedAt: number = 0;

  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now - TelemetryIngest.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    TelemetryIngest.counterUnavailableLastLoggedAt = now;

    return true;
  }

  /*
   * Reached through a runtime check because the response object is not always
   * a real Express response - unit tests hand this middleware a bare object -
   * and a missing header on a 429 is a far better outcome than a TypeError
   * that turns a deliberate refusal into a 500. Same helper as
   * PublicDashboardRateLimit.
   */
  private static setRetryAfterHeader(
    res: ExpressResponse,
    retryAfterSeconds: number,
  ): void {
    const setHeader: unknown = (res as unknown as Record<string, unknown>)[
      "setHeader"
    ];

    if (typeof setHeader === "function") {
      (setHeader as (name: string, value: string) => void).call(
        res,
        "Retry-After",
        String(retryAfterSeconds),
      );
    }
  }
}
