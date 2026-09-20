import { enterpriseUrl } from "./LicenseState";
import {
  APIRequestContext,
  APIResponse,
  request as playwrightRequest,
} from "@playwright/test";

/*
 * Reads the runtime environment the stack hands its own browser bundles
 * (env.js), which is the only place two facts live that nothing else exposes.
 *
 * What only a booted stack proves:
 *
 *   1. IS_ENTERPRISE_EDITION here is the EFFECTIVE edition, not the raw
 *      variable. Server/Utils/FrontendEnvironment.ts overwrites it with
 *      EnterpriseEdition.isLoaded(), so "true" means the ee/ module really
 *      loaded in the process that serves the Dashboard - the precondition for
 *      the Dashboard's enterprise screens and for the edition pill to say
 *      Enterprise Edition at all (Common/UI/Components/EditionLabel reads this
 *      variable, not the licence response's `edition`). A jest suite can mock
 *      the value; only a booted image can be wrong about it.
 *   2. BILLING_ENABLED as the STACK sees it. The e2e container's own
 *      BILLING_ENABLED is just what the job exported, so a suite that only
 *      read Config.IS_BILLING_ENABLED would happily run against a billing
 *      stack that was mislabelled. On a billing stack the licence stops
 *      deciding anything (EditionPermissions and the audit recorder defer to
 *      the plan instead), which would make every assertion in this suite mean
 *      something different.
 *
 * env.js is served unauthenticated by every frontend mount
 * (Common/Server/Utils/StartServer.ts) and the payload is shared by all of
 * them (Common/Server/Utils/FrontendEnvironment.ts).
 */

// The Dashboard's copy: the bundle whose enterprise screens this suite opens.
export const DASHBOARD_ENV_PATH: string = "/dashboard/env.js";

export interface StackFrontendEnvironment {
  // EnterpriseEdition.isLoaded() in the process that served this.
  isEnterpriseEdition: boolean;
  billingEnabled: boolean;
  /*
   * True when the image was ASKED for the Enterprise Edition but the module
   * did not load - the mismatch the admin UI reports. Never true on a healthy
   * enterprise stack, and a far better failure message than "the pill says
   * Community".
   */
  enterpriseEditionRequestedButNotLoaded: boolean;
  // Every variable served, for assertions this interface does not name.
  values: Record<string, string>;
}

/*
 * env.js is a script, not JSON: FrontendEnvironment.getFrontendEnvironmentScript
 * emits guard blocks and then the real payload, so the file assigns
 * window.process.env TWICE - first `window.process.env = {}` inside
 * `if(!window.process.env){...}`, then `window.process.env = {"GIT_SHA":...};`.
 * A lazy regex is not enough: the guard's assignment has no semicolon after
 * its closing brace, so a match starting there runs past the real payload and
 * consumes it. Walk every assignment instead, extract its object literal by
 * counting braces, and take the last one that parses.
 */
const ENVIRONMENT_ASSIGNMENT_PATTERN: RegExp = /window\.process\.env\s*=\s*\{/g;

type ExtractObjectFunction = (data: {
  script: string;
  openingBraceIndex: number;
}) => string | null;

/*
 * The object literal that starts at openingBraceIndex, found by counting brace
 * depth while skipping over string literals (a value may contain a brace or a
 * quote). Returns null when the literal is never closed.
 */
const extractObjectLiteral: ExtractObjectFunction = (data: {
  script: string;
  openingBraceIndex: number;
}): string | null => {
  let depth: number = 0;
  let isInString: boolean = false;
  let isEscaped: boolean = false;

  for (
    let index: number = data.openingBraceIndex;
    index < data.script.length;
    index++
  ) {
    const character: string = data.script.charAt(index);

    if (isInString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        isInString = false;
      }

      continue;
    }

    if (character === '"') {
      isInString = true;
      continue;
    }

    if (character === "{") {
      depth++;
      continue;
    }

    if (character === "}") {
      depth--;

      if (depth === 0) {
        return data.script.slice(data.openingBraceIndex, index + 1);
      }
    }
  }

  return null;
};

type ParseEnvironmentFunction = (
  script: string,
) => Record<string, unknown> | null;

export const parseFrontendEnvironmentScript: ParseEnvironmentFunction = (
  script: string,
): Record<string, unknown> | null => {
  let parsed: Record<string, unknown> | null = null;

  for (const match of script.matchAll(ENVIRONMENT_ASSIGNMENT_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }

    const literal: string | null = extractObjectLiteral({
      script: script,
      openingBraceIndex: script.indexOf("{", match.index),
    });

    if (!literal) {
      continue;
    }

    try {
      /*
       * The guard block's `window.process.env = {}` parses too, so keep going
       * and let the last assignment - the real payload - win.
       */
      parsed = JSON.parse(literal) as Record<string, unknown>;
    } catch {
      continue;
    }
  }

  return parsed;
};

type FetchFrontendEnvironmentFunction = (data?: {
  request?: APIRequestContext | undefined;
  path?: string | undefined;
}) => Promise<StackFrontendEnvironment>;

export const fetchStackFrontendEnvironment: FetchFrontendEnvironmentFunction =
  async (data?: {
    request?: APIRequestContext | undefined;
    path?: string | undefined;
  }): Promise<StackFrontendEnvironment> => {
    const ownContext: APIRequestContext | null = data?.request
      ? null
      : await playwrightRequest.newContext();
    const context: APIRequestContext = data?.request || ownContext!;

    try {
      const endpoint: string = enterpriseUrl(data?.path || DASHBOARD_ENV_PATH);
      const response: APIResponse = await context.get(endpoint, {
        maxRedirects: 0,
      });
      const script: string = await response.text();

      if (response.status() !== 200) {
        throw new Error(
          `GET ${endpoint} answered HTTP ${response.status()} instead of 200. First 300 characters: ${script.slice(
            0,
            300,
          )}`,
        );
      }

      const parsed: Record<string, unknown> | null =
        parseFrontendEnvironmentScript(script);

      if (!parsed) {
        throw new Error(
          `GET ${endpoint} did not serve a window.process.env assignment this can read. First 300 characters: ${script.slice(
            0,
            300,
          )}`,
        );
      }

      const values: Record<string, string> = {};

      for (const key of Object.keys(parsed)) {
        values[key] = String(parsed[key]);
      }

      return {
        isEnterpriseEdition: values["IS_ENTERPRISE_EDITION"] === "true",
        billingEnabled: values["BILLING_ENABLED"] === "true",
        enterpriseEditionRequestedButNotLoaded:
          values["ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED"] === "true",
        values,
      };
    } finally {
      if (ownContext) {
        await ownContext.dispose();
      }
    }
  };

type DescribeFrontendEnvironmentFunction = (
  environment: StackFrontendEnvironment,
) => string;

export const describeStackFrontendEnvironment: DescribeFrontendEnvironmentFunction =
  (environment: StackFrontendEnvironment): string => {
    return (
      `IS_ENTERPRISE_EDITION=${String(environment.isEnterpriseEdition)} ` +
      `BILLING_ENABLED=${String(environment.billingEnabled)} ` +
      `ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED=${String(
        environment.enterpriseEditionRequestedButNotLoaded,
      )}`
    );
  };
