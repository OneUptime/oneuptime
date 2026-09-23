import {
  IS_KUBERNETES_AGENT_MODE,
  KUBERNETES_AGENT_CLUSTER_NAME,
  KUBERNETES_AGENT_INGESTION_KEY,
  ONEUPTIME_BASE_URL,
  RUNNER_ID,
  RUNNER_INGEST_URL,
  RUNNER_KEY,
  RUNNER_NAME,
  RUNNER_DESCRIPTION,
  RUNNER_VERSION,
} from "../Config";
import RunnerCapabilities from "../Utils/RunnerCapabilities";
import KubernetesPosture from "../Utils/KubernetesPosture";
import {
  KubernetesRunnerPosture,
  isTransientKubernetesAgentRegistrationRefusal,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import { HasClusterKey } from "Common/Server/EnvironmentConfig";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";

/*
 * The longest server reason carried into a log line. The server's refusals
 * that need an operator explain what to change and where, and that runs
 * past 500 characters for a long cluster name; the ending is the part that
 * says what to do.
 */
const SERVER_REASON_MAX_CHARS: number = 1000;

/*
 * A registration the server answered and refused, with the status it
 * answered, the machine-readable reason it gave (a 403 from
 * /register-kubernetes-agent carries one) and, when it said, how long until
 * it would admit the Runner. The retry loop reads all three to pick its
 * wait and how loudly to log.
 */
export class RegistrationRefusedError extends Error {
  public readonly statusCode: number;
  public readonly retryAfterSeconds: number | null;
  public readonly reason: string | null;

  public constructor(data: {
    message: string;
    statusCode: number;
    retryAfterSeconds?: number | null | undefined;
    reason?: string | null | undefined;
  }) {
    super(data.message);
    this.name = "RegistrationRefusedError";
    this.statusCode = data.statusCode;
    this.retryAfterSeconds = data.retryAfterSeconds ?? null;
    this.reason = data.reason ?? null;
  }

  /*
   * A kubernetes-agent registration the server will keep refusing until an
   * operator acts: a 403 whose reason is not one that clears on its own —
   * including a 403 with no reason at all, which only a proxy in front of
   * the server (or a server that predates the reasons) sends.
   */
  public needsOperator(): boolean {
    return (
      this.statusCode === 403 &&
      !isTransientKubernetesAgentRegistrationRefusal(this.reason)
    );
  }
}

/*
 * Thrown by an attempt that noticed, just before its request, that the
 * caller ended the round (the Runner is signing off). Not a failure: the
 * round ends quietly and nothing reaches the server.
 */
export class RegistrationAbandonedError extends Error {
  public constructor() {
    super("The registration round was ended before its request was sent.");
    this.name = "RegistrationAbandonedError";
  }
}

// The machine-readable `reason` of a refusal body, or null when it has none.
export function getServerRefusalReason(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const reason: unknown = (data as Record<string, unknown>)["reason"];

  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

/*
 * What the server said about a refused request, from its JSON body
 * (`{ message }`, or `{ error }` from a layer in front of it): whitespace
 * collapsed and capped. Empty for a body that is not an object — an
 * ingress's HTML error page says nothing an operator can act on here.
 */
export function getServerReason(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }

  for (const key of ["message", "error"]) {
    const value: unknown = (data as Record<string, unknown>)[key];

    if (typeof value === "string" && value.trim()) {
      const collapsed: string = value.replace(/\s+/g, " ").trim();

      return collapsed.length > SERVER_REASON_MAX_CHARS
        ? `${collapsed.slice(0, SERVER_REASON_MAX_CHARS)}...`
        : collapsed;
    }
  }

  return "";
}

// A Retry-After header in seconds: digits only.
const RETRY_AFTER_SECONDS_PATTERN: RegExp = /^\d+$/;

/*
 * How long the server said to wait before trying again: a numeric
 * `retryAfterSeconds` in the body, or an HTTP Retry-After header in seconds.
 * Null when it said nothing usable.
 */
function getRetryAfterSeconds(result: HTTPResponse<JSONObject>): number | null {
  const fromBody: unknown =
    result.data && typeof result.data === "object"
      ? (result.data as JSONObject)["retryAfterSeconds"]
      : undefined;

  const headers: Record<string, unknown> = (result.headers || {}) as Record<
    string,
    unknown
  >;
  const fromHeader: unknown = headers["retry-after"] ?? headers["Retry-After"];

  for (const candidate of [fromBody, fromHeader]) {
    const seconds: number =
      typeof candidate === "number"
        ? candidate
        : typeof candidate === "string" &&
            RETRY_AFTER_SECONDS_PATTERN.test(candidate.trim())
          ? parseInt(candidate.trim(), 10)
          : NaN;

    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds;
    }
  }

  return null;
}

export default class Register {
  // Base retry interval; backoff doubles from here up to the cap below.
  private static readonly baseRetryIntervalInSeconds: number = 30;

  // Backoff cap: never wait longer than this between attempts.
  private static readonly maxRetryIntervalInSeconds: number = 5 * 60;

  /*
   * The kubernetes-agent Runner's cap. After a crash (no sign-off) the
   * server refuses the replacement pod until the dead instance's last
   * heartbeat is RUNNER_ALIVE_WINDOW_IN_MINUTES (5) old. A 5-minute cap on
   * doubling waits landed the retry that could be admitted at about 7.5
   * minutes; a 1-minute cap keeps every attempt well inside the window, so
   * the pod is back within a minute of it closing.
   */
  private static readonly kubernetesAgentMaxRetryIntervalInSeconds: number = 60;

  /*
   * The 403 that clears by itself (reason previous_instance_online): the
   * previous instance still looks online and is admitted on a known
   * schedule, so it is retried at a short fixed interval (or when the
   * server says), never with a growing backoff.
   */
  private static readonly kubernetesAgentPredecessorRetryInSeconds: number = 20;

  /*
   * Every other 403 on agent registration needs an operator (see
   * RegistrationRefusedError.needsOperator): the server keeps refusing
   * until someone changes the Runner row. Retrying fast only hammers the
   * server; a slow fixed interval still picks the fix up within minutes,
   * and restarting the pod picks it up at once.
   */
  private static readonly kubernetesAgentOperatorActionRetryInSeconds: number =
    5 * 60;

  /*
   * Register the AI agent, retrying FOREVER on failure. The server being
   * temporarily unreachable (boot ordering, migrations, network blips) must
   * never kill or give up on the agent container — it registers whenever
   * the server comes back. Backoff starts at 30s and doubles per
   * consecutive failure, capped at 5 minutes (1 minute for the
   * kubernetes-agent Runner, see getRetryDelaySeconds); every failure is
   * logged with the attempt count, the next wait and the server's reason —
   * a refusal that needs an operator only once, however often it repeats.
   */
  public static async registerRunner(): Promise<void> {
    await Register.registerWithRetries({ maxAttempts: null });
  }

  /*
   * The same registration with a bounded number of attempts, for callers
   * that must not hang forever — the heartbeat loop re-registering a
   * kubernetes-agent Runner whose key was rotated behind it. Resolves true
   * once registered, false when the budget is spent; the caller decides
   * what to do next (the heartbeat loop simply starts counting rejections
   * again, so a revoked ingestion key produces a bounded, single-flight
   * trickle of attempts rather than an ever-growing pile of loops).
   */
  public static async tryRegisterRunner(data: {
    maxAttempts: number;
    /*
     * Asked before every attempt, and again just before an attempt sends
     * its request; false ends the round at once (resolving false). The
     * heartbeat loop answers false once the Runner is signing off.
     */
    shouldContinue?: (() => boolean) | undefined;
    /*
     * Handed each attempt as it starts; it settles when the attempt's
     * request has been answered (or failed). The heartbeat loop waits for
     * the one in flight before the Runner signs off, so no registration
     * the server processes after the /disconnect can mark the Runner
     * online again — and an attempt that succeeded has stored its new key
     * by then, so the /disconnect carries it.
     */
    onAttempt?: ((attempt: Promise<void>) => void) | undefined;
  }): Promise<boolean> {
    return Register.registerWithRetries({
      maxAttempts: Math.max(1, Math.floor(data.maxAttempts)),
      shouldContinue: data.shouldContinue,
      onAttempt: data.onAttempt,
    });
  }

  /*
   * How long to wait after a failed attempt. Doubling from 30s, capped at
   * 5 minutes — or at 1 minute for the kubernetes-agent Runner, a short
   * fixed wait (or the server's own hint) for its 403 while the previous
   * instance ages out, and a slow fixed wait for a 403 that needs an
   * operator. Public for tests.
   */
  public static getRetryDelaySeconds(data: {
    attempt: number;
    error: unknown;
    isKubernetesAgent: boolean;
  }): number {
    const doubling: number =
      Register.baseRetryIntervalInSeconds *
      Math.pow(2, Math.max(0, data.attempt - 1));

    if (!data.isKubernetesAgent) {
      return Math.min(doubling, Register.maxRetryIntervalInSeconds);
    }

    if (
      data.error instanceof RegistrationRefusedError &&
      data.error.statusCode === 403
    ) {
      if (data.error.needsOperator()) {
        return Register.kubernetesAgentOperatorActionRetryInSeconds;
      }

      const hint: number | null = data.error.retryAfterSeconds;

      return hint === null
        ? Register.kubernetesAgentPredecessorRetryInSeconds
        : Math.min(
            Math.max(1, Math.ceil(hint)),
            Register.kubernetesAgentMaxRetryIntervalInSeconds,
          );
    }

    return Math.min(
      doubling,
      Register.kubernetesAgentMaxRetryIntervalInSeconds,
    );
  }

  private static async registerWithRetries(data: {
    maxAttempts: number | null;
    shouldContinue?: (() => boolean) | undefined;
    onAttempt?: ((attempt: Promise<void>) => void) | undefined;
  }): Promise<boolean> {
    let attempt: number = 0;
    /*
     * The refusal that needs an operator, as last logged at error level:
     * the same refusal again is logged at debug, so a pod waiting for an
     * operator says what to do once instead of every few minutes forever.
     */
    let loggedOperatorRefusal: string | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;

      if (data.shouldContinue && !data.shouldContinue()) {
        logger.debug("Registration round ended: the Runner is shutting down.", {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        return false;
      }

      try {
        logger.debug(`Registering Runner. Attempt: ${attempt}`, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        const attemptInFlight: Promise<void> = Register._registerRunner({
          shouldContinue: data.shouldContinue,
        });
        if (data.onAttempt) {
          data.onAttempt(attemptInFlight);
        }
        await attemptInFlight;
        logger.debug(`Runner registered successfully.`, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        return true;
      } catch (error) {
        if (error instanceof RegistrationAbandonedError) {
          logger.debug(
            "Registration round ended before its request: the Runner is shutting down.",
            { runnerName: RUNNER_NAME } as LogAttributes,
          );
          return false;
        }

        const waitSeconds: number = Register.getRetryDelaySeconds({
          attempt,
          error,
          isKubernetesAgent: IS_KUBERNETES_AGENT_MODE,
        });

        const isLastAttempt: boolean =
          data.maxAttempts !== null && attempt >= data.maxAttempts;

        const needsOperator: boolean =
          IS_KUBERNETES_AGENT_MODE &&
          error instanceof RegistrationRefusedError &&
          error.needsOperator();

        if (
          needsOperator &&
          error instanceof Error &&
          error.message === loggedOperatorRefusal
        ) {
          logger.debug(
            `Registration still refused (attempt ${attempt}) for the reason logged above; ${
              isLastAttempt
                ? "giving up on this round"
                : `retrying after ${waitSeconds} seconds`
            }.`,
            { runnerName: RUNNER_NAME } as LogAttributes,
          );

          if (isLastAttempt) {
            return false;
          }

          await Sleep.sleep(waitSeconds * 1000);
          continue;
        }

        /*
         * The server answered: it is reachable, and the reason is in the
         * next log line. Only a request that got no answer at all is
         * waiting for the server to become reachable.
         */
        const retryNote: string = needsOperator
          ? "the server keeps refusing until an operator acts; what to do is logged below (and only once while the refusal stays the same)."
          : error instanceof RegistrationRefusedError
            ? "the Runner keeps retrying; the reason the server gave is logged below."
            : "the Runner keeps retrying until the server is reachable.";

        logger.error(
          isLastAttempt
            ? `Failed to register Runner (attempt ${attempt} of ${data.maxAttempts}). Giving up on this round; the Runner keeps its current identity and will try again later.`
            : `Failed to register Runner (attempt ${attempt}). Retrying after ${waitSeconds} seconds — ${retryNote}`,
          { runnerName: RUNNER_NAME } as LogAttributes,
        );
        logger.error(error, { runnerName: RUNNER_NAME } as LogAttributes);

        loggedOperatorRefusal =
          needsOperator && error instanceof Error ? error.message : null;

        if (isLastAttempt) {
          return false;
        }

        await Sleep.sleep(waitSeconds * 1000);
      }
    }
  }

  /*
   * Turn a failed registration into a sentence an operator can act on.
   *
   * A bare status code is close to useless here — the Runner is a container
   * on someone else's host and the only thing they can see is this line. A
   * 404 in particular does NOT mean "wrong credentials": bad credentials are
   * answered 400 by the ingest middleware. It means the request never reached
   * the Runner work mount at all, which in practice is an ingress that does
   * not route /runner-ingest to the app, or an ONEUPTIME_URL pointing
   * somewhere that is not a OneUptime server.
   */
  public static describeRegistrationFailure(data: {
    statusCode: number;
    url: URL;
  }): string {
    const base: string = `Failed to register Runner: ${data.statusCode} from ${data.url.toString()}`;

    if (data.statusCode === 404) {
      return (
        `${base}. A 404 means the request did not reach the Runner work mount — the credentials were never checked ` +
        `(bad credentials answer 400, not 404). Check that ONEUPTIME_URL is the base URL of your OneUptime server ` +
        `(no trailing path), and that your ingress routes /runner-ingest to the app service.`
      );
    }

    if (data.statusCode === 400 || data.statusCode === 401) {
      return `${base}. The server rejected the credentials — check ONEUPTIME_RUNNER_ID and ONEUPTIME_RUNNER_KEY against Project Settings > Runners.`;
    }

    return base;
  }

  /*
   * The same, for the Runner the kubernetes-agent chart installs — which
   * has no ONEUPTIME_RUNNER_ID or ONEUPTIME_RUNNER_KEY to check, and whose
   * refusals mostly mean something else: a 422 is a disabled key, a 429 a
   * limit, and a 403 says by its `reason` whether it clears by itself (the
   * previous instance still looking online) or needs an operator. The
   * server's own reason is always appended — this log line is all the
   * operator of the pod gets to see.
   */
  public static describeKubernetesAgentRegistrationFailure(data: {
    statusCode: number;
    url: URL;
    clusterName: string;
    serverReason: string;
    // The machine-readable reason of a 403 (see KubernetesClusterAiAccess).
    reason?: string | null | undefined;
  }): string {
    const base: string = `Failed to register the Kubernetes agent Runner for cluster "${data.clusterName}": ${data.statusCode} from ${data.url.toString()}`;

    let explanation: string;

    switch (data.statusCode) {
      case 401:
        explanation =
          "The server rejected the ingestion key — check oneuptime.apiKey on the Kubernetes agent chart (it must be a server telemetry ingestion key from Project Settings > Telemetry Ingestion Keys).";
        break;
      case 403:
        explanation = Register.describeKubernetesAgentForbidden({
          clusterName: data.clusterName,
          reason: data.reason ?? null,
          hasServerReason: data.serverReason.length > 0,
        });
        break;
      case 404:
        explanation =
          "A 404 means the request did not reach the Runner work mount. Check that oneuptime.url on the Kubernetes agent chart is the base URL of your OneUptime server (no trailing path), and that your ingress routes /runner-ingest to the app service.";
        break;
      case 422:
        explanation =
          "The server recognised the ingestion key but refused it (a disabled key, or a key that is not a server ingestion key). Use an enabled server telemetry ingestion key in oneuptime.apiKey on the Kubernetes agent chart.";
        break;
      case 429:
        explanation =
          "Registration is rate limited, or the project reached its limit of in-cluster Runners. The Runner keeps retrying.";
        break;
      default:
        explanation =
          data.statusCode >= 500
            ? "The server could not handle the registration right now. The Runner keeps retrying."
            : "The server refused the registration.";
    }

    return `${base}. ${explanation}${
      data.serverReason ? ` Server said: ${data.serverReason}` : ""
    }`;
  }

  /*
   * A 403 on /register-kubernetes-agent, by the reason the server gave.
   * Only previous_instance_online clears by itself; every other reason —
   * and a 403 with none, which only a proxy in front of the server (or a
   * server that predates the reasons) sends — needs an operator, and is
   * never described as a wait.
   */
  private static describeKubernetesAgentForbidden(data: {
    clusterName: string;
    reason: string | null;
    hasServerReason: boolean;
  }): string {
    if (isTransientKubernetesAgentRegistrationRefusal(data.reason)) {
      return `The previous Runner instance for cluster "${data.clusterName}" still looks online — its pod was stopped without a clean shutdown (an OOM kill, a crash, a node loss), or another install uses the same clusterName. It is admitted automatically once that instance's last heartbeat is 5 minutes old, so no action is needed unless this keeps repeating for more than about 10 minutes (then check for a second install with the same clusterName).`;
    }

    const retry: string = `The Runner retries every ${Math.round(
      Register.kubernetesAgentOperatorActionRetryInSeconds / 60,
    )} minutes; restart this pod after the fix to register at once.`;

    switch (data.reason) {
      case "runner_holds_more_than_defaults":
        return `This does not clear on its own: an operator must act. The in-cluster Runner row for cluster "${data.clusterName}" is offline but holds more than an in-cluster Runner's defaults (credentials, secrets, "Runs Runbooks" or "Runs AI Code Fixes", or another cluster's AI access), and a new pod cannot prove it is the instance that held them. In Project Settings > Runners, take those away from that Runner or delete it — the server's own words follow. ${retry}`;
      case "runner_belongs_to_another_cluster":
        return `This does not clear on its own: an operator must act. The Runner row this cluster's in-cluster Runner registers as belongs to a different cluster. Rename or delete that Runner in Project Settings > Runners, or give this install its own clusterName on the Kubernetes agent chart — the server's own words follow. ${retry}`;
      default:
        if (data.reason) {
          return `The server refused the registration (reason "${data.reason}") and did not say that the refusal clears on its own, so an operator must act on what it says — the server's own words follow. ${retry}`;
        }

        /*
         * No reason at all: a server older than this Runner (whose only
         * such 403 was the previous instance still looking online), or a
         * proxy in front of it. Neither is described as a wait.
         */
        return data.hasServerReason
          ? `The server refused the registration without saying whether the refusal clears on its own (a OneUptime server older than this Runner does not). If its words below say the previous instance still looks online, that clears by itself about 5 minutes after that instance's last heartbeat; otherwise an operator must act on what they say. ${retry}`
          : `The server, or a proxy in front of it, refused the registration without saying why. Check the ingress or proxy in front of OneUptime for a rule that refuses /runner-ingest. ${retry}`;
    }
  }

  /*
   * Kubernetes-agent mode: exchange the project's ingestion key + the
   * cluster's name for a Runner identity bound to that cluster. The server
   * rotates the key on every registration, so a restarted pod never reuses
   * a credential it may have logged or lost.
   *
   * The server only re-keys a Runner that is offline or that proves it is
   * the same Runner by presenting its current key — an ingestion key alone
   * must never evict a live Runner. So a re-registration from a running
   * process (the heartbeat loop, after rejected heartbeats) sends the key
   * it holds as previousRunnerKey; a fresh pod has none to send and is
   * admitted once its predecessor is offline (or signed off cleanly).
   */
  private static async registerKubernetesAgentRunner(options: {
    shouldContinue?: (() => boolean) | undefined;
  }): Promise<void> {
    const registrationUrl: URL = URL.fromString(
      RUNNER_INGEST_URL.toString(),
    ).addRoute("/register-kubernetes-agent");

    const posture: KubernetesRunnerPosture = await KubernetesPosture.build();

    /*
     * Building the posture takes a moment (the first kubectl version probe
     * can take seconds); a Runner that began signing off meanwhile sends
     * nothing.
     */
    if (options.shouldContinue && !options.shouldContinue()) {
      throw new RegistrationAbandonedError();
    }

    const previousRunnerKey: string = LocalCache.getString(
      "RUNNER",
      "RUNNER_KEY",
    );

    logger.debug("Registering the Kubernetes agent Runner...", {
      runnerName: RUNNER_NAME,
      clusterName: KUBERNETES_AGENT_CLUSTER_NAME,
    } as LogAttributes);

    const result: HTTPResponse<JSONObject> = await API.post({
      url: registrationUrl,
      data: {
        clusterName: KUBERNETES_AGENT_CLUSTER_NAME,
        agentVersion: RUNNER_VERSION,
        allowWrites: posture.allowWrites === true,
        // Whether this Runner runs node operations (the node switch, see Config).
        allowNodeOperations: posture.allowNodeOperations === true,
        /*
         * The rest of the write scope, exactly as the heartbeat reports it.
         * The server stores the registration's posture over the last
         * heartbeat's, so a scope left out here would read as "no scope"
         * — every namespace, this pod's own included — until the next
         * heartbeat, and the server's pre-checks would let through writes
         * this Runner refuses. The list is always sent, so an empty one is
         * stored as "cluster-wide" rather than "did not say".
         */
        writeNamespaces: posture.writeNamespaces || [],
        ...(posture.podNamespace ? { podNamespace: posture.podNamespace } : {}),
        ...(posture.kubectlVersion
          ? { kubectlVersion: posture.kubectlVersion }
          : {}),
        ...(posture.agentChartVersion
          ? { agentChartVersion: posture.agentChartVersion }
          : {}),
        ...(previousRunnerKey ? { previousRunnerKey } : {}),
      },
      headers: {
        "x-oneuptime-token": KUBERNETES_AGENT_INGESTION_KEY || "",
      },
    });

    if (!result.isSuccess()) {
      /*
       * The server's messages on this route never echo the key; the key is
       * stripped anyway, since this text goes straight to the pod's log.
       */
      const ingestionKey: string = KUBERNETES_AGENT_INGESTION_KEY || "";
      const serverReason: string = ingestionKey
        ? getServerReason(result.data)
            .split(ingestionKey)
            .join("[redacted ingestion key]")
        : getServerReason(result.data);

      const reason: string | null = getServerRefusalReason(result.data);

      throw new RegistrationRefusedError({
        message: Register.describeKubernetesAgentRegistrationFailure({
          statusCode: result.statusCode,
          url: registrationUrl,
          clusterName: KUBERNETES_AGENT_CLUSTER_NAME || "",
          serverReason,
          reason,
        }),
        statusCode: result.statusCode,
        retryAfterSeconds: getRetryAfterSeconds(result),
        reason,
      });
    }

    const runnerId: unknown = result.data["runnerId"];
    const runnerKey: unknown = result.data["runnerKey"];

    if (typeof runnerId !== "string" || typeof runnerKey !== "string") {
      throw new Error(
        "The server's registration response carried no Runner identity.",
      );
    }

    LocalCache.setString("RUNNER", "RUNNER_ID", runnerId);
    LocalCache.setString("RUNNER", "RUNNER_KEY", runnerKey);

    const capabilities: JSONObject | undefined = result.data["capabilities"] as
      | JSONObject
      | undefined;

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: capabilities?.["canRunRunbooks"] === true,
      canRunCodeFixTasks: capabilities?.["canRunCodeFixTasks"] === true,
      canRunAiCommands: capabilities?.["canRunAiCommands"] !== false,
    });

    if (result.data["isBoundToCluster"] === false) {
      /*
       * bindingState says WHY: an operator may have deliberately cleared
       * the binding, which is not the same message as "another Runner has
       * it". A server that predates bindingState gets the general wording.
       */
      logger.warn(
        result.data["bindingState"] === "left_unbound_by_operator"
          ? `Cluster "${KUBERNETES_AGENT_CLUSTER_NAME}" has no Runner bound in the dashboard (an operator cleared it), so OneUptime AI will not use this in-cluster Runner until you select it on the cluster's AI page.`
          : `Cluster "${KUBERNETES_AGENT_CLUSTER_NAME}" is bound to a different Runner in the dashboard, so OneUptime AI will not use this in-cluster Runner until you select it on the cluster's AI page.`,
        { runnerName: RUNNER_NAME } as LogAttributes,
      );
    }

    if (!posture.kubectlVersion) {
      logger.warn(
        "kubectl was not found on this Runner — kubectl jobs will fail until it is available on the PATH.",
        { runnerName: RUNNER_NAME } as LogAttributes,
      );
    }

    logger.debug(`Kubernetes agent Runner registered as ${runnerId}.`, {
      runnerName: RUNNER_NAME,
    } as LogAttributes);
  }

  private static async _registerRunner(
    options: { shouldContinue?: (() => boolean) | undefined } = {},
  ): Promise<void> {
    if (IS_KUBERNETES_AGENT_MODE) {
      await Register.registerKubernetesAgentRunner(options);
      return;
    }

    if (HasClusterKey) {
      // Clustered mode: Auto-register and get ID from server
      const aiAgentRegistrationUrl: URL = URL.fromString(
        ONEUPTIME_BASE_URL.toString(),
      ).addRoute("/api/ai-agent/register");

      logger.debug("Registering Runner...", {
        runnerName: RUNNER_NAME,
      } as LogAttributes);
      logger.debug("Sending request to: " + aiAgentRegistrationUrl.toString(), {
        runnerName: RUNNER_NAME,
      } as LogAttributes);

      const result: HTTPResponse<JSONObject> = await API.post({
        url: aiAgentRegistrationUrl,
        data: {
          aiAgentKey: RUNNER_KEY,
          runnerName: RUNNER_NAME,
          aiAgentDescription: RUNNER_DESCRIPTION,
          clusterKey: ClusterKeyAuthorization.getClusterKey(),
        },
      });

      if (!result.isSuccess()) {
        logger.error(
          `Failed to register Runner. Status: ${result.statusCode}`,
          { runnerName: RUNNER_NAME } as LogAttributes,
        );
        logger.error(result.data, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        throw new Error("Failed to register Runner: HTTP " + result.statusCode);
      }

      logger.debug("Runner Registered", {
        runnerName: RUNNER_NAME,
      } as LogAttributes);
      logger.debug(result.data, {
        runnerName: RUNNER_NAME,
      } as LogAttributes);

      const aiAgentId: string | undefined = result.data["_id"] as
        | string
        | undefined;

      if (!aiAgentId) {
        logger.error("Runner ID not found in response", {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        logger.error(result.data, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        throw new Error("Runner ID not found in registration response");
      }

      LocalCache.setString("RUNNER", "RUNNER_ID", aiAgentId);
    } else {
      /*
       * Project-scoped mode: the id and key were issued by the dashboard
       * (Settings > Runners), so they identify a Runner row. Validate
       * them against the Runner work mount, which is the endpoint that
       * authenticates against that table — the AIAgent alive endpoint would
       * reject them, since no AIAgent row is ever created for a
       * dashboard-issued Runner.
       *
       * A missing RUNNER_ID is thrown (NOT process.exit) so the retry-forever
       * loop keeps the container alive and logging the misconfiguration — a
       * crash loop hides the message.
       */
      if (!RUNNER_ID) {
        throw new Error(
          "ONEUPTIME_RUNNER_ID must be set for a project-scoped Runner (create one in Project Settings > Runners), or a cluster key for the in-cluster Runner. The Runner keeps retrying until one is provided.",
        );
      }

      const heartbeatUrl: URL = URL.fromString(
        RUNNER_INGEST_URL.toString(),
      ).addRoute("/heartbeat");

      logger.debug("Registering Runner...", {
        runnerId: RUNNER_ID?.toString(),
        runnerName: RUNNER_NAME,
      } as LogAttributes);
      logger.debug("Sending request to: " + heartbeatUrl.toString(), {
        runnerId: RUNNER_ID?.toString(),
        runnerName: RUNNER_NAME,
      } as LogAttributes);

      const result: HTTPResponse<JSONObject> = await API.post({
        url: heartbeatUrl,
        data: {
          agentId: RUNNER_ID.toString(),
          agentKey: RUNNER_KEY.toString(),
          agentVersion: RUNNER_VERSION,
        },
      });

      if (result.isSuccess()) {
        LocalCache.setString(
          "RUNNER",
          "RUNNER_ID",
          RUNNER_ID.toString() as string,
        );

        /*
         * The dashboard's capability toggles for this Runner. Absent when the
         * server predates them — RunnerCapabilities then keeps the historical
         * env-var behaviour.
         */
        const capabilities: JSONObject | undefined = result.data[
          "capabilities"
        ] as JSONObject | undefined;

        if (capabilities) {
          RunnerCapabilities.setGrantedByServer({
            canRunRunbooks: capabilities["canRunRunbooks"] !== false,
            canRunCodeFixTasks: capabilities["canRunCodeFixTasks"] === true,
            canRunAiCommands: capabilities["canRunAiCommands"] === true,
          });
        }

        logger.debug("Runner registered successfully", {
          runnerId: RUNNER_ID?.toString(),
          runnerName: RUNNER_NAME,
        } as LogAttributes);
      } else {
        /*
         * The credentials may predate the Runner merge — an AI Agent's id and
         * key, which live in a different table and validate on a different
         * endpoint. Fall back to it so an upgraded container with old
         * credentials still comes up; it keeps the code-fix capability, which
         * is all an AI Agent ever had.
         */
        const aliveUrl: URL = URL.fromString(
          ONEUPTIME_BASE_URL.toString(),
        ).addRoute("/api/ai-agent/alive");

        const legacyResult: HTTPResponse<JSONObject> = await API.post({
          url: aliveUrl,
          data: {
            aiAgentId: RUNNER_ID.toString(),
            aiAgentKey: RUNNER_KEY.toString(),
          },
        });

        if (!legacyResult.isSuccess()) {
          throw new Error(
            Register.describeRegistrationFailure({
              statusCode: result.statusCode,
              url: heartbeatUrl,
            }),
          );
        }

        LocalCache.setString(
          "RUNNER",
          "RUNNER_ID",
          RUNNER_ID.toString() as string,
        );

        RunnerCapabilities.setGrantedByServer({
          canRunRunbooks: false,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        });

        logger.warn(
          "Registered with legacy AI Agent credentials. Create a Runner under Settings > Runners and switch to its id and key — runbook execution needs one.",
          { runnerName: RUNNER_NAME } as LogAttributes,
        );
      }
    }

    logger.debug(
      `Runner ID: ${LocalCache.getString("RUNNER", "RUNNER_ID") || "Unknown"}`,
      { runnerName: RUNNER_NAME } as LogAttributes,
    );
  }
}
