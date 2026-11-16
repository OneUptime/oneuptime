/*
 * WHAT A RUNNER BUILD CAN DO IN A CODE FIX.
 *
 * A Runner declares these on every code-fix request it sends
 * (RUNNER_CODE_FIX_CAPABILITIES_FIELD in the request body), as a probe
 * declares its probeCapabilities, so the server can hand a Runner only what
 * that Runner understands - and keep handing an older Runner, which declares
 * none, exactly what it always did. Both ends of every capability ship in the
 * same release: the server reads it, and the Runner that declares it honours
 * it.
 *
 * Add a capability only in the build whose code honours it.
 */
enum RunnerCodeFixCapability {
  /*
   * The Runner asks OneUptime to open a fix's pull (or merge) request
   * (/ai-agent-data/open-pull-request) whenever the repository token's
   * answer says OneUptime opens it (serverOpensPullRequest), rather than
   * opening it itself with the token. So the token it is handed needs to
   * push the fix's branch and nothing more:
   *
   *   - GitHub: an installation token for the one repository that can push
   *     (contents) but not open a pull request (no pull_requests);
   *   - GitLab: a project access token OneUptime makes for the one run, on
   *     the one project, that can push (write_repository) but not call the
   *     API, and that OneUptime revokes when the run ends - rather than the
   *     connection's own token, wherever GitLab lets OneUptime make one;
   *   - Forgejo and Gitea: still the connection's token, which no API lets
   *     OneUptime narrow; the pull request is OneUptime's to open all the
   *     same.
   *
   * A Runner older than this opens the pull request itself, as it always
   * did, with a token that can.
   */
  ServerOpensPullRequests = "serverOpensPullRequests",
}

// The request body field a Runner declares its code-fix capabilities in.
export const RUNNER_CODE_FIX_CAPABILITIES_FIELD: string = "codeFixCapabilities";

/*
 * The field of a repository token's answer that says OneUptime opens the
 * run's pull (or merge) request (true), so the Runner asks it to
 * (/ai-agent-data/open-pull-request) rather than opening one with the token,
 * which may not be able to. Left out - by an older server, for a Runner that
 * did not declare ServerOpensPullRequests, or for a host OneUptime's server
 * does not reach - the Runner opens it itself, as it always did.
 */
export const SERVER_OPENS_PULL_REQUEST_FIELD: string = "serverOpensPullRequest";

// How many capabilities, of how many characters, a request is read for.
export const MAX_RUNNER_CODE_FIX_CAPABILITIES: number = 16;
export const MAX_RUNNER_CODE_FIX_CAPABILITY_LENGTH: number = 64;

export class RunnerCodeFixCapabilityUtil {
  /*
   * The capabilities a request body's field declares, as the server keeps
   * them: the ones this server knows, de-duplicated and bounded. Anything
   * that is not a list reads as none at all - an older Runner sends none -
   * and a capability this server does not know (a newer Runner's) is left
   * out, as one it cannot honour.
   */
  public static parse(value: unknown): Array<RunnerCodeFixCapability> {
    if (!Array.isArray(value)) {
      return [];
    }

    const known: Array<string> = Object.values(RunnerCodeFixCapability);
    const capabilities: Array<RunnerCodeFixCapability> = [];

    for (const entry of value.slice(0, MAX_RUNNER_CODE_FIX_CAPABILITIES)) {
      if (
        typeof entry !== "string" ||
        entry.length > MAX_RUNNER_CODE_FIX_CAPABILITY_LENGTH
      ) {
        continue;
      }

      const capability: string = entry.trim();

      if (
        known.includes(capability) &&
        !capabilities.includes(capability as RunnerCodeFixCapability)
      ) {
        capabilities.push(capability as RunnerCodeFixCapability);
      }
    }

    return capabilities;
  }

  // The capabilities a request body declares (RUNNER_CODE_FIX_CAPABILITIES_FIELD).
  public static readFromBody(body: unknown): Array<RunnerCodeFixCapability> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return [];
    }

    return RunnerCodeFixCapabilityUtil.parse(
      (body as Record<string, unknown>)[RUNNER_CODE_FIX_CAPABILITIES_FIELD],
    );
  }

  public static has(
    capabilities: ReadonlyArray<RunnerCodeFixCapability> | undefined,
    capability: RunnerCodeFixCapability,
  ): boolean {
    return Array.isArray(capabilities) && capabilities.includes(capability);
  }

  /*
   * Whether the Runner that sent this body pushes with a token OneUptime
   * makes for its run - which only a Runner that has OneUptime open its pull
   * requests can be handed - for the claim and the queue count it
   * autoscales on.
   */
  public static pushesWithRunTokens(body: unknown): boolean {
    return RunnerCodeFixCapabilityUtil.has(
      RunnerCodeFixCapabilityUtil.readFromBody(body),
      RunnerCodeFixCapability.ServerOpensPullRequests,
    );
  }
}

export default RunnerCodeFixCapability;
