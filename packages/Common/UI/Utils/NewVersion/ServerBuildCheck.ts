/*
 * Asks the server which build of this frontend it serves now, and compares it
 * with the one this tab runs.
 *
 * The answer is build.json, written beside the bundle by the frontend build
 * (Common/UI/esbuild-config.js) with the same id the bundle carries. It is a
 * static file, so every server that serves the bundle serves it too - the
 * App, a standalone frontend server, a status page on its own domain - and a
 * build that has it is the build the server would hand out on a reload.
 *
 * Only a manifest that names a build counts as an answer. A server that
 * answers something else is told apart by how it answers, because each
 * calls for something else: a page that cannot load its code reloads into a
 * server that answers (Same, New, NoManifest), waits for one that is
 * restarting (Unavailable), and says so when nothing answers at all
 * (Unreachable). None of them ever throws.
 */

export enum ServerBuildStatus {
  // The server serves the build this tab runs.
  Same = "same",
  // The server serves another build: a new version was deployed.
  New = "new",
  /*
   * The server answered, but not with a manifest: a page instead (the app
   * answers unknown addresses with itself), a 404, or JSON naming no build.
   * It does not serve this tab's build, or it would serve its manifest.
   */
  NoManifest = "no-manifest",
  // The server is there but cannot serve now: 5xx, 408, 429.
  Unavailable = "unavailable",
  // No answer at all: offline, the network dropped, or it took too long.
  Unreachable = "unreachable",
}

export interface ServerBuildCheckResult {
  status: ServerBuildStatus;
  // The build the server named (Same and New only).
  serverBuildId: string | null;
}

export type FetchFunction = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface CheckServerBuildOptions {
  runningBuildId: string;
  manifestUrl: string;
  // window.fetch by default.
  fetchFunction?: FetchFunction | undefined;
  timeoutInMs?: number | undefined;
}

export const SERVER_BUILD_CHECK_TIMEOUT_IN_MS: number = 8000;

// A build id is short; anything longer is not one of ours.
const MAX_BUILD_ID_LENGTH: number = 200;

const isUnavailableStatusCode: (statusCode: number) => boolean = (
  statusCode: number,
): boolean => {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
};

/*
 * The build a manifest names, or null when the text is not one: JSON with a
 * non-empty string buildId. Anything else - an HTML page, a JSON error, a
 * manifest cut short - names no build.
 */
export const readBuildIdFromManifest: (text: string) => string | null = (
  text: string,
): string | null => {
  try {
    const parsed: unknown = JSON.parse(text);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const buildId: unknown = (parsed as Record<string, unknown>)["buildId"];

    if (
      typeof buildId !== "string" ||
      buildId.trim().length === 0 ||
      buildId.length > MAX_BUILD_ID_LENGTH
    ) {
      return null;
    }

    return buildId;
  } catch {
    return null;
  }
};

const getDefaultFetch: () => FetchFunction | null =
  (): FetchFunction | null => {
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return null;
    }

    return (input: string, init?: RequestInit): Promise<Response> => {
      return window.fetch(input, init);
    };
  };

export const checkServerBuild: (
  options: CheckServerBuildOptions,
) => Promise<ServerBuildCheckResult> = async (
  options: CheckServerBuildOptions,
): Promise<ServerBuildCheckResult> => {
  const unreachable: ServerBuildCheckResult = {
    status: ServerBuildStatus.Unreachable,
    serverBuildId: null,
  };

  const fetchFunction: FetchFunction | null =
    options.fetchFunction || getDefaultFetch();

  if (!fetchFunction || !options.manifestUrl) {
    return unreachable;
  }

  const controller: AbortController | null =
    typeof AbortController === "undefined" ? null : new AbortController();

  let timer: ReturnType<typeof setTimeout> | null = null;

  /*
   * A server that never answers must not hold the page in "checking"
   * forever: past the timeout it counts as no answer. The race is what
   * gives up; the abort only frees the request.
   */
  const timeout: Promise<null> = new Promise<null>(
    (resolve: (value: null) => void) => {
      timer = setTimeout(
        () => {
          controller?.abort();
          resolve(null);
        },
        options.timeoutInMs ?? SERVER_BUILD_CHECK_TIMEOUT_IN_MS,
      );
    },
  );

  const answer: Promise<ServerBuildCheckResult> = (async (): Promise<
    ServerBuildCheckResult
  > => {
    const response: Response = await fetchFunction(options.manifestUrl, {
      method: "GET",
      // Past every cache on the way: the answer is only worth it fresh.
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (isUnavailableStatusCode(response.status)) {
      return { status: ServerBuildStatus.Unavailable, serverBuildId: null };
    }

    if (!response.ok) {
      return { status: ServerBuildStatus.NoManifest, serverBuildId: null };
    }

    const serverBuildId: string | null = readBuildIdFromManifest(
      await response.text(),
    );

    if (!serverBuildId) {
      return { status: ServerBuildStatus.NoManifest, serverBuildId: null };
    }

    return {
      status:
        serverBuildId === options.runningBuildId
          ? ServerBuildStatus.Same
          : ServerBuildStatus.New,
      serverBuildId: serverBuildId,
    };
  })();

  try {
    const result: ServerBuildCheckResult | null = await Promise.race([
      answer,
      timeout,
    ]);

    return result || unreachable;
  } catch {
    // The request failed (offline, refused, aborted) or the body broke off.
    return unreachable;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }

    answer.catch((): void => {
      // A late failure of the abandoned request is not an unhandled one.
    });
  }
};
