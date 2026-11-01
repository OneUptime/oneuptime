import Dictionary from "../../../Types/Dictionary";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import APIException from "../../../Types/Exception/ApiException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import SecurityAdvisoryUtil, {
  MAX_SUMMARY_LENGTH,
  MAX_VULNERABILITIES_PER_ADVISORY,
  SecurityAdvisory,
  SecurityAdvisoryVulnerability,
} from "../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "../../../Types/UpdateCheck/UpdateCheckFailure";
import API from "../../../Utils/API";
import VersionUtil from "../../../Utils/VersionUtil";

/*
 * The two questions the daily update check asks GitHub, and nothing else:
 *
 *   - which OneUptime release is the latest (releases/latest);
 *   - which security advisories OneUptime has published for
 *     OneUptime/oneuptime (security-advisories?state=published).
 *
 * Both are public, read without a token, and carry nothing about the
 * installation: the request names OneUptime as its User-Agent (GitHub
 * refuses one without), never the version this installation runs, its
 * address or anything about its users - whether the version is affected is
 * worked out here (SecurityAdvisoryMatcher). GitHub still sees the server's
 * public IP address, as it does for any request.
 *
 * Neither ever throws. An installation with no route to GitHub, a proxy that
 * refuses, GitHub's limit of 60 unauthenticated requests an hour per address,
 * a timeout or an answer that is not GitHub's shape is an expected state
 * for this check, not a fault: each comes back as a failure the job logs at
 * debug and records, keeping the last good answer.
 */

export const GITHUB_REQUEST_HEADERS: Dictionary<string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "OneUptime",
};

// How long one request waits for GitHub.
export const REQUEST_TIMEOUT_IN_MS: number = 15000;

/*
 * The most one answer may hold. A page of 100 of OneUptime's advisories is
 * under 1 MB with their descriptions; a mirror that answers with more is not
 * answering with advisories.
 */
export const MAX_RESPONSE_BYTES: number = 10 * 1024 * 1024;

export const ADVISORIES_PER_PAGE: number = 100;

/*
 * Pages read at most, newest advisories first: 1,000 advisories. An
 * installation old enough to be affected by an advisory past those is
 * affected by many of the newer ones too.
 */
export const MAX_ADVISORY_PAGES: number = 10;

// A cursor GitHub hands back for the next page: base64 and its URL-safe kin.
const PAGE_CURSOR: RegExp = /^[A-Za-z0-9+/=_-]{1,512}$/;

// The Link header of a page, capped before it is read.
const MAX_LINK_HEADER_LENGTH: number = 4096;

export type UpdateCheckResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: UpdateCheckFailure; detail: string };

export interface LatestRelease {
  // Canonical: "14.0.80".
  version: string;
  publishedAt: Date | null;
}

const failed: <T>(
  failure: UpdateCheckFailure,
  detail: string,
) => UpdateCheckResult<T> = <T>(
  failure: UpdateCheckFailure,
  detail: string,
): UpdateCheckResult<T> => {
  return { ok: false, failure: failure, detail: detail };
};

export default class GitHubUpdateCheck {
  public static async fetchLatestRelease(
    url: URL,
  ): Promise<UpdateCheckResult<LatestRelease>> {
    const response: UpdateCheckResult<HTTPResponse<JSONObject | JSONArray>> =
      await this.get(URL.fromString(url.toString()));

    if (!response.ok) {
      return response;
    }

    const payload: unknown = response.value.data;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return failed(
        UpdateCheckFailure.MalformedResponse,
        "The latest release answer is not a JSON object.",
      );
    }

    /*
     * Canonicalized, so what is stored is always a bare "14.0.80": the
     * repository has tags in both spellings plus ones that are no version
     * at all ("build-number-7866").
     */
    const version: string | null = VersionUtil.canonicalize(
      (payload as JSONObject)["tag_name"],
    );

    if (!version) {
      return failed(
        UpdateCheckFailure.MalformedResponse,
        `The latest release is tagged "${String(
          (payload as JSONObject)["tag_name"],
        ).substring(0, 100)}", which is not a version.`,
      );
    }

    const publishedAtText: string | null = SecurityAdvisoryUtil.parseDate(
      (payload as JSONObject)["published_at"],
    );

    return {
      ok: true,
      value: {
        version: version,
        publishedAt: publishedAtText ? new Date(publishedAtText) : null,
      },
    };
  }

  /*
   * Every published, not withdrawn, advisory, newest first, read page by
   * page as GitHub's Link header leads. One page that fails fails the whole
   * read, so a partial list never replaces a whole one.
   */
  public static async fetchPublishedSecurityAdvisories(
    url: URL,
  ): Promise<UpdateCheckResult<Array<SecurityAdvisory>>> {
    const advisories: Array<SecurityAdvisory> = [];
    const seen: Set<string> = new Set<string>();
    let cursor: string | null = null;

    for (let page: number = 0; page < MAX_ADVISORY_PAGES; page++) {
      const pageUrl: URL = URL.fromString(url.toString())
        .addQueryParam("state", "published")
        .addQueryParam("sort", "published")
        .addQueryParam("direction", "desc")
        .addQueryParam("per_page", String(ADVISORIES_PER_PAGE));

      if (cursor) {
        pageUrl.addQueryParam("after", cursor, true);
      }

      const response: UpdateCheckResult<HTTPResponse<JSONObject | JSONArray>> =
        await this.get(pageUrl);

      if (!response.ok) {
        return response;
      }

      const payload: unknown = response.value.data;

      if (!Array.isArray(payload)) {
        return failed(
          UpdateCheckFailure.MalformedResponse,
          "The security advisories answer is not a JSON array.",
        );
      }

      let readOnPage: number = 0;

      for (const item of payload) {
        const advisory: SecurityAdvisory | null = this.parseAdvisory(item);

        if (this.isAdvisoryShaped(item)) {
          readOnPage++;
        }

        if (advisory && !seen.has(advisory.ghsaId)) {
          seen.add(advisory.ghsaId);
          advisories.push(advisory);
        }
      }

      // A page of things that are not advisories is not GitHub's answer.
      if (payload.length > 0 && readOnPage === 0) {
        return failed(
          UpdateCheckFailure.MalformedResponse,
          "The security advisories answer holds no advisory.",
        );
      }

      cursor = this.getNextPageCursor(response.value.headers);

      if (!cursor || payload.length === 0) {
        break;
      }
    }

    return { ok: true, value: advisories };
  }

  /*
   * One advisory of GitHub's answer, in the shape this installation keeps,
   * or null when it is not a published advisory: a draft, a withdrawn one,
   * or anything without GitHub's identifier.
   */
  public static parseAdvisory(value: unknown): SecurityAdvisory | null {
    if (!this.isAdvisoryShaped(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;

    // The list is asked for published advisories; a mirror may send others.
    if (json["state"] !== undefined && json["state"] !== "published") {
      return null;
    }

    if (json["withdrawn_at"]) {
      return null;
    }

    const vulnerabilities: Array<SecurityAdvisoryVulnerability> = Array.isArray(
      json["vulnerabilities"],
    )
      ? (json["vulnerabilities"] as Array<unknown>)
          .slice(0, MAX_VULNERABILITIES_PER_ADVISORY)
          .filter((item: unknown): boolean => {
            return Boolean(item) && typeof item === "object";
          })
          .map((item: unknown): SecurityAdvisoryVulnerability => {
            const vulnerability: JSONObject = item as JSONObject;

            return {
              vulnerableVersionRange: SecurityAdvisoryUtil.parseVersionText(
                vulnerability["vulnerable_version_range"],
              ),
              patchedVersions: SecurityAdvisoryUtil.parseVersionText(
                vulnerability["patched_versions"],
              ),
            };
          })
      : [];

    const ghsaId: string = SecurityAdvisoryUtil.normalizeGhsaId(
      json["ghsa_id"] as string,
    );

    return {
      ghsaId: ghsaId,
      cveId: SecurityAdvisoryUtil.parseCveId(json["cve_id"]),
      summary:
        SecurityAdvisoryUtil.parseText(json["summary"], MAX_SUMMARY_LENGTH) ||
        ghsaId,
      severity: SecurityAdvisoryUtil.parseSeverity(json["severity"]),
      url: SecurityAdvisoryUtil.parseUrl(json["html_url"]),
      publishedAt: SecurityAdvisoryUtil.parseDate(json["published_at"]),
      vulnerabilities: vulnerabilities,
    };
  }

  /*
   * Why an HTTP error answer is a failure: GitHub's rate limit (429, or 403
   * with no requests remaining or a message that says so), or any other
   * error.
   */
  public static classifyErrorResponse(
    response: HTTPErrorResponse,
  ): UpdateCheckFailure {
    if (response.statusCode === 429) {
      return UpdateCheckFailure.RateLimited;
    }

    if (response.statusCode === 403) {
      const remaining: string | undefined = this.getHeader(
        response.headers,
        "x-ratelimit-remaining",
      );

      if (remaining === "0") {
        return UpdateCheckFailure.RateLimited;
      }

      const message: string = (response.message || "")
        .substring(0, 500)
        .toLowerCase();

      if (message.includes("rate limit")) {
        return UpdateCheckFailure.RateLimited;
      }
    }

    return UpdateCheckFailure.HttpError;
  }

  // Why a request that got no answer failed: it timed out, or GitHub could not be reached.
  public static classifyNoResponse(error: unknown): UpdateCheckFailure {
    const cause: unknown =
      error instanceof APIException ? error.error || error : error;
    const code: string = String(
      (cause as { code?: unknown } | null)?.code || "",
    );
    const message: string = String(
      (error as { message?: unknown } | null)?.message || "",
    )
      .substring(0, 500)
      .toLowerCase();

    if (
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      message.includes("timeout") ||
      message.includes("timed out")
    ) {
      return UpdateCheckFailure.TimedOut;
    }

    return UpdateCheckFailure.Unreachable;
  }

  /*
   * The cursor of the page after this one, from GitHub's Link header
   * (rel="next", its `after` parameter). Only the cursor is taken: the next
   * page is asked of the configured URL, never of an address an answer
   * names.
   */
  public static getNextPageCursor(
    headers: Dictionary<string> | undefined,
  ): string | null {
    const link: string | undefined = this.getHeader(headers, "link");

    if (!link || link.length > MAX_LINK_HEADER_LENGTH) {
      return null;
    }

    for (const part of link.split(",")) {
      const [target, ...parameters] = part.split(";");

      const isNext: boolean = parameters.some((parameter: string): boolean => {
        return parameter.trim().toLowerCase() === 'rel="next"';
      });

      if (!isNext || !target) {
        continue;
      }

      const address: string = target.trim();

      if (!address.startsWith("<") || !address.endsWith(">")) {
        continue;
      }

      try {
        const cursor: string | null = new globalThis.URL(
          address.substring(1, address.length - 1),
        ).searchParams.get("after");

        return cursor && PAGE_CURSOR.test(cursor) ? cursor : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  private static isAdvisoryShaped(value: unknown): boolean {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      SecurityAdvisoryUtil.isGhsaId((value as JSONObject)["ghsa_id"])
    );
  }

  private static getHeader(
    headers: Dictionary<string> | undefined,
    name: string,
  ): string | undefined {
    if (!headers) {
      return undefined;
    }

    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name) {
        const value: unknown = headers[key];
        return typeof value === "string" ? value : undefined;
      }
    }

    return undefined;
  }

  private static async get(
    url: URL,
  ): Promise<UpdateCheckResult<HTTPResponse<JSONObject | JSONArray>>> {
    let response: HTTPResponse<JSONObject | JSONArray> | HTTPErrorResponse;

    try {
      response = await API.get<JSONObject | JSONArray>({
        url: url,
        headers: GITHUB_REQUEST_HEADERS,
        options: {
          timeout: REQUEST_TIMEOUT_IN_MS,
          maxContentLength: MAX_RESPONSE_BYTES,
        },
      });
    } catch (err) {
      return failed(
        this.classifyNoResponse(err),
        `Could not reach ${url.toString()}: ${String(
          (err as Error)?.message || "Unknown error",
        ).substring(0, 500)}`,
      );
    }

    if (!response.isSuccess()) {
      const errorResponse: HTTPErrorResponse | null =
        response instanceof HTTPErrorResponse ? response : null;

      return failed(
        errorResponse
          ? this.classifyErrorResponse(errorResponse)
          : UpdateCheckFailure.HttpError,
        `${url.toString()} answered ${response.statusCode}${
          errorResponse?.message
            ? `: ${errorResponse.message.substring(0, 500)}`
            : ""
        }`,
      );
    }

    return { ok: true, value: response };
  }
}
