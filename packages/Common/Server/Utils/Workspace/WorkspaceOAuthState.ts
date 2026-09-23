import crypto from "crypto";
import GlobalCache from "../../Infrastructure/GlobalCache";
import CookieUtil from "../Cookie";
import { ExpressRequest, ExpressResponse } from "../Express";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * Every redirect-based flow that ends with OneUptime writing a Slack or
 * Microsoft Teams binding. A state minted for one flow is never accepted by
 * another, so a nonce issued for "sign in with Teams" cannot be spent on the
 * admin-consent callback.
 */
export enum WorkspaceOAuthFlow {
  SlackInstall = "SlackInstall",
  SlackUserSignIn = "SlackUserSignIn",
  MicrosoftTeamsUserSignIn = "MicrosoftTeamsUserSignIn",
  MicrosoftTeamsAdminConsent = "MicrosoftTeamsAdminConsent",
  // Second leg of admin consent: the sign-in that proves which tenant it was.
  MicrosoftTeamsAdminConsentSignIn = "MicrosoftTeamsAdminConsentSignIn",
}

export interface WorkspaceOAuthStateRecord {
  flow: WorkspaceOAuthFlow;
  projectId: ObjectID;
  userId: ObjectID;
  // Microsoft Entra tenant the flow is pinned to, when it is pinned to one.
  tenantId?: string | undefined;
  // OpenID Connect nonce the ID token returned by this flow must carry.
  oidcNonce?: string | undefined;
}

export interface CreatedWorkspaceOAuthState {
  state: string;
  oidcNonce?: string | undefined;
}

const STATE_NAMESPACE: string = "workspace-oauth-state";

// 32 random bytes, base64url encoded without padding, is always 43 characters.
const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

/*
 * The `state` parameter of the Slack and Microsoft Teams connect flows.
 *
 * The callbacks of those flows are unauthenticated by nature — Slack and
 * Microsoft redirect the browser to them — and they write the binding that
 * everything downstream trusts: which workspace or tenant a project's bot
 * token belongs to, and which chat identity acts as which OneUptime user. So
 * the callback must not learn the project or the user from anything in the
 * redirect itself.
 *
 * The state is an opaque random token. What it stands for lives only on
 * the server, recorded by an authenticated route after checking the caller
 * may connect that project:
 *
 *  - it is single-use: the record is read and deleted in one atomic step, so
 *    a replayed or concurrently double-submitted state is refused;
 *  - it expires after EXPIRES_IN_SECONDS;
 *  - it is bound to the browser that started the flow. A random value is kept
 *    in an httpOnly cookie and only its hash is stored with the record, so a
 *    connect link handed to someone else (to complete with THEIR workspace
 *    or tenant) is refused at the callback, because their browser does not
 *    hold the cookie.
 *
 * The raw state is never stored either — the cache key is its SHA-256 — so a
 * read of the cache does not yield a usable state.
 */
export default class WorkspaceOAuthState {
  /*
   * Long enough for an admin to get through a Microsoft or Slack sign-in with
   * MFA and read the consent screen; short enough that an abandoned state is
   * not a standing credential.
   */
  public static readonly EXPIRES_IN_SECONDS: number = 15 * 60;

  public static readonly BROWSER_BINDING_COOKIE_NAME: string =
    "oneuptime-workspace-oauth-binding";

  public static readonly INVALID_STATE_MESSAGE: string =
    "This connection link is invalid, has expired, or has already been used. Please start connecting again from your OneUptime project settings.";

  /*
   * Who may start a flow that binds a Slack workspace or Microsoft 365 tenant
   * to a project. These are the roles that could create that binding through
   * the CRUD API before creation was restricted to these flows.
   */
  public static readonly MANAGE_CONNECTION_PERMISSIONS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
  ];

  @CaptureSpan()
  public static async create(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    flow: WorkspaceOAuthFlow;
    projectId: ObjectID;
    userId: ObjectID;
    tenantId?: string | undefined;
    includeOidcNonce?: boolean | undefined;
  }): Promise<CreatedWorkspaceOAuthState> {
    /*
     * One binding value per browser, reused while it lasts, so two flows
     * started in two tabs do not invalidate each other.
     */
    const existingBinding: string | undefined =
      CookieUtil.getCookieFromExpressRequest(
        data.req,
        WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME,
      );

    const browserBinding: string = WorkspaceOAuthState.isWellFormedToken(
      existingBinding,
    )
      ? existingBinding
      : WorkspaceOAuthState.generateToken();

    CookieUtil.setCookie(
      data.res,
      WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME,
      browserBinding,
      {
        maxAge: WorkspaceOAuthState.EXPIRES_IN_SECONDS * 1000,
        httpOnly: true,
      },
    );

    const state: string = WorkspaceOAuthState.generateToken();
    const oidcNonce: string | undefined = data.includeOidcNonce
      ? WorkspaceOAuthState.generateToken()
      : undefined;

    const record: JSONObject = {
      flow: data.flow,
      projectId: data.projectId.toString(),
      userId: data.userId.toString(),
      browserBindingHash: WorkspaceOAuthState.hash(browserBinding),
      expiresAt: new Date(
        Date.now() + WorkspaceOAuthState.EXPIRES_IN_SECONDS * 1000,
      ).toISOString(),
    };

    if (data.tenantId) {
      record["tenantId"] = data.tenantId;
    }

    if (oidcNonce) {
      record["oidcNonce"] = oidcNonce;
    }

    await GlobalCache.setString(
      STATE_NAMESPACE,
      WorkspaceOAuthState.hash(state),
      JSON.stringify(record),
      {
        expiresInSeconds: WorkspaceOAuthState.EXPIRES_IN_SECONDS,
      },
    );

    return oidcNonce ? { state, oidcNonce } : { state };
  }

  /*
   * Spends a state. Returns what it stood for, or null when it must be
   * refused: unknown, expired, already used, minted for a different flow, or
   * presented by a browser other than the one that started the flow.
   *
   * The record is deleted before any of those checks run, so a state is burnt
   * by its first presentation whatever the outcome — a failed attempt cannot
   * be retried with a different cookie.
   */
  @CaptureSpan()
  public static async consume(data: {
    req: ExpressRequest;
    state: string | undefined;
    flows: Array<WorkspaceOAuthFlow>;
  }): Promise<WorkspaceOAuthStateRecord | null> {
    if (!WorkspaceOAuthState.isWellFormedToken(data.state)) {
      logger.debug("Workspace OAuth callback refused: malformed state.");
      return null;
    }

    const rawRecord: string | null = await GlobalCache.getAndDeleteString(
      STATE_NAMESPACE,
      WorkspaceOAuthState.hash(data.state),
    );

    if (!rawRecord) {
      logger.debug(
        "Workspace OAuth callback refused: state is unknown, expired, or already used.",
      );
      return null;
    }

    let record: JSONObject;

    try {
      record = JSON.parse(rawRecord) as JSONObject;
    } catch {
      return null;
    }

    const flow: WorkspaceOAuthFlow = record["flow"] as WorkspaceOAuthFlow;

    if (!data.flows.includes(flow)) {
      logger.warn(
        `Workspace OAuth callback refused: state was issued for ${String(flow)}, not ${data.flows.join(" / ")}.`,
      );
      return null;
    }

    const expiresAt: number = Date.parse(String(record["expiresAt"]));

    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
      logger.debug("Workspace OAuth callback refused: state has expired.");
      return null;
    }

    const browserBinding: string | undefined =
      CookieUtil.getCookieFromExpressRequest(
        data.req,
        WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME,
      );

    if (
      !WorkspaceOAuthState.isWellFormedToken(browserBinding) ||
      !WorkspaceOAuthState.hashesMatch(
        WorkspaceOAuthState.hash(browserBinding),
        String(record["browserBindingHash"] || ""),
      )
    ) {
      logger.warn(
        "Workspace OAuth callback refused: completed in a different browser from the one that started it.",
      );
      return null;
    }

    const projectId: string = String(record["projectId"] || "");
    const userId: string = String(record["userId"] || "");

    if (!projectId || !userId) {
      return null;
    }

    return {
      flow,
      projectId: new ObjectID(projectId),
      userId: new ObjectID(userId),
      tenantId: (record["tenantId"] as string | undefined) || undefined,
      oidcNonce: (record["oidcNonce"] as string | undefined) || undefined,
    };
  }

  private static generateToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private static isWellFormedToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
  }

  private static hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private static hashesMatch(a: string, b: string): boolean {
    const bufferA: Buffer = Buffer.from(a, "utf8");
    const bufferB: Buffer = Buffer.from(b, "utf8");

    return (
      bufferA.length === bufferB.length &&
      crypto.timingSafeEqual(bufferA, bufferB)
    );
  }
}
