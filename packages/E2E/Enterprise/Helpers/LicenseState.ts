import { BASE_URL } from "../../Config";
import {
  APIRequestContext,
  APIResponse,
  request as playwrightRequest,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The edition/licence probe every enterprise e2e spec starts from.
 *
 * What only a booted stack proves, and what the jest suites cannot:
 * packages/Common/Tests/Server/API/GlobalConfigLicense.test.ts already pins
 * the PAYLOAD of GET /global-config/license per audience by calling the
 * builder directly. Nothing in-process proves that a published image, wired by
 * the real docker-compose.yml, answers that route THROUGH NGINX - nginx's
 * `location /api` and the App's own appName="api" mount are outside every jest
 * suite. This helper is also how a spec learns which stack it is pointed at,
 * because the e2e container's own IS_ENTERPRISE_EDITION says nothing:
 * docker-compose.base.yml passes the variable through and no job sets it, so
 * it reads false even in the job that boots the enterprise image. The edition
 * is detected at runtime, here.
 *
 * Route: packages/Common/Server/API/GlobalConfigAPI.ts. Always the /api
 * prefix: nginx's catch-all `location /` proxies to Home when billing is on
 * and to App otherwise, so a root-relative API path means different things on
 * different stacks.
 */

// GET, no authentication, no fixtures - the cheapest high-signal probe there is.
export const LICENSE_ENDPOINT_PATH: string = "/api/global-config/license";

/*
 * The public half of the licence payload (GlobalConfigAPI.buildLicenseResponse).
 * An anonymous caller gets exactly these fields; the master-admin-only ones
 * (token, licenseKey, instanceId, currentVersion, seat usage, ...) are not part
 * of it, which MASTER_ADMIN_ONLY_LICENSE_FIELDS below asserts.
 */
export interface EnterpriseLicenseState {
  // "enterprise" once the ee/ module loaded in the App process, else "community".
  edition: string;
  // "missing" | "valid" | "grace" | "expired" | "invalid", null on Community.
  status: string | null;
  // "verified" | "unverified" | "none", null on Community.
  verification: string | null;
  // "expired" | "unlicensed" while status is "grace", else null.
  graceReason: string | null;
  // True for a valid licence AND for one inside a grace period or the trial.
  licenseValid: boolean;
  // "all", the list of covered features, or null on Community.
  features: string | Array<string> | null;
  companyName: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  isEvaluation: boolean;
  // The parsed body, for assertions this interface deliberately does not name.
  body: Record<string, unknown>;
  httpStatus: number;
}

/*
 * Fields GlobalConfigAPI adds only for a master admin. An anonymous probe that
 * sees any of them is a disclosure regression, so the licence spec asserts
 * they are absent.
 */
export const MASTER_ADMIN_ONLY_LICENSE_FIELDS: ReadonlyArray<string> = [
  "token",
  "licenseKey",
  "activationMode",
  "instanceId",
  "currentVersion",
  "latestVersion",
  "seatUsage",
];

type EnterpriseUrlFunction = (path: string) => string;

// Absolute URL for a path on the stack under test (HOST / HTTP_PROTOCOL).
export const enterpriseUrl: EnterpriseUrlFunction = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

type ReadStringFunction = (
  body: Record<string, unknown>,
  key: string,
) => string | null;

const readString: ReadStringFunction = (
  body: Record<string, unknown>,
  key: string,
): string | null => {
  const value: unknown = body[key];
  return typeof value === "string" ? value : null;
};

type ReadFeaturesFunction = (
  body: Record<string, unknown>,
) => string | Array<string> | null;

const readFeatures: ReadFeaturesFunction = (
  body: Record<string, unknown>,
): string | Array<string> | null => {
  const value: unknown = body["features"];

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown): string => {
      return String(entry);
    });
  }

  return null;
};

type FetchLicenseStateFunction = (data?: {
  request?: APIRequestContext | undefined;
}) => Promise<EnterpriseLicenseState>;

/*
 * Reads the licence endpoint once and parses it.
 *
 * `request` is optional so this works in a beforeAll hook, where test-scoped
 * fixtures are not available: with no context passed it makes one of its own
 * and disposes it again.
 *
 * A body that is not JSON throws with the status and a snippet rather than
 * failing three frames later on an undefined field. On this stack an HTML
 * answer here means nginx routed the probe somewhere unexpected, which is
 * exactly the kind of failure the enterprise job exists to catch.
 */
export const fetchEnterpriseLicenseState: FetchLicenseStateFunction =
  async (data?: {
    request?: APIRequestContext | undefined;
  }): Promise<EnterpriseLicenseState> => {
    const ownContext: APIRequestContext | null = data?.request
      ? null
      : await playwrightRequest.newContext();
    const context: APIRequestContext = data?.request || ownContext!;

    try {
      const endpoint: string = enterpriseUrl(LICENSE_ENDPOINT_PATH);
      const response: APIResponse = await context.get(endpoint, {
        maxRedirects: 0,
      });
      const httpStatus: number = response.status();
      const text: string = await response.text();

      let body: Record<string, unknown>;

      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(
          `GET ${endpoint} did not answer JSON (HTTP ${httpStatus}). First 300 characters: ${text.slice(
            0,
            300,
          )}`,
        );
      }

      return {
        edition: readString(body, "edition") || "",
        status: readString(body, "status"),
        verification: readString(body, "verification"),
        graceReason: readString(body, "graceReason"),
        licenseValid: body["licenseValid"] === true,
        features: readFeatures(body),
        companyName: readString(body, "companyName"),
        expiresAt: readString(body, "expiresAt"),
        graceEndsAt: readString(body, "graceEndsAt"),
        isEvaluation: body["isEvaluation"] === true,
        body,
        httpStatus,
      };
    } finally {
      if (ownContext) {
        await ownContext.dispose();
      }
    }
  };

type DescribeLicenseStateFunction = (state: EnterpriseLicenseState) => string;

/*
 * One line naming the stack that actually answered, for a guard failure. It
 * carries every field a reader needs to tell the three stacks apart without
 * opening a trace: edition, status, graceReason, licenseValid and the covered
 * features.
 */
export const describeEnterpriseLicenseState: DescribeLicenseStateFunction = (
  state: EnterpriseLicenseState,
): string => {
  const features: string = Array.isArray(state.features)
    ? `[${state.features.join(", ")}]`
    : String(state.features);

  return (
    `edition=${state.edition} status=${String(state.status)} ` +
    `graceReason=${String(state.graceReason)} licenseValid=${String(
      state.licenseValid,
    )} features=${features} (HTTP ${state.httpStatus} from ${enterpriseUrl(
      LICENSE_ENDPOINT_PATH,
    )})`
  );
};

type SleepFunction = (ms: number) => Promise<void>;

/*
 * Deliberately not page.waitForTimeout: the licence poll runs before any
 * browser exists - the lapse phase polls this endpoint with nothing else open.
 */
const sleep: SleepFunction = (ms: number): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

type WaitForLicenseStateFunction = (data: {
  isReady: (state: EnterpriseLicenseState) => boolean;
  description: string;
  request?: APIRequestContext | undefined;
  timeoutMs?: number | undefined;
  intervalMs?: number | undefined;
}) => Promise<EnterpriseLicenseState>;

/*
 * Polls the licence endpoint until `isReady` accepts the answer.
 *
 * Needed because the app notices a licence change WITHOUT a restart, but not
 * instantly: the licence inputs are cached for LICENSE_INPUTS_CACHE_TTL_IN_MS
 * (60s, ee/Server/License/LicenseSettings.ts) and the synchronous
 * getCachedSnapshot() the gates read serves the previous inputs while a reload
 * runs in the background (ee/Server/License/LicenseProvider.ts). So after the
 * lapse phase backdates GlobalConfig.enterpriseEditionFirstSeenAt the suite
 * must poll here until the status flips, and only then assert anything about
 * SSO, SCIM or audit logging.
 *
 * The timeout error names the last state seen, so a stuck poll reports what
 * the stack was actually saying rather than only that it timed out.
 */
export const waitForEnterpriseLicenseState: WaitForLicenseStateFunction =
  async (data: {
    isReady: (state: EnterpriseLicenseState) => boolean;
    description: string;
    request?: APIRequestContext | undefined;
    timeoutMs?: number | undefined;
    intervalMs?: number | undefined;
  }): Promise<EnterpriseLicenseState> => {
    const timeoutMs: number = data.timeoutMs ?? 180000;
    const intervalMs: number = data.intervalMs ?? 5000;
    const deadline: number = Date.now() + timeoutMs;

    let lastState: EnterpriseLicenseState | null = null;
    let lastError: string = "";

    for (;;) {
      try {
        const state: EnterpriseLicenseState = await fetchEnterpriseLicenseState(
          data.request ? { request: data.request } : {},
        );
        lastState = state;

        if (data.isReady(state)) {
          return state;
        }
      } catch (error) {
        lastError = (error as Error).message;
      }

      if (Date.now() >= deadline) {
        break;
      }

      await sleep(intervalMs);
    }

    const seen: string = lastState
      ? describeEnterpriseLicenseState(lastState)
      : `no readable answer${lastError ? `: ${lastError}` : ""}`;

    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${data.description}. The stack under test reports: ${seen}`,
    );
  };
