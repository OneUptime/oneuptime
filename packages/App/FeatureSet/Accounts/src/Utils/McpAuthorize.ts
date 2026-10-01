/*
 * The pure half of the MCP consent screen (Pages/McpAuthorize): what the
 * consent endpoints answer, and the handful of decisions the page makes from
 * it. Kept apart from the page so each decision can be tested without
 * rendering anything.
 */

export type McpConsentAccess = "read" | "write";

export interface McpConsentProject {
  id: string;
  name: string;
  isEligible: boolean;

  // Why the project cannot be chosen: "plan", "sso", "blocked", "not-a-member".
  refusal: string | null;
}

export interface McpConsentDetails {
  client: {
    name: string;

    /*
     * The host of the client's metadata document, when it is identified by
     * one. Unlike the name, the client cannot choose it freely.
     */
    verifiedHost: string | null;
    uri: string | null;
    redirectTarget: string;
    isLoopbackRedirect: boolean;
  };

  // The most the client asked for.
  requestedAccess: McpConsentAccess;
  user: {
    email: string;
    name: string;
  };
  projects: Array<McpConsentProject>;
}

/*
 * The error codes the authorization endpoint sends in `?error=`. Only these
 * are ever shown, each with fixed wording from the locale files: the value in
 * the URL is written by whoever made the link, and must never be displayed
 * as though OneUptime had said it.
 */
export const KNOWN_DISPLAY_ERROR_CODES: Array<string> = [
  "oauth_disabled",
  "missing_client_id",
  "unknown_client",
  "client_metadata_unavailable",
  "client_metadata_invalid",
  "missing_redirect_uri",
  "redirect_uri_mismatch",
  "request_too_large",
  "server_error",
];

export const FALLBACK_DISPLAY_ERROR_CODE: string = "server_error";

const KNOWN_PROJECT_REFUSALS: Array<string> = [
  "plan",
  "sso",
  "blocked",
  "not-a-member",
];

/*
 * Schemes the browser must never be sent to, whatever the server answered.
 * The server refuses to register a redirect URI with one of these in the
 * first place (the same list: MCP/OAuth/RedirectUri FORBIDDEN_SCHEMES); this
 * is that rule held at the last step, because this page is where the
 * navigation actually happens.
 */
const UNSAFE_REDIRECT_SCHEMES: Array<string> = [
  "javascript:",
  "data:",
  "vbscript:",
  "blob:",
  "about:",
  "view-source:",
  "file:",
  "filesystem:",
  "jar:",
  "resource:",
  "chrome:",
  "ftp:",
  "ws:",
  "wss:",
  "mailto:",
  "tel:",
  "sms:",
];

/*
 * Unicode's isolate marks: "what is between these has its own direction".
 * Built from code points so that no invisible character sits in this file.
 */
const LEFT_TO_RIGHT_ISOLATE: string = String.fromCodePoint(0x2066);
const FIRST_STRONG_ISOLATE: string = String.fromCodePoint(0x2068);
const POP_DIRECTIONAL_ISOLATE: string = String.fromCodePoint(0x2069);

export default class McpAuthorizeUtil {
  /*
   * A NAME dropped into a sentence - a client's, a project's - set apart
   * from it when the sentence runs right to left, so it cannot swallow the
   * word next to it or be rearranged by it. The name keeps whatever
   * direction its own first letter has (a Persian project name stays right
   * to left). Left-to-right pages get the value back untouched.
   */
  public static isolate(value: string, direction: string): string {
    if (direction !== "rtl" || !value) {
      return value;
    }

    return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
  }

  /*
   * The same for a value that is ALWAYS left to right whatever it is made
   * of: a host, an address, an email. These are stated as left to right
   * rather than left to find out, because many contain no letters to find
   * out from - "[::1]:33418" is digits and punctuation, takes the page's
   * direction when asked to guess, and is then drawn "33418:[1::]".
   */
  public static isolateLeftToRight(value: string, direction: string): string {
    if (direction !== "rtl" || !value) {
      return value;
    }

    return `${LEFT_TO_RIGHT_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
  }

  public static toDisplayErrorCode(code: string | null | undefined): string {
    if (code && KNOWN_DISPLAY_ERROR_CODES.includes(code)) {
      return code;
    }

    return FALLBACK_DISPLAY_ERROR_CODE;
  }

  // The locale key suffix for a project's refusal; unknown reasons read as "not-a-member".
  public static toProjectRefusalKey(refusal: string | null): string {
    if (refusal && KNOWN_PROJECT_REFUSALS.includes(refusal)) {
      return refusal;
    }

    return "not-a-member";
  }

  public static getEligibleProjects(
    details: McpConsentDetails,
  ): Array<McpConsentProject> {
    return details.projects.filter((project: McpConsentProject): boolean => {
      return project.isEligible;
    });
  }

  /*
   * The project to preselect: the only eligible one, when there is exactly
   * one. With several, the member chooses - a guess here would be a client
   * connected to the wrong project by somebody pressing Enter.
   */
  public static getInitialProjectId(details: McpConsentDetails): string {
    const eligible: Array<McpConsentProject> =
      McpAuthorizeUtil.getEligibleProjects(details);

    return eligible.length === 1 ? eligible[0]!.id : "";
  }

  /*
   * Whether this page is being shown inside another page's frame. Reading
   * `window.top` from a frame on another origin can throw; that is a frame
   * too, and the cautious answer.
   */
  public static isFramed(): boolean {
    try {
      return window.top !== window.self;
    } catch {
      return true;
    }
  }

  public static isSafeRedirectUrl(value: unknown): value is string {
    if (typeof value !== "string" || !value) {
      return false;
    }

    try {
      const parsed: URL = new URL(value);

      return !UNSAFE_REDIRECT_SCHEMES.includes(parsed.protocol.toLowerCase());
    } catch {
      return false;
    }
  }

  /*
   * Parses a details response defensively: the page renders these values, so
   * anything that is not the expected shape is treated as no answer at all.
   */
  public static parseDetails(data: unknown): McpConsentDetails | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    const body: Record<string, unknown> = data as Record<string, unknown>;
    const client: Record<string, unknown> | undefined = body["client"] as
      | Record<string, unknown>
      | undefined;
    const user: Record<string, unknown> | undefined = body["user"] as
      | Record<string, unknown>
      | undefined;
    const projects: unknown = body["projects"];

    if (
      !client ||
      typeof client !== "object" ||
      !user ||
      typeof user !== "object" ||
      !Array.isArray(projects)
    ) {
      return null;
    }

    return {
      client: {
        name: String(client["name"] || ""),
        verifiedHost:
          typeof client["verifiedHost"] === "string"
            ? client["verifiedHost"]
            : null,
        uri: typeof client["uri"] === "string" ? client["uri"] : null,
        redirectTarget: String(client["redirectTarget"] || ""),
        isLoopbackRedirect: client["isLoopbackRedirect"] === true,
      },
      requestedAccess: body["requestedAccess"] === "write" ? "write" : "read",
      user: {
        email: String(user["email"] || ""),
        name: String(user["name"] || ""),
      },
      projects: projects
        .filter((project: unknown): boolean => {
          return Boolean(project) && typeof project === "object";
        })
        .map((project: unknown): McpConsentProject => {
          const row: Record<string, unknown> = project as Record<
            string,
            unknown
          >;

          return {
            id: String(row["id"] || ""),
            name: String(row["name"] || ""),
            isEligible: row["isEligible"] === true,
            refusal: typeof row["refusal"] === "string" ? row["refusal"] : null,
          };
        }),
    };
  }
}
