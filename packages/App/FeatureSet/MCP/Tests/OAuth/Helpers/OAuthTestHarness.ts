/**
 * The harness the MCP OAuth endpoint and flow tests run on.
 *
 * It starts the real Express app with the real MCP routes on an ephemeral
 * port and drives it over HTTP. Inside the process everything the
 * authorization server owns is real - the endpoints, the request gate, the
 * three OAuth services, the signed tickets, the secrets. What is replaced is
 * the world around it, and only at its edge:
 *
 *   Postgres          InMemoryOAuthStore, under the three OAuth services
 *   members, teams,   the maps in this file, behind the same service methods
 *   projects, plans   the authorization server asks (AccessTokenService,
 *   and SSO           UserService, ProjectService, GlobalConfigService)
 *   the browser       `signIn()` and friends decide what UserMiddleware
 *   session           finds on a request to the consent endpoints
 *   Redis             an in-memory counter that can be filled or taken away
 *   HOST              McpOAuthConfig.getOrigin, pointed at the test server
 *
 * Call `OAuthTestHarness.start()` once per file, `reset()` before each test
 * and `stop()` at the end.
 */

import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import { jest } from "@jest/globals";
import InMemoryOAuthStore, { StoreRow } from "./InMemoryOAuthStore";
import { setupMCPRoutes } from "../../../Handlers/RouteHandler";
import ClientIdMetadataDocument from "../../../OAuth/ClientIdMetadataDocument";
import {
  McpOAuthClientKind,
  ResolvedMcpOAuthClient,
} from "../../../OAuth/ClientMetadata";
import McpOAuthError, { McpOAuthErrorCode } from "../../../OAuth/McpOAuthError";
import { McpToolInfo } from "../../../Types/McpTypes";
import ModelType from "../../../Types/ModelType";
import OneUptimeOperation from "../../../Types/OneUptimeOperation";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import Redis from "Common/Server/Infrastructure/Redis";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectService, {
  CurrentPlan,
} from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import CookieUtil from "Common/Server/Utils/Cookie";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  createExpressApp,
} from "Common/Server/Utils/Express";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthGrantAccess from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import SameOriginRequest from "Common/Server/Utils/SameOriginRequest";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import UserType from "Common/Types/UserType";

// What the app's own catch-all answers; proves a request fell through to it.
export const APP_404_MARKER: string = "oneuptime-app-404";

export const DEFAULT_REDIRECT_URI: string = "https://client.example/callback";

export interface TestMember {
  id: ObjectID;
  email: string;
  name: string;
  isMasterAdmin: boolean;
}

export interface TestProject {
  id: ObjectID;
  name: string;
}

interface ProjectState extends TestProject {
  // null: this instance has no billing. "none": the project has no plan yet.
  plan: PlanType | null | "none";
  isSubscriptionUnpaid: boolean;
  requireSso: boolean;
  requiredSsoProviderId: ObjectID | null;
}

type SessionState =
  | { kind: "none" }
  | {
      kind: "member";
      member: TestMember;
      cookies: Dictionary<string>;
      // Overrides the projects the session lists (a stale session).
      listedProjects?: Array<TestProject> | undefined;
    }
  | { kind: "api-key"; project: TestProject; member?: TestMember | undefined }
  | { kind: "master-api-key" }
  | { kind: "delegated"; member: TestMember; project: TestProject };

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  json: any;
  // The Location header parsed, for the redirects every flow is made of.
  location: URL | null;
}

export interface RequestOptions {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  // Sent as application/json.
  json?: unknown;
  // Sent as application/x-www-form-urlencoded.
  form?: Record<string, string | Array<string>> | undefined;
  // Sent exactly as given, with whatever Content-Type `headers` names.
  body?: string | undefined;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface RegisteredTestClient {
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  response: HttpResult;
}

export interface AuthorizeParameters {
  clientId: string;
  redirectUri?: string | undefined;
  codeChallenge?: string | undefined;
  codeChallengeMethod?: string | undefined;
  responseType?: string | undefined;
  state?: string | undefined;
  scope?: string | undefined;
  resource?: string | undefined;
  // Added verbatim; a value of undefined removes a default.
  extra?: Record<string, string | undefined> | undefined;
}

export interface ConnectOptions {
  member: TestMember;
  project: TestProject;
  // What the member picks on the consent screen. Default "write".
  access?: "read" | "write" | undefined;
  // What the client asks for. Default "mcp:read mcp:write".
  scope?: string | undefined;
  client?: { clientId: string; redirectUri: string } | undefined;
  state?: string | undefined;
  clientName?: string | undefined;
}

export interface ConnectedClient {
  clientId: string;
  redirectUri: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  grantId: string;
  codeVerifier: string;
  tokenResponse: HttpResult;
}

interface Restorable {
  mockRestore: () => void;
}

const RATE_LIMIT_KEY_PREFIX: string = "mcpoauth:rl:";

const REQUEST_TIMEOUT_IN_MS: number = 15 * 1000;

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_monthly,price_free_yearly,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",
};

/*
 * A read tool, a write tool and a delete tool: enough for the gate to have
 * something of each kind to classify. Workflow, helper and public tools are
 * recognised by name and need no entry here.
 */
export const DEFAULT_TEST_TOOLS: Array<McpToolInfo> = [
  {
    name: "list_incidents",
    description: "List incidents",
    inputSchema: { type: "object", properties: {} },
    modelName: "Incident",
    operation: OneUptimeOperation.List,
    modelType: ModelType.Database,
    singularName: "Incident",
    pluralName: "Incidents",
    tableName: "Incident",
    apiPath: "/incident",
  },
  {
    name: "count_incidents",
    description: "Count incidents",
    inputSchema: { type: "object", properties: {} },
    modelName: "Incident",
    operation: OneUptimeOperation.Count,
    modelType: ModelType.Database,
    singularName: "Incident",
    pluralName: "Incidents",
    tableName: "Incident",
    apiPath: "/incident",
  },
  {
    name: "create_incident",
    description: "Create an incident",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } },
    },
    modelName: "Incident",
    operation: OneUptimeOperation.Create,
    modelType: ModelType.Database,
    singularName: "Incident",
    pluralName: "Incidents",
    tableName: "Incident",
    apiPath: "/incident",
  },
  {
    name: "delete_incident",
    description: "Delete an incident",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
    },
    modelName: "Incident",
    operation: OneUptimeOperation.Delete,
    modelType: ModelType.Database,
    singularName: "Incident",
    pluralName: "Incidents",
    tableName: "Incident",
    apiPath: "/incident",
  },
];

export default class OAuthTestHarness {
  public readonly store: InMemoryOAuthStore = new InMemoryOAuthStore();

  public origin: string = "";
  public port: number = 0;

  private server: http.Server | null = null;
  private spies: Array<Restorable> = [];
  private savedEnvironment: Record<string, string | undefined> = {};

  private members: Map<string, TestMember> = new Map<string, TestMember>();
  private blockedUserIds: Set<string> = new Set<string>();
  private projects: Map<string, ProjectState> = new Map<string, ProjectState>();
  // userId -> projectId -> the member's permissions in that project.
  private memberships: Map<string, Map<string, Array<UserPermission>>> =
    new Map<string, Map<string, Array<UserPermission>>>();
  private isGlobalSsoRequired: boolean = false;
  private session: SessionState = { kind: "none" };

  private isOAuthEnabled: boolean = true;
  private isClientIdMetadataDocumentEnabled: boolean = true;
  private metadataDocumentClients: Map<
    string,
    ResolvedMcpOAuthClient | McpOAuthError
  > = new Map<string, ResolvedMcpOAuthClient | McpOAuthError>();

  private isRedisAvailable: boolean = true;
  private isRedisFailing: boolean = false;
  private redisCounters: Map<string, number> = new Map<string, number>();
  private redisPrefill: Map<string, number> = new Map<string, number>();
  public redisExpiries: Array<{ key: string; seconds: number }> = [];

  private memberSequence: number = 0;

  // --- Lifecycle -----------------------------------------------------------

  public static async start(
    options?: { tools?: Array<McpToolInfo> | undefined } | undefined,
  ): Promise<OAuthTestHarness> {
    const harness: OAuthTestHarness = new OAuthTestHarness();

    await harness.listen(options?.tools || DEFAULT_TEST_TOOLS);

    return harness;
  }

  private async listen(tools: Array<McpToolInfo>): Promise<void> {
    for (const [name, value] of Object.entries(PLAN_ENVIRONMENT)) {
      this.savedEnvironment[name] = process.env[name];
      process.env[name] = value;
    }

    this.store.install();
    this.installWorld();

    /*
     * The routes capture UserMiddleware.getUserMiddleware when they are set
     * up, so the world has to be installed before this line.
     */
    const app: ExpressApplication = createExpressApp();

    setupMCPRoutes(app, tools);

    // The app's ordinary 404, with a marker so a test can tell it from any other.
    app.use((req: ExpressRequest, res: ExpressResponse): void => {
      res.status(404).json({ marker: APP_404_MARKER, path: req.path });
    });

    await new Promise<void>((resolve: () => void): void => {
      this.server = http.createServer(app);
      this.server.listen(0, "127.0.0.1", (): void => {
        resolve();
      });
    });

    this.port = (this.server!.address() as AddressInfo).port;
    this.origin = `http://127.0.0.1:${this.port}`;
  }

  public async stop(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((): void => {
        resolve();
      });

      /*
       * A request a handler never answered would otherwise hold the server -
       * and the whole test run - open until its socket timed out.
       */
      this.server.closeAllConnections();
    });

    for (const spy of this.spies) {
      spy.mockRestore();
    }

    this.spies = [];
    this.store.uninstall();

    for (const [name, value] of Object.entries(this.savedEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  // Back to an empty world; the server and the fakes stay up.
  public reset(): void {
    this.store.reset();

    this.members.clear();
    this.blockedUserIds.clear();
    this.projects.clear();
    this.memberships.clear();
    this.isGlobalSsoRequired = false;
    this.session = { kind: "none" };

    this.isOAuthEnabled = true;
    this.isClientIdMetadataDocumentEnabled = true;
    this.metadataDocumentClients.clear();

    this.isRedisAvailable = true;
    this.isRedisFailing = false;
    this.redisCounters.clear();
    this.redisPrefill.clear();
    this.redisExpiries = [];

    // The member cache McpOAuthGrantAccess keeps would otherwise outlive a test.
    McpOAuthGrantAccess.clearCache();
  }

  public get resource(): string {
    return `${this.origin}/mcp`;
  }

  public get issuer(): string {
    return `${this.origin}/mcp`;
  }

  // --- The world: members, projects, plans, SSO ----------------------------

  public addMember(
    options?:
      | {
          email?: string | undefined;
          name?: string | undefined;
          isMasterAdmin?: boolean | undefined;
        }
      | undefined,
  ): TestMember {
    this.memberSequence++;

    const member: TestMember = {
      id: ObjectID.generate(),
      email: options?.email || `member${this.memberSequence}@example.com`,
      name: options?.name ?? `Member ${this.memberSequence}`,
      isMasterAdmin: options?.isMasterAdmin === true,
    };

    this.members.set(member.id.toString(), member);

    return member;
  }

  /*
   * Removes the account, and with it the team memberships that hang off it -
   * the cascade deleting a user row sets off.
   */
  public deleteMember(member: TestMember): void {
    this.members.delete(member.id.toString());
    this.memberships.delete(member.id.toString());
  }

  public addProject(
    options?:
      | {
          name?: string | undefined;
          plan?: PlanType | null | "none" | undefined;
          isSubscriptionUnpaid?: boolean | undefined;
        }
      | undefined,
  ): TestProject {
    const project: ProjectState = {
      id: ObjectID.generate(),
      name: options?.name || `Project ${this.projects.size + 1}`,
      /*
       * Growth by default: enough for every plan gate there is, so a test
       * that is not about plans passes whether billing is on or off.
       */
      plan: options?.plan === undefined ? PlanType.Growth : options.plan,
      isSubscriptionUnpaid: options?.isSubscriptionUnpaid === true,
      requireSso: false,
      requiredSsoProviderId: null,
    };

    this.projects.set(project.id.toString(), project);

    return { id: project.id, name: project.name };
  }

  public setProjectPlan(
    project: TestProject,
    plan: PlanType | null | "none",
    isSubscriptionUnpaid: boolean = false,
  ): void {
    const state: ProjectState = this.requireProject(project.id);

    state.plan = plan;
    state.isSubscriptionUnpaid = isSubscriptionUnpaid;
  }

  public setProjectSso(
    project: TestProject,
    options: {
      required: boolean;
      requiredSsoProviderId?: ObjectID | null | undefined;
    },
  ): void {
    const state: ProjectState = this.requireProject(project.id);

    state.requireSso = options.required;
    state.requiredSsoProviderId = options.requiredSsoProviderId || null;
  }

  public setGlobalSsoRequired(isRequired: boolean): void {
    this.isGlobalSsoRequired = isRequired;
  }

  // Makes the member a member of the project, with these permissions.
  public addMembership(
    member: TestMember,
    project: TestProject,
    permissions?: Array<UserPermission> | undefined,
  ): void {
    const byProject: Map<string, Array<UserPermission>> = this.memberships.get(
      member.id.toString(),
    ) || new Map<string, Array<UserPermission>>();

    byProject.set(
      project.id.toString(),
      permissions || [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
        },
      ],
    );

    this.memberships.set(member.id.toString(), byProject);
  }

  public removeMembership(member: TestMember, project: TestProject): void {
    this.memberships.get(member.id.toString())?.delete(project.id.toString());
  }

  // A BLOCK row for AuthorizeMcpClient on one of the member's teams.
  public blockFromConnectingClients(
    member: TestMember,
    project: TestProject,
  ): void {
    const permissions: Array<UserPermission> | undefined = this.memberships
      .get(member.id.toString())
      ?.get(project.id.toString());

    if (!permissions) {
      throw new Error("The member is not a member of that project.");
    }

    permissions.push({
      _type: "UserPermission",
      permission: Permission.AuthorizeMcpClient,
      labelIds: [],
      isBlockPermission: true,
    });
  }

  public blockUser(member: TestMember): void {
    this.blockedUserIds.add(member.id.toString());
  }

  public unblockUser(member: TestMember): void {
    this.blockedUserIds.delete(member.id.toString());
  }

  // A member in a Growth project: the usual starting point.
  public addMemberWithProject(
    options?:
      | {
          isMasterAdmin?: boolean | undefined;
          projectName?: string | undefined;
        }
      | undefined,
  ): { member: TestMember; project: TestProject } {
    const member: TestMember = this.addMember({
      isMasterAdmin: options?.isMasterAdmin,
    });
    const project: TestProject = this.addProject({
      name: options?.projectName,
    });

    this.addMembership(member, project);

    return { member, project };
  }

  // --- Instance switches ---------------------------------------------------

  public setOAuthEnabled(isEnabled: boolean): void {
    this.isOAuthEnabled = isEnabled;
  }

  public setClientIdMetadataDocumentEnabled(isEnabled: boolean): void {
    this.isClientIdMetadataDocumentEnabled = isEnabled;
  }

  /*
   * A client identified by a metadata document. The fetch itself is not made
   * (its own tests cover it); the document is what the fetch would have
   * resolved to.
   */
  public addMetadataDocumentClient(options: {
    clientId: string;
    clientName?: string | undefined;
    clientUri?: string | undefined;
    redirectUris?: Array<string> | undefined;
  }): { clientId: string; redirectUri: string } {
    const redirectUris: Array<string> = options.redirectUris || [
      DEFAULT_REDIRECT_URI,
    ];

    this.metadataDocumentClients.set(options.clientId, {
      clientId: options.clientId,
      kind: McpOAuthClientKind.MetadataDocument,
      clientName: options.clientName || "Document Client",
      ...(options.clientUri ? { clientUri: options.clientUri } : {}),
      redirectUris,
      tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
    });

    return { clientId: options.clientId, redirectUri: redirectUris[0]! };
  }

  // A metadata document URL whose document cannot be used, and why.
  public failMetadataDocument(clientId: string, error: McpOAuthError): void {
    this.metadataDocumentClients.set(clientId, error);
  }

  // --- The browser session the consent endpoints see -----------------------

  public signIn(
    member: TestMember,
    options?:
      | {
          cookies?: Dictionary<string> | undefined;
          /*
           * The projects the session believes the member is in, when that is
           * not what the memberships say: a session older than a removal.
           */
          listedProjects?: Array<TestProject> | undefined;
        }
      | undefined,
  ): void {
    this.session = {
      kind: "member",
      member,
      cookies: options?.cookies || {},
      ...(options?.listedProjects
        ? { listedProjects: options.listedProjects }
        : {}),
    };
  }

  public signOut(): void {
    this.session = { kind: "none" };
  }

  /*
   * A request authenticated by a project API key. With `member`, a request
   * that carries a key AND names a person - not something the middleware
   * produces today, which is exactly why the endpoint must not rely on it.
   */
  public useApiKeySession(
    project: TestProject,
    member?: TestMember | undefined,
  ): void {
    this.session = { kind: "api-key", project, ...(member ? { member } : {}) };
  }

  // A request authenticated by the instance master key.
  public useMasterApiKeySession(): void {
    this.session = { kind: "master-api-key" };
  }

  // A request the MCP server itself makes for a connected client.
  public useDelegatedSession(member: TestMember, project: TestProject): void {
    this.session = { kind: "delegated", member, project };
  }

  /*
   * The cookie a browser holds after signing in to a project with SSO, as
   * CookieUtil.setSSOCookie writes it.
   */
  public projectSsoCookie(
    member: TestMember,
    project: TestProject,
    options?:
      | {
          ssoProviderId?: ObjectID | undefined;
          ssoProviderType?: SsoProviderType | undefined;
        }
      | undefined,
  ): Dictionary<string> {
    const user: User = this.toUser(member);

    return {
      [CookieUtil.getUserSSOKey(project.id)]: CookieUtil.getSSOToken({
        user,
        projectId: project.id,
        ssoProviderId: options?.ssoProviderId,
        ssoProviderType: options?.ssoProviderType,
      }),
    };
  }

  /*
   * The cookie a browser holds after signing in through an instance-wide
   * (Global) identity provider, as CookieUtil.setGlobalSSOCookie writes it.
   */
  public globalSsoCookie(
    member: TestMember,
    options: { ssoProviderId: ObjectID; ssoProviderType: SsoProviderType },
  ): Dictionary<string> {
    return {
      [CookieUtil.getGlobalSSOKey()]: CookieUtil.getGlobalSSOToken({
        user: this.toUser(member),
        ssoProviderId: options.ssoProviderId,
        ssoProviderType: options.ssoProviderType,
      }),
    };
  }

  // --- Redis (the rate limit counters) -------------------------------------

  public setRedisAvailable(isAvailable: boolean): void {
    this.isRedisAvailable = isAvailable;
  }

  // Redis is connected but the counter command throws.
  public setRedisFailing(isFailing: boolean): void {
    this.isRedisFailing = isFailing;
  }

  // The bucket's counter already stands at `count` for every caller.
  public prefillRateLimit(bucket: string, count: number): void {
    this.redisPrefill.set(bucket, count);
  }

  public rateLimitKeys(): Array<string> {
    return Array.from(this.redisCounters.keys());
  }

  // --- HTTP ----------------------------------------------------------------

  public url(path: string): string {
    return `${this.origin}${path}`;
  }

  public async request(
    urlOrPath: string,
    options?: RequestOptions | undefined,
  ): Promise<HttpResult> {
    const headers: Record<string, string> = { ...(options?.headers || {}) };
    let body: string | undefined = options?.body;

    if (options?.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }

    if (options?.form !== undefined) {
      const parameters: URLSearchParams = new URLSearchParams();

      for (const [name, value] of Object.entries(options.form)) {
        for (const single of Array.isArray(value) ? value : [value]) {
          parameters.append(name, single);
        }
      }

      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = parameters.toString();
    }

    const response: Response = await fetch(
      urlOrPath.startsWith("http") ? urlOrPath : this.url(urlOrPath),
      {
        method: options?.method || (body === undefined ? "GET" : "POST"),
        headers,
        ...(body !== undefined ? { body } : {}),
        // Every redirect here is something a test wants to look at.
        redirect: "manual",
        // A handler that never answers fails the test instead of hanging it.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_IN_MS),
      },
    );

    return await OAuthTestHarness.toResult(response);
  }

  /*
   * A request over the raw http client, for what fetch will not send: a Host
   * header of the caller's choosing, or the same header twice.
   */
  public rawRequest(options: {
    method: string;
    path: string;
    headers?: Record<string, string | Array<string>> | undefined;
    body?: string | undefined;
  }): Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    text: string;
    json: any;
  }> {
    return new Promise(
      (
        resolve: (value: {
          status: number;
          headers: http.IncomingHttpHeaders;
          text: string;
          json: any;
        }) => void,
        reject: (reason: unknown) => void,
      ): void => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: this.port,
            path: options.path,
            method: options.method,
            headers: {
              ...(options.body !== undefined
                ? { "Content-Length": Buffer.byteLength(options.body) }
                : {}),
              ...(options.headers || {}),
            },
          },
          (res: http.IncomingMessage): void => {
            let text: string = "";

            res.setEncoding("utf8");
            res.on("data", (chunk: string): void => {
              text += chunk;
            });
            res.on("end", (): void => {
              resolve({
                status: res.statusCode || 0,
                headers: res.headers,
                text,
                json: OAuthTestHarness.parseJson(text),
              });
            });
          },
        );

        request.on("error", reject);
        request.end(options.body);
      },
    );
  }

  private static async toResult(response: Response): Promise<HttpResult> {
    const text: string = await response.text();
    const location: string | null = response.headers.get("location");

    return {
      status: response.status,
      headers: response.headers,
      text,
      json: OAuthTestHarness.parseJson(text),
      location: location ? new URL(location) : null,
    };
  }

  // JSON, or the JSON in the first `data:` line of an event stream, or null.
  private static parseJson(text: string): any {
    const dataLine: string | undefined = text
      .split(/\r?\n/)
      .find((line: string): boolean => {
        return line.startsWith("data:");
      });

    const candidate: string = dataLine
      ? dataLine.slice("data:".length).trim()
      : text.trim();

    if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
      return null;
    }

    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  // --- The OAuth steps, one call each --------------------------------------

  public static pkce(): PkcePair {
    const codeVerifier: string = crypto.randomBytes(32).toString("base64url");

    return {
      codeVerifier,
      codeChallenge: crypto
        .createHash("sha256")
        .update(codeVerifier, "ascii")
        .digest("base64url"),
    };
  }

  public async register(
    metadata?: Record<string, unknown> | undefined,
  ): Promise<RegisteredTestClient> {
    const body: Record<string, unknown> = {
      client_name: "Test MCP Client",
      redirect_uris: [DEFAULT_REDIRECT_URI],
      token_endpoint_auth_method: "none",
      ...(metadata || {}),
    };

    const response: HttpResult = await this.request("/mcp/oauth/register", {
      json: body,
    });

    if (response.status !== 201) {
      throw new Error(
        `Client registration failed (${response.status}): ${response.text}`,
      );
    }

    return {
      clientId: response.json.client_id,
      clientSecret: response.json.client_secret || null,
      redirectUri: (body["redirect_uris"] as Array<string>)[0]!,
      response,
    };
  }

  public authorizeUrl(parameters: AuthorizeParameters): string {
    const url: URL = new URL(this.url("/mcp/oauth/authorize"));

    const values: Record<string, string | undefined> = {
      response_type: parameters.responseType ?? "code",
      client_id: parameters.clientId,
      redirect_uri: parameters.redirectUri ?? DEFAULT_REDIRECT_URI,
      code_challenge:
        parameters.codeChallenge ?? OAuthTestHarness.pkce().codeChallenge,
      code_challenge_method: parameters.codeChallengeMethod ?? "S256",
      state: parameters.state,
      scope: parameters.scope,
      resource: parameters.resource,
      ...(parameters.extra || {}),
    };

    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) {
        url.searchParams.set(name, value);
      }
    }

    return url.toString();
  }

  // Opens the authorization URL the way a browser does, without following.
  public async authorize(parameters: AuthorizeParameters): Promise<HttpResult> {
    return await this.request(this.authorizeUrl(parameters));
  }

  /*
   * The ticket the authorization endpoint handed to the consent screen.
   * Throws when the request was not accepted, with where it went instead.
   */
  public async authorizeForTicket(
    parameters: AuthorizeParameters,
  ): Promise<string> {
    const response: HttpResult = await this.authorize(parameters);
    const ticket: string | null | undefined =
      response.location?.searchParams.get("request");

    if (response.status !== 302 || !ticket) {
      throw new Error(
        `The authorization request was not accepted: ${response.status} ${response.location?.toString() || response.text}`,
      );
    }

    return ticket;
  }

  public async consent(
    step: "details" | "approve" | "deny",
    body: Record<string, unknown>,
    headers?: Record<string, string> | undefined,
  ): Promise<HttpResult> {
    return await this.request(`/mcp/oauth/consent/${step}`, {
      json: body,
      headers,
    });
  }

  public async token(
    form: Record<string, string | Array<string>>,
    headers?: Record<string, string> | undefined,
  ): Promise<HttpResult> {
    return await this.request("/mcp/oauth/token", { form, headers });
  }

  public async refresh(
    clientId: string,
    refreshToken: string,
    extra?: Record<string, string> | undefined,
  ): Promise<HttpResult> {
    return await this.token({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      ...(extra || {}),
    });
  }

  public async revoke(
    form: Record<string, string | Array<string>>,
    headers?: Record<string, string> | undefined,
  ): Promise<HttpResult> {
    return await this.request("/mcp/oauth/revoke", { form, headers });
  }

  // One JSON-RPC message (or batch) to the MCP endpoint, answered as JSON.
  public async mcp(
    body: unknown,
    headers?: Record<string, string> | undefined,
  ): Promise<HttpResult> {
    return await this.request("/mcp", {
      json: body,
      headers: {
        Accept: "application/json",
        ...(headers || {}),
      },
    });
  }

  public async callTool(
    name: string,
    args: Record<string, unknown>,
    headers?: Record<string, string> | undefined,
  ): Promise<HttpResult> {
    return await this.mcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      },
      headers,
    );
  }

  public static bearer(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  /*
   * The whole journey of one client being connected by one member: register,
   * authorize, approve on the consent screen, exchange the code.
   */
  public async connect(options: ConnectOptions): Promise<ConnectedClient> {
    const client: { clientId: string; redirectUri: string } =
      options.client ||
      (await this.register(
        options.clientName ? { client_name: options.clientName } : undefined,
      ));

    const pkce: PkcePair = OAuthTestHarness.pkce();

    const ticket: string = await this.authorizeForTicket({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      codeChallenge: pkce.codeChallenge,
      scope: options.scope ?? "mcp:read mcp:write",
      state: options.state,
      resource: this.resource,
    });

    const previousSession: SessionState = this.session;

    this.signIn(
      options.member,
      previousSession.kind === "member" &&
        previousSession.member.id.toString() === options.member.id.toString()
        ? { cookies: previousSession.cookies }
        : undefined,
    );

    const approval: HttpResult = await this.consent("approve", {
      request: ticket,
      projectId: options.project.id.toString(),
      access: options.access || "write",
    });

    this.session = previousSession;

    if (approval.status !== 200) {
      throw new Error(
        `The consent was not accepted (${approval.status}): ${approval.text}`,
      );
    }

    const code: string | null = new URL(
      approval.json.redirectUrl,
    ).searchParams.get("code");

    if (!code) {
      throw new Error(`No code in ${approval.json.redirectUrl}`);
    }

    const tokenResponse: HttpResult = await this.token({
      grant_type: "authorization_code",
      client_id: client.clientId,
      code,
      code_verifier: pkce.codeVerifier,
      redirect_uri: client.redirectUri,
    });

    if (tokenResponse.status !== 200) {
      throw new Error(
        `The code exchange failed (${tokenResponse.status}): ${tokenResponse.text}`,
      );
    }

    const tokenRow: StoreRow = this.store.requireTokenBySecret(
      tokenResponse.json.access_token,
    );

    return {
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      accessToken: tokenResponse.json.access_token,
      refreshToken: tokenResponse.json.refresh_token,
      scope: tokenResponse.json.scope,
      grantId: String(tokenRow["mcpOAuthGrantId"]),
      codeVerifier: pkce.codeVerifier,
      tokenResponse,
    };
  }

  /*
   * Everything up to, and not including, the code exchange: the code a client
   * would be holding once the member has approved.
   */
  public async approveForCode(options: ConnectOptions): Promise<{
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
    ticket: string;
    redirectUrl: URL;
  }> {
    const client: { clientId: string; redirectUri: string } =
      options.client || (await this.register());

    const pkce: PkcePair = OAuthTestHarness.pkce();

    const ticket: string = await this.authorizeForTicket({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      codeChallenge: pkce.codeChallenge,
      scope: options.scope ?? "mcp:read mcp:write",
      state: options.state,
      resource: this.resource,
    });

    const previousSession: SessionState = this.session;

    this.signIn(
      options.member,
      previousSession.kind === "member" &&
        previousSession.member.id.toString() === options.member.id.toString()
        ? { cookies: previousSession.cookies }
        : undefined,
    );

    const approval: HttpResult = await this.consent("approve", {
      request: ticket,
      projectId: options.project.id.toString(),
      access: options.access || "write",
    });

    this.session = previousSession;

    if (approval.status !== 200) {
      throw new Error(
        `The consent was not accepted (${approval.status}): ${approval.text}`,
      );
    }

    const redirectUrl: URL = new URL(approval.json.redirectUrl);
    const code: string | null = redirectUrl.searchParams.get("code");

    if (!code) {
      throw new Error(`No code in ${approval.json.redirectUrl}`);
    }

    return {
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      code,
      codeVerifier: pkce.codeVerifier,
      ticket,
      redirectUrl,
    };
  }

  // --- The fakes -----------------------------------------------------------

  private replace(
    target: unknown,
    method: string,
    implementation: (...args: Array<any>) => unknown,
  ): void {
    const spy: {
      mockImplementation: (
        implementation: (...args: Array<any>) => unknown,
      ) => unknown;
      mockRestore: () => void;
    } = jest.spyOn(target as any, method as never) as any;

    spy.mockImplementation(implementation);
    this.spies.push(spy);
  }

  private installWorld(): void {
    // --- Configuration ---

    this.replace(McpOAuthConfig, "getOrigin", (): string => {
      return this.origin;
    });

    this.replace(McpOAuthConfig, "isEnabled", (): boolean => {
      return this.isOAuthEnabled;
    });

    this.replace(
      McpOAuthConfig,
      "isClientIdMetadataDocumentEnabled",
      (): boolean => {
        return this.isClientIdMetadataDocumentEnabled;
      },
    );

    // The consent endpoints compare a browser's Origin with this.
    this.replace(SameOriginRequest, "getInstanceOrigin", (): string => {
      return this.origin;
    });

    this.replace(
      ClientIdMetadataDocument,
      "resolve",
      async (clientId: string): Promise<ResolvedMcpOAuthClient> => {
        const client: ResolvedMcpOAuthClient | McpOAuthError | undefined =
          this.metadataDocumentClients.get(clientId);

        if (!client) {
          throw new McpOAuthError(
            McpOAuthErrorCode.TemporarilyUnavailable,
            "The client metadata document could not be retrieved (HTTP 404).",
          );
        }

        if (client instanceof McpOAuthError) {
          throw client;
        }

        return { ...client, redirectUris: [...client.redirectUris] };
      },
    );

    // --- Members and their standing ---

    this.replace(
      UserService,
      "findOneById",
      async (input: { id: ObjectID }): Promise<User | null> => {
        const member: TestMember | undefined = this.members.get(
          input.id.toString(),
        );

        return member ? this.toUser(member) : null;
      },
    );

    this.replace(
      UserService,
      "isUserBlocked",
      async (userId: ObjectID): Promise<boolean> => {
        return this.blockedUserIds.has(userId.toString());
      },
    );

    this.replace(UserService, "updateLastActive", async (): Promise<void> => {
      // Not the authorization server's business.
    });

    this.replace(
      AccessTokenService,
      "getUserTenantAccessPermission",
      async (
        userId: ObjectID,
        projectId: ObjectID,
      ): Promise<UserTenantAccessPermission | null> => {
        const permissions: Array<UserPermission> | undefined = this.memberships
          .get(userId.toString())
          ?.get(projectId.toString());

        if (!permissions) {
          return null;
        }

        return {
          _type: "UserTenantAccessPermission",
          projectId,
          permissions: [...permissions],
        };
      },
    );

    this.replace(
      AccessTokenService,
      "getUserGlobalAccessPermission",
      async (userId: ObjectID): Promise<UserGlobalAccessPermission | null> => {
        return this.getGlobalPermission(userId);
      },
    );

    this.replace(
      TeamMemberService,
      "getTeamIdsForUser",
      async (): Promise<Array<ObjectID>> => {
        return [];
      },
    );

    /*
     * Membership as the database answers it (ProjectMembership.isMember), read
     * on every consent and every use of a grant: the same memberships the
     * permission sets above come from.
     */
    this.replace(
      TeamMemberService,
      "isUserMemberOfProject",
      async (data: {
        projectId: ObjectID;
        userId: ObjectID;
      }): Promise<boolean> => {
        return Boolean(
          this.memberships
            .get(data.userId.toString())
            ?.has(data.projectId.toString()),
        );
      },
    );

    // --- Projects ---

    this.replace(
      ProjectService,
      "getRequireSsoForLogin",
      async (projectId: ObjectID): Promise<boolean> => {
        return this.requireProject(projectId).requireSso;
      },
    );

    this.replace(
      ProjectService,
      "getRequireSsoWithSsoProviderId",
      async (projectId: ObjectID): Promise<ObjectID | null> => {
        return this.requireProject(projectId).requiredSsoProviderId;
      },
    );

    this.replace(
      ProjectService,
      "getCurrentPlan",
      async (projectId: ObjectID): Promise<CurrentPlan> => {
        const project: ProjectState = this.requireProject(projectId);

        if (project.plan === "none") {
          throw new BadDataException("Project does not have any plans");
        }

        return {
          plan: project.plan,
          isSubscriptionUnpaid: project.isSubscriptionUnpaid,
        };
      },
    );

    this.replace(
      ProjectService,
      "findBy",
      async (input: { query: { _id?: unknown } }): Promise<Array<Project>> => {
        const ids: Array<string> = OAuthTestHarness.idsOf(input.query._id);

        return Array.from(this.projects.values())
          .filter((project: ProjectState): boolean => {
            return ids.includes(project.id.toString());
          })
          .map((state: ProjectState): Project => {
            const project: Project = new Project();

            project._id = state.id.toString();
            project.name = state.name;

            return project;
          });
      },
    );

    this.replace(
      ProjectService,
      "updateLastActive",
      async (): Promise<void> => {
        // Not the authorization server's business.
      },
    );

    this.replace(
      GlobalConfigService,
      "getRequireSsoForLogin",
      async (): Promise<boolean> => {
        return this.isGlobalSsoRequired;
      },
    );

    // --- The browser session ---

    this.replace(
      UserMiddleware,
      "getUserMiddleware",
      async (
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        this.applySession(req as OneUptimeRequest);
        next();
      },
    );

    // --- Redis ---

    this.replace(Redis, "isConnected", (): boolean => {
      return this.isRedisAvailable;
    });

    this.replace(Redis, "getClient", (): unknown => {
      if (!this.isRedisAvailable) {
        return null;
      }

      return {
        incr: async (key: string): Promise<number> => {
          if (this.isRedisFailing) {
            throw new Error(
              "READONLY You can't write against a read only replica.",
            );
          }

          const bucket: string = key
            .slice(RATE_LIMIT_KEY_PREFIX.length)
            .split(":")[0]!;

          const next: number =
            (this.redisCounters.get(key) ??
              this.redisPrefill.get(bucket) ??
              0) + 1;

          this.redisCounters.set(key, next);

          return next;
        },
        expire: async (key: string, seconds: number): Promise<number> => {
          this.redisExpiries.push({ key, seconds });
          return 1;
        },
      };
    });
  }

  private applySession(req: OneUptimeRequest): void {
    const session: SessionState = this.session;

    switch (session.kind) {
      case "member":
        req.cookies = { ...session.cookies };
        req.userType = session.member.isMasterAdmin
          ? UserType.MasterAdmin
          : UserType.User;
        req.userAuthorization = {
          userId: session.member.id,
          email: new Email(session.member.email),
          name: new Name(session.member.name),
          isMasterAdmin: session.member.isMasterAdmin,
          isGlobalLogin: true,
        };
        req.userGlobalAccessPermission = {
          ...this.getGlobalPermission(session.member.id),
          ...(session.listedProjects
            ? {
                projectIds: session.listedProjects.map(
                  (project: TestProject): ObjectID => {
                    return project.id;
                  },
                ),
              }
            : {}),
        };
        return;
      case "api-key":
        req.userType = UserType.API;
        req.tenantId = session.project.id;
        req.apiKeyId = ObjectID.generate();
        req.apiKeyName = "CI key";

        if (session.member) {
          req.userType = UserType.User;
          req.userAuthorization = {
            userId: session.member.id,
            email: new Email(session.member.email),
            name: new Name(session.member.name),
            isMasterAdmin: false,
            isGlobalLogin: true,
          };
        }

        return;
      case "master-api-key":
        req.userType = UserType.MasterAdmin;
        req.apiKeyName = "Master API Key";
        return;
      case "delegated":
        req.userType = UserType.User;
        req.tenantId = session.project.id;
        req.userAuthorization = {
          userId: session.member.id,
          email: new Email(session.member.email),
          name: new Name(session.member.name),
          isMasterAdmin: false,
          isGlobalLogin: false,
        };
        req.userGlobalAccessPermission = {
          ...this.getGlobalPermission(session.member.id),
          projectIds: [session.project.id],
        };
        req.mcpOAuth = {
          grantId: ObjectID.generate(),
          clientId: "00000000-0000-4000-8000-000000000001",
          clientName: "An already connected client",
          isReadOnly: false,
        };
        return;
      default:
        // Nobody: what UserMiddleware leaves behind for a request with no session.
        req.userType = UserType.Public;
    }
  }

  private getGlobalPermission(userId: ObjectID): UserGlobalAccessPermission {
    return {
      _type: "UserGlobalAccessPermission",
      projectIds: Array.from(
        this.memberships.get(userId.toString())?.keys() || [],
      ).map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      globalPermissions: [Permission.Public, Permission.User],
    };
  }

  private requireProject(projectId: ObjectID): ProjectState {
    const project: ProjectState | undefined = this.projects.get(
      projectId.toString(),
    );

    if (!project) {
      // What ProjectService says about a project that does not exist.
      throw new BadDataException("Project not found");
    }

    return project;
  }

  private toUser(member: TestMember): User {
    const user: User = new User();

    user._id = member.id.toString();
    user.email = new Email(member.email);
    user.name = new Name(member.name);
    user.isMasterAdmin = member.isMasterAdmin;

    return user;
  }

  // The ids a QueryHelper.any(...) operator, or a plain id, selects.
  private static idsOf(value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    const operator: {
      getSql?: ((alias: string) => string) | undefined;
      objectLiteralParameters?: Record<string, unknown> | undefined;
    } = value as {
      getSql?: ((alias: string) => string) | undefined;
      objectLiteralParameters?: Record<string, unknown> | undefined;
    };

    if (typeof operator.getSql !== "function") {
      return [String(value)];
    }

    const sql: string = operator.getSql("column");

    if (sql.includes("TRUE = FALSE")) {
      return [];
    }

    const parameters: Array<unknown> = Object.values(
      operator.objectLiteralParameters || {},
    );

    if (sql.includes(" IN (") && Array.isArray(parameters[0])) {
      return (parameters[0] as Array<unknown>).map((id: unknown): string => {
        return String(id);
      });
    }

    throw new Error(
      `The OAuth test harness does not understand this project query: ${sql}`,
    );
  }
}

// --- Small helpers the test files share ------------------------------------

/*
 * A gate one piece of code waits at until a test opens it: how a test holds
 * one request still while another overtakes it.
 */
export class Gate {
  private release: () => void = (): void => {
    // Replaced in the constructor.
  };

  public readonly opened: Promise<void>;

  private arrive: () => void = (): void => {
    // Replaced in the constructor.
  };

  // Resolves when something has reached the gate and is waiting at it.
  public readonly reached: Promise<void>;

  public constructor() {
    this.opened = new Promise<void>((resolve: () => void): void => {
      this.release = resolve;
    });

    this.reached = new Promise<void>((resolve: () => void): void => {
      this.arrive = resolve;
    });
  }

  public async wait(): Promise<void> {
    this.arrive();
    await this.opened;
  }

  public open(): void {
    this.release();
  }
}

// The parameters of a `WWW-Authenticate: Bearer ...` value.
export function parseBearerChallenge(
  headerValue: string | null,
): Record<string, string> {
  const parameters: Record<string, string> = {};

  if (!headerValue) {
    return parameters;
  }

  const PARAMETER_PATTERN: RegExp = /([a-z_]+)="([^"]*)"/g;

  let match: RegExpExecArray | null = PARAMETER_PATTERN.exec(headerValue);

  while (match) {
    parameters[match[1]!] = match[2]!;
    match = PARAMETER_PATTERN.exec(headerValue);
  }

  return parameters;
}
