/**
 * The consent endpoints over HTTP (POST /mcp/oauth/consent/details | approve
 * | deny): the one step of the flow a person takes part in, and so the only
 * place a member's access can be delegated to a client.
 *
 * Three questions run through the file: WHO may call these (a signed-in
 * person, from OneUptime's own page - not an API key, not an already
 * connected client, not another site), WHICH projects a client can be
 * connected to (and that the server re-checks the one that was chosen), and
 * WHAT exactly an approval writes.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  /*
   * Only the logger itself is silenced. The module's other exports stay real:
   * the API's error responder calls one of them on every refusal.
   */
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});

/*
 * Whether this instance bills is read from the environment when the module
 * loads, and it decides whether a plan gates anything. CI runs with billing
 * on and a developer's machine with it off, so here it is a switch the tests
 * set themselves: both directions are checked in every run.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  /*
   * Defined as a property rather than written in the literal above: an object
   * spread is compiled to Object.assign, which would read a getter once and
   * copy its value.
   */
  Object.defineProperty(mocked, "IsBillingEnabled", {
    enumerable: true,
    configurable: true,
    get: (): boolean => {
      return (
        (globalThis as Record<string, unknown>)[
          "__mcpOAuthConsentTestBillingEnabled"
        ] !== false
      );
    },
  });

  return mocked;
});

import OAuthTestHarness, {
  APP_404_MARKER,
  DEFAULT_REDIRECT_URI,
  HttpResult,
  RegisteredTestClient,
  TestMember,
  TestProject,
} from "./Helpers/OAuthTestHarness";
import { StoreCall, StoreRow } from "./Helpers/InMemoryOAuthStore";
import AuthorizationRequest from "../../OAuth/AuthorizationRequest";
import { McpOAuthClientKind } from "../../OAuth/ClientMetadata";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import McpDelegationToken from "Common/Server/Utils/Mcp/McpDelegationToken";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import UserType from "Common/Types/UserType";

type ConsentStep = "details" | "approve" | "deny";

const ALL_STEPS: Array<ConsentStep> = ["details", "approve", "deny"];

const CODE_CHALLENGE: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const DOCUMENT_CLIENT_ID: string = "https://client.example/oauth/client.json";
const THIRTY_DAYS_IN_MS: number = 30 * 24 * 60 * 60 * 1000;

const EXPIRED_MESSAGE: string =
  "This authorization request has expired. Go back to your MCP client and start connecting again.";

// All a person is told about a failure nobody chose the wording of.
const UNEXPECTED_FAILURE_MESSAGE: string =
  "Something went wrong on our side. Please try again in a few minutes.";

const UNEXPECTED_FAILURE_LOG_LINE: string =
  "MCP OAuth: a consent request failed unexpectedly.";

function setBilling(isEnabled: boolean): void {
  (globalThis as Record<string, unknown>)[
    "__mcpOAuthConsentTestBillingEnabled"
  ] = isEnabled;
}

describe("/mcp/oauth/consent", () => {
  let harness: OAuthTestHarness;
  let client: RegisteredTestClient;
  let member: TestMember;
  let project: TestProject;
  let ticket: string;

  beforeAll(async () => {
    harness = await OAuthTestHarness.start();
  });

  afterAll(async () => {
    await harness.stop();
    delete (globalThis as Record<string, unknown>)[
      "__mcpOAuthConsentTestBillingEnabled"
    ];
  });

  beforeEach(async () => {
    harness.reset();
    jest.clearAllMocks();
    setBilling(true);

    client = await harness.register();
    ({ member, project } = harness.addMemberWithProject({
      projectName: "Acme Production",
    }));

    ticket = await harness.authorizeForTicket({
      clientId: client.clientId,
      codeChallenge: CODE_CHALLENGE,
      state: "client-state",
      scope: "mcp:read mcp:write",
      resource: harness.resource,
    });

    harness.signIn(member);
  });

  // What a step needs in its body for the request to be otherwise valid.
  function bodyFor(step: ConsentStep, request: unknown = ticket): any {
    return step === "approve"
      ? { request, projectId: project.id.toString(), access: "write" }
      : { request };
  }

  function expectNothingWritten(): void {
    expect(harness.store.count("grant")).toBe(0);
    expect(harness.store.count("token")).toBe(0);
  }

  async function ticketFor(
    options: {
      scope?: string | undefined;
      state?: string | undefined;
      clientId?: string | undefined;
      redirectUri?: string | undefined;
    } = {},
  ): Promise<string> {
    return await harness.authorizeForTicket({
      clientId: options.clientId || client.clientId,
      redirectUri: options.redirectUri,
      codeChallenge: CODE_CHALLENGE,
      scope: options.scope,
      state: options.state,
    });
  }

  describe("who may call", () => {
    describe.each(ALL_STEPS)("%s", (step: ConsentStep) => {
      it("answers 401 when nobody is signed in (which is what starts a sign-in)", async () => {
        harness.signOut();

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(401);
        expect(response.json).toEqual({
          message:
            "Sign in to OneUptime to continue connecting your MCP client.",
        });
        expectNothingWritten();
      });

      it("refuses a project API key", async () => {
        harness.useApiKeySession(project);

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(401);
        expectNothingWritten();
      });

      it("refuses the instance master key", async () => {
        harness.useMasterApiKeySession();

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(401);
        expectNothingWritten();
      });

      it("refuses a request that names a person but arrived with an API key", async () => {
        harness.useApiKeySession(project, member);

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(422);
        expect(response.json.message).toBe(
          "Only a signed-in person can connect an MCP client.",
        );
        expectNothingWritten();
      });

      it("refuses an already connected client acting for its member: it cannot approve another", async () => {
        harness.useDelegatedSession(member, project);

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(422);
        expect(response.json.message).toBe(
          "Only a signed-in person can connect an MCP client.",
        );
        expectNothingWritten();
      });

      it.each([
        ["another site's Origin", { Origin: "https://evil.example" }],
        ["an opaque Origin", { Origin: "null" }],
        ["this host on another port", { Origin: "http://127.0.0.1:1" }],
        ["a cross-site fetch", { "Sec-Fetch-Site": "cross-site" }],
        [
          "a same-site (sibling subdomain) fetch",
          { "Sec-Fetch-Site": "same-site" },
        ],
      ])(
        "refuses a request from %s, even with the member's session",
        async (_label: string, headers: Record<string, string>) => {
          const response: HttpResult = await harness.consent(
            step,
            bodyFor(step),
            headers,
          );

          expect(response.status).toBe(403);
          expect(response.json.message).toBe(
            "This request must come from the OneUptime consent page.",
          );
          expectNothingWritten();
        },
      );

      it("accepts the consent page's own request", async () => {
        const response: HttpResult = await harness.consent(
          step,
          bodyFor(step),
          {
            Origin: harness.origin,
            "Sec-Fetch-Site": "same-origin",
          },
        );

        expect(response.status).toBe(200);
      });

      it("checks where the request came from before it says whether anyone is signed in", async () => {
        harness.signOut();

        const response: HttpResult = await harness.consent(
          step,
          bodyFor(step),
          {
            Origin: "https://evil.example",
          },
        );

        expect(response.status).toBe(403);
      });

      it.each<[string, unknown]>([
        ["a missing ticket", undefined],
        ["an empty ticket", ""],
        ["a ticket that is not a string", { request: "x" }],
        ["something that is not a ticket", "not-a-ticket"],
      ])("answers 400 for %s", async (_label: string, request: unknown) => {
        const body: any = bodyFor(step);

        if (request === undefined) {
          delete body.request;
        } else {
          body.request = request;
        }

        const response: HttpResult = await harness.consent(step, body);

        expect(response.status).toBe(400);
        expect(response.json).toEqual({ message: EXPIRED_MESSAGE });
        expectNothingWritten();
      });

      it("answers 400 for a ticket that has expired", async () => {
        const elevenMinutesAgo: Date = new Date(Date.now() - 11 * 60 * 1000);

        const expired: string = AuthorizationRequest.toTicket(
          {
            clientId: client.clientId,
            clientKind: McpOAuthClientKind.Registered,
            clientName: "Test MCP Client",
            redirectUri: DEFAULT_REDIRECT_URI,
            codeChallenge: CODE_CHALLENGE,
            scopes: [McpOAuthScope.Read, McpOAuthScope.Write],
            resource: harness.resource,
          },
          elevenMinutesAgo,
        );

        const response: HttpResult = await harness.consent(
          step,
          bodyFor(step, expired),
        );

        expect(response.status).toBe(400);
        expect(response.json).toEqual({ message: EXPIRED_MESSAGE });
        expectNothingWritten();
      });

      it("still accepts a ticket one minute before it expires", async () => {
        const nineMinutesAgo: Date = new Date(Date.now() - 9 * 60 * 1000);

        const aging: string = AuthorizationRequest.toTicket(
          {
            clientId: client.clientId,
            clientKind: McpOAuthClientKind.Registered,
            clientName: "Test MCP Client",
            redirectUri: DEFAULT_REDIRECT_URI,
            codeChallenge: CODE_CHALLENGE,
            scopes: [McpOAuthScope.Read, McpOAuthScope.Write],
            resource: harness.resource,
          },
          nineMinutesAgo,
        );

        const response: HttpResult = await harness.consent(
          step,
          bodyFor(step, aging),
        );

        expect(response.status).toBe(200);
      });

      it("answers 400 for a ticket whose contents were altered", async () => {
        const parts: Array<string> = ticket.split(".");
        const payload: any = JSON.parse(
          Buffer.from(parts[1]!, "base64url").toString("utf8"),
        );

        // The redirect URI is what an attacker would most like to rewrite.
        payload.c.ru = "https://attacker.example/steal";

        const forged: string = [
          parts[0],
          Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
          parts[2],
        ].join(".");

        const response: HttpResult = await harness.consent(
          step,
          bodyFor(step, forged),
        );

        expect(response.status).toBe(400);
        expect(response.json).toEqual({ message: EXPIRED_MESSAGE });
        expectNothingWritten();
      });

      it("answers 400 for a signed token made for another purpose", async () => {
        // Signed by the same server with the same secret, for the API.
        const delegation: string = McpDelegationToken.sign({
          userId: member.id,
          userEmail: new Email(member.email),
          userName: member.name,
          projectId: project.id,
          grantId: ObjectID.generate(),
          clientId: client.clientId,
          clientName: "Test MCP Client",
          canWrite: true,
        });

        const response: HttpResult = await harness.consent(
          step,
          bodyFor(step, delegation),
        );

        expect(response.status).toBe(400);
        expectNothingWritten();
      });

      it("may never be cached, and is not opened to other origins", async () => {
        const success: HttpResult = await harness.consent(step, bodyFor(step));

        harness.signOut();

        const failure: HttpResult = await harness.consent(step, bodyFor(step));

        for (const response of [success, failure]) {
          expect(response.headers.get("cache-control")).toBe("no-store");
          // These ride on the session cookie: no blanket CORS, unlike /token.
          expect(
            response.headers.get("access-control-allow-origin"),
          ).toBeNull();
        }
      });

      it("answers the API's 429 envelope past six hundred calls in a window", async () => {
        harness.prefillRateLimit("consent", 600);

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(429);
        expect(response.json).toEqual({
          message: "Too many requests. Please try again later.",
        });
        expect(
          Number(response.headers.get("retry-after")),
        ).toBeGreaterThanOrEqual(1);
        expectNothingWritten();
      });

      it("carries on when Redis is down", async () => {
        harness.setRedisAvailable(false);

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(200);
      });

      it("is the app's ordinary 404 when OAuth is switched off", async () => {
        harness.setOAuthEnabled(false);

        const response: HttpResult = await harness.consent(step, bodyFor(step));

        expect(response.status).toBe(404);
        expect(response.json.marker).toBe(APP_404_MARKER);
        expectNothingWritten();
      });

      it("is only a POST", async () => {
        const response: HttpResult = await harness.request(
          `/mcp/oauth/consent/${step}`,
        );

        expect(response.status).toBe(404);
        expect(response.json.marker).toBe(APP_404_MARKER);
      });
    });

    it("refuses a body over 64 KB", async () => {
      const response: HttpResult = await harness.consent("details", {
        request: ticket,
        padding: "x".repeat(70 * 1024),
      });

      expect(response.status).toBe(413);
    });
  });

  describe("details", () => {
    it("says who is asking, what for, as whom, and where it can be granted", async () => {
      const response: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(response.status).toBe(200);
      expect(response.json).toEqual({
        client: {
          name: "Test MCP Client",
          verifiedHost: null,
          uri: null,
          redirectTarget: "client.example",
          isLoopbackRedirect: false,
        },
        requestedAccess: "write",
        user: { email: member.email, name: member.name },
        projects: [
          {
            id: project.id.toString(),
            name: "Acme Production",
            isEligible: true,
            refusal: null,
          },
        ],
      });
    });

    it("writes nothing", async () => {
      await harness.consent("details", { request: ticket });

      expectNothingWritten();
    });

    it("offers read-only when that is all the client asked for", async () => {
      const response: HttpResult = await harness.consent("details", {
        request: await ticketFor({ scope: "mcp:read" }),
      });

      expect(response.json.requestedAccess).toBe("read");
    });

    it("offers read-only when the client asked for no scope at all", async () => {
      const response: HttpResult = await harness.consent("details", {
        request: await ticketFor({}),
      });

      expect(response.json.requestedAccess).toBe("read");
    });

    it("names the host of a metadata document client, the one thing it did not merely assert", async () => {
      harness.addMetadataDocumentClient({
        clientId: DOCUMENT_CLIENT_ID,
        clientName: "Claude",
        clientUri: "https://client.example/about",
      });

      const response: HttpResult = await harness.consent("details", {
        request: await ticketFor({ clientId: DOCUMENT_CLIENT_ID }),
      });

      expect(response.json.client).toEqual({
        name: "Claude",
        verifiedHost: "client.example",
        uri: "https://client.example/about",
        redirectTarget: "client.example",
        isLoopbackRedirect: false,
      });
    });

    it("never gives a registered client a verified host, whatever it called itself", async () => {
      const impostor: RegisteredTestClient = await harness.register({
        client_name: "claude.ai",
        client_uri: "https://claude.ai/",
      });

      const response: HttpResult = await harness.consent("details", {
        request: await ticketFor({ clientId: impostor.clientId }),
      });

      expect(response.json.client.name).toBe("claude.ai");
      expect(response.json.client.verifiedHost).toBeNull();
      expect(response.json.client.uri).toBe("https://claude.ai/");
    });

    it("says when the code will be handed to a program on the member's own machine", async () => {
      const native: RegisteredTestClient = await harness.register({
        redirect_uris: ["http://127.0.0.1/callback"],
      });

      const response: HttpResult = await harness.consent("details", {
        request: await ticketFor({
          clientId: native.clientId,
          redirectUri: "http://127.0.0.1:53211/callback",
        }),
      });

      expect(response.json.client.isLoopbackRedirect).toBe(true);
      expect(response.json.client.redirectTarget).toBe("127.0.0.1:53211");
    });

    it("names the app scheme for a desktop client", async () => {
      const desktop: RegisteredTestClient = await harness.register({
        redirect_uris: ["cursor://anysphere.cursor-retrieval/oauth/callback"],
      });

      const response: HttpResult = await harness.consent("details", {
        request: await ticketFor({
          clientId: desktop.clientId,
          redirectUri: "cursor://anysphere.cursor-retrieval/oauth/callback",
        }),
      });

      expect(response.json.client.isLoopbackRedirect).toBe(false);
      expect(response.json.client.redirectTarget).toBe(
        "cursor://anysphere.cursor-retrieval",
      );
    });

    it("lists the member's projects by name, each with whether it can be chosen", async () => {
      const zebra: TestProject = harness.addProject({ name: "Zebra" });
      const alpha: TestProject = harness.addProject({ name: "alpha" });
      const middle: TestProject = harness.addProject({ name: "Middle" });

      harness.addMembership(member, zebra);
      harness.addMembership(member, alpha);
      harness.addMembership(member, middle);

      // A project the member is not in never appears.
      harness.addProject({ name: "Somebody Else's" });

      const response: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(
        response.json.projects.map((listed: { name: string }): string => {
          return listed.name;
        }),
      ).toEqual(["Acme Production", "alpha", "Middle", "Zebra"]);
    });

    it("lists nothing for a member with no projects", async () => {
      const loner: TestMember = harness.addMember();

      harness.signIn(loner);

      const response: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(response.status).toBe(200);
      expect(response.json.projects).toEqual([]);
      expect(response.json.user.email).toBe(loner.email);
    });

    it("shows the session's own identity, not anything from the ticket", async () => {
      const other: TestMember = harness.addMember({
        email: "other@example.com",
        name: "Other Person",
      });

      harness.addMembership(other, project);
      harness.signIn(other);

      const response: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(response.json.user).toEqual({
        email: "other@example.com",
        name: "Other Person",
      });
    });
  });

  describe("which projects a client can be connected to", () => {
    async function eligibilityOf(
      target: TestProject,
    ): Promise<{ isEligible: boolean; refusal: string | null }> {
      const response: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(response.status).toBe(200);

      const listed:
        | { isEligible: boolean; refusal: string | null }
        | undefined = response.json.projects.find(
        (candidate: { id: string }): boolean => {
          return candidate.id === target.id.toString();
        },
      );

      expect(listed).toBeDefined();

      return { isEligible: listed!.isEligible, refusal: listed!.refusal };
    }

    async function approve(
      target: TestProject,
      access: string = "write",
    ): Promise<HttpResult> {
      return await harness.consent("approve", {
        request: ticket,
        projectId: target.id.toString(),
        access,
      });
    }

    describe("membership", () => {
      it("marks a project the session still lists but the member has left", async () => {
        const left: TestProject = harness.addProject({ name: "Left" });

        // The session predates the removal; the permission lookup does not.
        harness.signIn(member, { listedProjects: [project, left] });

        expect(await eligibilityOf(left)).toEqual({
          isEligible: false,
          refusal: "not-a-member",
        });
        expect(await eligibilityOf(project)).toEqual({
          isEligible: true,
          refusal: null,
        });
      });

      it("refuses an approval for a project the member is not in, and writes nothing", async () => {
        const foreign: TestProject = harness.addProject({ name: "Foreign" });

        const response: HttpResult = await approve(foreign);

        expect(response.status).toBe(422);
        expect(response.json.message).toBe(
          "You are not a member of this project.",
        );
        expectNothingWritten();
      });

      it("refuses an approval for a project that does not exist", async () => {
        const response: HttpResult = await harness.consent("approve", {
          request: ticket,
          projectId: ObjectID.generate().toString(),
          access: "write",
        });

        expect(response.status).toBe(422);
        expectNothingWritten();
      });
    });

    describe("the administrator's block", () => {
      beforeEach(() => {
        harness.blockFromConnectingClients(member, project);
      });

      it("marks the project", async () => {
        expect(await eligibilityOf(project)).toEqual({
          isEligible: false,
          refusal: "blocked",
        });
      });

      it("refuses the approval server-side, whatever the page sent", async () => {
        const response: HttpResult = await approve(project);

        expect(response.status).toBe(422);
        expect(response.json.message).toBe(
          "Your project administrator does not allow you to connect MCP clients to this project.",
        );
        expectNothingWritten();
      });

      it("applies to that project only", async () => {
        const other: TestProject = harness.addProject({ name: "Other" });

        harness.addMembership(member, other);

        expect((await eligibilityOf(other)).isEligible).toBe(true);
        expect((await approve(other)).status).toBe(200);
      });

      it("is reported ahead of a plan that would refuse as well", async () => {
        harness.setProjectPlan(project, PlanType.Free);

        expect((await eligibilityOf(project)).refusal).toBe("blocked");
      });
    });

    describe("the plan, where billing is on", () => {
      it.each([[PlanType.Growth], [PlanType.Scale], [PlanType.Enterprise]])(
        "allows a project on %s",
        async (plan: PlanType) => {
          harness.setProjectPlan(project, plan);

          expect(await eligibilityOf(project)).toEqual({
            isEligible: true,
            refusal: null,
          });
          expect((await approve(project)).status).toBe(200);
        },
      );

      it("marks a project on the Free plan, and refuses its approval with 402", async () => {
        harness.setProjectPlan(project, PlanType.Free);

        expect(await eligibilityOf(project)).toEqual({
          isEligible: false,
          refusal: "plan",
        });

        const response: HttpResult = await approve(project);

        expect(response.status).toBe(402);
        expect(response.json.message).toBe(
          "This project's plan does not include connecting MCP clients. Upgrade the project, or use a different project.",
        );
        expectNothingWritten();
      });

      it("marks a project whose subscription is unpaid", async () => {
        harness.setProjectPlan(project, PlanType.Growth, true);

        expect((await eligibilityOf(project)).refusal).toBe("plan");
        expect((await approve(project)).status).toBe(402);
        expectNothingWritten();
      });

      it("marks a project that has no plan yet", async () => {
        harness.setProjectPlan(project, "none");

        expect((await eligibilityOf(project)).refusal).toBe("plan");
        expect((await approve(project)).status).toBe(402);
        expectNothingWritten();
      });

      it("judges each project by its own plan", async () => {
        const free: TestProject = harness.addProject({
          name: "Hobby",
          plan: PlanType.Free,
        });

        harness.addMembership(member, free);

        expect((await eligibilityOf(free)).refusal).toBe("plan");
        expect((await eligibilityOf(project)).isEligible).toBe(true);
      });
    });

    describe("the plan, where billing is off", () => {
      beforeEach(() => {
        setBilling(false);
      });

      it.each<[string, PlanType | null | "none"]>([
        ["the Free plan", PlanType.Free],
        ["no plan information at all", null],
      ])(
        "allows a project with %s: a self-hosted instance has no plans",
        async (_label: string, plan: PlanType | null | "none") => {
          harness.setProjectPlan(project, plan);

          expect(await eligibilityOf(project)).toEqual({
            isEligible: true,
            refusal: null,
          });
          expect((await approve(project)).status).toBe(200);
          expect(harness.store.count("grant")).toBe(1);
        },
      );
    });

    describe("single sign-on", () => {
      const PROVIDER_A: ObjectID = new ObjectID(
        "11111111-1111-4111-8111-111111111111",
      );
      const PROVIDER_B: ObjectID = new ObjectID(
        "22222222-2222-4222-8222-222222222222",
      );

      it("marks a project that requires SSO when this browser has not signed in to it with SSO", async () => {
        harness.setProjectSso(project, { required: true });

        expect(await eligibilityOf(project)).toEqual({
          isEligible: false,
          refusal: "sso",
        });

        const response: HttpResult = await approve(project);

        expect(response.status).toBe(422);
        expect(response.json.message).toBe(
          "This project requires single sign-on. Sign in to it with SSO in this browser, then connect your MCP client again.",
        );
        expectNothingWritten();
      });

      it("allows it once the browser holds the project's SSO sign-in, and copies that sign-in onto the grant", async () => {
        harness.setProjectSso(project, { required: true });
        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, project, {
            ssoProviderId: PROVIDER_A,
            ssoProviderType: SsoProviderType.ProjectSSO,
          }),
        });

        expect(await eligibilityOf(project)).toEqual({
          isEligible: true,
          refusal: null,
        });
        expect((await approve(project)).status).toBe(200);

        const grant: StoreRow = harness.store.onlyGrant();

        expect(grant["ssoProviderType"]).toBe(SsoProviderType.ProjectSSO);
        expect(String(grant["ssoProviderId"])).toBe(PROVIDER_A.toString());

        // The evidence lapses when the SSO sign-in does: thirty days from now.
        const lapsesInMs: number =
          (grant["ssoExpiresAt"] as Date).getTime() - Date.now();

        expect(lapsesInMs).toBeGreaterThan(THIRTY_DAYS_IN_MS - 60_000);
        expect(lapsesInMs).toBeLessThanOrEqual(THIRTY_DAYS_IN_MS);
      });

      it("does not count an SSO sign-in that names no provider: the provider that gave it cannot be asked", async () => {
        harness.setProjectSso(project, { required: true });
        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, project, {
            ssoProviderId: null,
            ssoProviderType: null,
          }),
        });

        expect((await eligibilityOf(project)).refusal).toBe("sso");
        expect((await approve(project)).status).toBe(422);
        expectNothingWritten();
      });

      it("does not count an SSO sign-in whose provider has been turned off, nor once it is turned on again", async () => {
        harness.setProjectSso(project, { required: true });
        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, project, {
            ssoProviderId: PROVIDER_A,
            ssoProviderType: SsoProviderType.ProjectSSO,
          }),
        });

        harness.turnSsoProviderOff(PROVIDER_A);

        expect((await eligibilityOf(project)).refusal).toBe("sso");
        expect((await approve(project)).status).toBe(422);
        expectNothingWritten();

        // The sign-in was given before it was turned off.
        harness.turnSsoProviderOn(PROVIDER_A);

        expect((await eligibilityOf(project)).refusal).toBe("sso");
      });

      it("does not count an SSO sign-in whose provider has been deleted", async () => {
        harness.setProjectSso(project, { required: true });
        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, project, {
            ssoProviderId: PROVIDER_B,
            ssoProviderType: SsoProviderType.ProjectOIDC,
          }),
        });

        expect((await eligibilityOf(project)).isEligible).toBe(true);

        harness.deleteSsoProvider(PROVIDER_B);

        expect((await eligibilityOf(project)).refusal).toBe("sso");
        expect((await approve(project)).status).toBe(422);
        expectNothingWritten();
      });

      it("is not satisfied by another member's SSO sign-in", async () => {
        const colleague: TestMember = harness.addMember();

        harness.addMembership(colleague, project);
        harness.setProjectSso(project, { required: true });
        harness.signIn(member, {
          cookies: harness.projectSsoCookie(colleague, project),
        });

        expect((await eligibilityOf(project)).refusal).toBe("sso");
      });

      it("is not satisfied by an SSO sign-in to a different project", async () => {
        const other: TestProject = harness.addProject({ name: "Other" });

        harness.addMembership(member, other);
        harness.setProjectSso(project, { required: true });
        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, other),
        });

        expect((await eligibilityOf(project)).refusal).toBe("sso");
      });

      it("holds a project that pins one provider to that provider", async () => {
        harness.setProjectSso(project, {
          required: true,
          requiredSsoProviderId: PROVIDER_A,
        });

        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, project, {
            ssoProviderId: PROVIDER_B,
            ssoProviderType: SsoProviderType.ProjectSSO,
          }),
        });

        expect((await eligibilityOf(project)).refusal).toBe("sso");
        expect((await approve(project)).status).toBe(422);
        expectNothingWritten();

        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, project, {
            ssoProviderId: PROVIDER_A,
            ssoProviderType: SsoProviderType.ProjectSSO,
          }),
        });

        expect((await eligibilityOf(project)).isEligible).toBe(true);
      });

      it("copies no evidence onto a grant for a project that does not require SSO", async () => {
        harness.signIn(member, {
          cookies: harness.projectSsoCookie(member, project, {
            ssoProviderId: PROVIDER_A,
            ssoProviderType: SsoProviderType.ProjectSSO,
          }),
        });

        expect((await approve(project)).status).toBe(200);

        const grant: StoreRow = harness.store.onlyGrant();

        expect(grant["ssoProviderType"]).toBeUndefined();
        expect(grant["ssoProviderId"]).toBeUndefined();
        expect(grant["ssoExpiresAt"]).toBeUndefined();
      });

      it("applies an instance-wide SSO requirement to an ordinary member", async () => {
        harness.setGlobalSsoRequired(true);

        expect(await eligibilityOf(project)).toEqual({
          isEligible: false,
          refusal: "sso",
        });
      });

      it("exempts a master admin from the instance-wide requirement, but not from the project's own", async () => {
        const admin: TestMember = harness.addMember({ isMasterAdmin: true });

        harness.addMembership(admin, project);
        harness.setGlobalSsoRequired(true);
        harness.signIn(admin);

        expect((await eligibilityOf(project)).isEligible).toBe(true);

        harness.setProjectSso(project, { required: true });

        expect((await eligibilityOf(project)).refusal).toBe("sso");
      });

      it("accepts an instance-wide (Global) SSO sign-in whose provider is still trusted for the project", async () => {
        const trusted: jest.SpyInstance = jest
          .spyOn(UserMiddleware, "isGlobalSsoTokenAuthorizedForProject")
          .mockResolvedValue(true) as unknown as jest.SpyInstance;

        try {
          harness.setProjectSso(project, { required: true });
          harness.signIn(member, {
            cookies: harness.globalSsoCookie(member, {
              ssoProviderId: PROVIDER_A,
              ssoProviderType: SsoProviderType.GlobalSSO,
            }),
          });

          expect((await eligibilityOf(project)).isEligible).toBe(true);
          expect((await approve(project)).status).toBe(200);

          const grant: StoreRow = harness.store.onlyGrant();

          expect(grant["ssoProviderType"]).toBe(SsoProviderType.GlobalSSO);
          expect(String(grant["ssoProviderId"])).toBe(PROVIDER_A.toString());
          expect(grant["ssoExpiresAt"]).toBeInstanceOf(Date);
        } finally {
          trusted.mockRestore();
        }
      });

      it("refuses a Global SSO sign-in whose provider is no longer trusted for the project", async () => {
        const distrusted: jest.SpyInstance = jest
          .spyOn(UserMiddleware, "isGlobalSsoTokenAuthorizedForProject")
          .mockResolvedValue(false) as unknown as jest.SpyInstance;

        try {
          harness.setProjectSso(project, { required: true });
          harness.signIn(member, {
            cookies: harness.globalSsoCookie(member, {
              ssoProviderId: PROVIDER_A,
              ssoProviderType: SsoProviderType.GlobalSSO,
            }),
          });

          expect((await eligibilityOf(project)).refusal).toBe("sso");
          expect((await approve(project)).status).toBe(422);
          expectNothingWritten();
        } finally {
          distrusted.mockRestore();
        }
      });

      it("is asked after the plan: a Free project that also requires SSO says 'plan'", async () => {
        harness.setProjectPlan(project, PlanType.Free);
        harness.setProjectSso(project, { required: true });

        expect((await eligibilityOf(project)).refusal).toBe("plan");
      });
    });
  });

  describe("approve", () => {
    function approve(body: Record<string, unknown>): Promise<HttpResult> {
      return harness.consent("approve", {
        request: ticket,
        projectId: project.id.toString(),
        access: "write",
        ...body,
      });
    }

    it("answers with where to send the browser: the client's redirect URI, with a code, the state and the issuer", async () => {
      const response: HttpResult = await approve({});

      expect(response.status).toBe(200);
      expect(Object.keys(response.json)).toEqual(["redirectUrl"]);

      const redirectUrl: URL = new URL(response.json.redirectUrl);

      expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe(
        DEFAULT_REDIRECT_URI,
      );
      expect(Array.from(redirectUrl.searchParams.keys()).sort()).toEqual([
        "code",
        "iss",
        "state",
      ]);
      expect(redirectUrl.searchParams.get("state")).toBe("client-state");
      expect(redirectUrl.searchParams.get("iss")).toBe(harness.issuer);
      expect(
        McpOAuthSecret.isValidShape(
          redirectUrl.searchParams.get("code"),
          McpOAuthTokenType.AuthorizationCode,
        ),
      ).toBe(true);
    });

    it("leaves state out when the client sent none", async () => {
      const response: HttpResult = await approve({
        request: await ticketFor({ scope: "mcp:read mcp:write" }),
      });

      expect(new URL(response.json.redirectUrl).searchParams.has("state")).toBe(
        false,
      );
    });

    it("records a PENDING grant: approved, not yet collected, and gone in five minutes if it never is", async () => {
      const before: number = Date.now();

      await approve({});

      const grant: StoreRow = harness.store.onlyGrant();

      expect(String(grant["projectId"])).toBe(project.id.toString());
      expect(String(grant["userId"])).toBe(member.id.toString());
      expect(grant["clientId"]).toBe(client.clientId);
      expect(grant["name"]).toBe("Test MCP Client");
      expect(grant["scope"]).toBe("mcp:read mcp:write");
      expect(grant["resource"]).toBe(harness.resource);

      // Pending.
      expect(grant["activatedAt"]).toBeUndefined();
      expect(grant["lastUsedAt"]).toBeUndefined();

      const expiresInMs: number =
        (grant["expiresAt"] as Date).getTime() - before;

      expect(expiresInMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
      expect(expiresInMs).toBeLessThanOrEqual(5 * 60 * 1000 + 5000);
    });

    it("issues one authorization code, stored as a digest and bound to the ticket's challenge and redirect URI", async () => {
      const response: HttpResult = await approve({});
      const code: string = new URL(response.json.redirectUrl).searchParams.get(
        "code",
      )!;

      const grant: StoreRow = harness.store.onlyGrant();
      const tokens: Array<StoreRow> = harness.store.rows("token");

      expect(tokens).toHaveLength(1);

      const row: StoreRow = tokens[0]!;

      expect(row["tokenType"]).toBe(McpOAuthTokenType.AuthorizationCode);
      expect(row["tokenHash"]).toBe(McpOAuthSecret.hash(code));
      expect(String(row["mcpOAuthGrantId"])).toBe(String(grant["_id"]));
      expect(row["codeChallenge"]).toBe(CODE_CHALLENGE);
      expect(row["redirectUri"]).toBe(DEFAULT_REDIRECT_URI);
      expect(row["consumedAt"]).toBeUndefined();

      // The code and the pending grant lapse together.
      expect((row["expiresAt"] as Date).getTime()).toBe(
        (grant["expiresAt"] as Date).getTime(),
      );

      // The plaintext code is nowhere in what was stored.
      expect(JSON.stringify(harness.store.rows("token"))).not.toContain(code);
      expect(JSON.stringify(harness.store.rows("grant"))).not.toContain(code);
    });

    it("attributes the grant to the member who pressed Authorize, for the audit trail", async () => {
      await approve({});

      const creates: Array<StoreCall> = harness.store.callsTo(
        "grant",
        "create",
      );

      expect(creates).toHaveLength(1);

      const props: DatabaseCommonInteractionProps = creates[0]!.input[
        "props"
      ] as DatabaseCommonInteractionProps;

      expect(props.isRoot).toBe(true);
      expect(props.userId?.toString()).toBe(member.id.toString());
      expect(props.userType).toBe(UserType.User);
      expect(props.tenantId?.toString()).toBe(project.id.toString());
    });

    describe("the access the member chooses", () => {
      it("grants read and write when the client asked for it and the member allows it", async () => {
        await approve({ access: "write" });

        expect(harness.store.onlyGrant()["scope"]).toBe("mcp:read mcp:write");
      });

      it("grants read only when the member takes write away", async () => {
        await approve({ access: "read" });

        expect(harness.store.onlyGrant()["scope"]).toBe("mcp:read");
      });

      it("keeps offline_access beside whatever was chosen", async () => {
        await approve({
          request: await ticketFor({
            scope: "mcp:read mcp:write offline_access",
          }),
          access: "read",
        });

        expect(harness.store.onlyGrant()["scope"]).toBe(
          "mcp:read offline_access",
        );
      });

      it("grants read for a client that asked only to read", async () => {
        await approve({
          request: await ticketFor({ scope: "mcp:read" }),
          access: "read",
        });

        expect(harness.store.onlyGrant()["scope"]).toBe("mcp:read");
      });

      it("cannot widen: write for a client that asked only to read is refused, and nothing is written", async () => {
        const response: HttpResult = await approve({
          request: await ticketFor({ scope: "mcp:read" }),
          access: "write",
        });

        expect(response.status).toBe(400);
        expect(response.json.message).toBe(
          "This MCP client asked for read-only access, so that is all it can be given.",
        );
        expectNothingWritten();
      });

      it.each<[string, unknown]>([
        ["missing", undefined],
        ["something else", "admin"],
        ["a scope string", "mcp:read mcp:write"],
        ["a boolean", true],
      ])(
        "has to be chosen: %s is refused",
        async (_label: string, access: unknown) => {
          const body: Record<string, unknown> = { access };

          const response: HttpResult = await harness.consent("approve", {
            request: ticket,
            projectId: project.id.toString(),
            ...(access === undefined ? {} : body),
          });

          expect(response.status).toBe(400);
          expect(response.json.message).toBe(
            "Choose what the MCP client may do.",
          );
          expectNothingWritten();
        },
      );
    });

    describe("the project the member chooses", () => {
      it.each<[string, unknown]>([
        ["missing", undefined],
        ["not a UUID", "acme"],
        ["a list", ["a", "b"]],
        ["an object", { id: "x" }],
      ])(
        "has to be chosen: %s is refused",
        async (_label: string, projectId: unknown) => {
          const response: HttpResult = await harness.consent("approve", {
            request: ticket,
            access: "write",
            ...(projectId === undefined ? {} : { projectId }),
          });

          expect(response.status).toBe(400);
          expect(response.json.message).toBe("Choose a project to connect.");
          expectNothingWritten();
        },
      );

      it("is the only project the grant is for", async () => {
        const other: TestProject = harness.addProject({ name: "Other" });

        harness.addMembership(member, other);

        await approve({ projectId: other.id.toString() });

        expect(String(harness.store.onlyGrant()["projectId"])).toBe(
          other.id.toString(),
        );
      });
    });

    it("takes the client, the redirect URI, the challenge and the scope from the ticket and from nowhere else", async () => {
      const response: HttpResult = await approve({
        // None of these are things the page gets to decide.
        clientId: "00000000-0000-4000-8000-000000000000",
        redirectUri: "https://attacker.example/steal",
        redirect_uri: "https://attacker.example/steal",
        codeChallenge: "A".repeat(43),
        scope: "mcp:read mcp:write offline_access",
        userId: ObjectID.generate().toString(),
        resource: "https://attacker.example/mcp",
      });

      expect(response.status).toBe(200);
      expect(response.json.redirectUrl.startsWith(DEFAULT_REDIRECT_URI)).toBe(
        true,
      );

      const grant: StoreRow = harness.store.onlyGrant();

      expect(grant["clientId"]).toBe(client.clientId);
      expect(String(grant["userId"])).toBe(member.id.toString());
      expect(grant["scope"]).toBe("mcp:read mcp:write");
      expect(grant["resource"]).toBe(harness.resource);
      expect(harness.store.rows("token")[0]!["codeChallenge"]).toBe(
        CODE_CHALLENGE,
      );
      expect(harness.store.rows("token")[0]!["redirectUri"]).toBe(
        DEFAULT_REDIRECT_URI,
      );
    });

    it("is for whoever is signed in when it is pressed, not whoever opened the page", async () => {
      const colleague: TestMember = harness.addMember();

      harness.addMembership(colleague, project);
      harness.signIn(colleague);

      await approve({});

      expect(String(harness.store.onlyGrant()["userId"])).toBe(
        colleague.id.toString(),
      );
    });

    it("lets a master admin connect a client like anyone else, for a project they are a member of", async () => {
      const admin: TestMember = harness.addMember({ isMasterAdmin: true });

      harness.addMembership(admin, project);
      harness.signIn(admin);

      expect((await approve({})).status).toBe(200);
      expect(String(harness.store.onlyGrant()["userId"])).toBe(
        admin.id.toString(),
      );
    });

    it("does not let a master admin connect a client to a project they are not in", async () => {
      const admin: TestMember = harness.addMember({ isMasterAdmin: true });

      harness.signIn(admin);

      const response: HttpResult = await approve({});

      expect(response.status).toBe(422);
      expectNothingWritten();
    });

    it("sends the code back to the loopback port the client is listening on", async () => {
      const native: RegisteredTestClient = await harness.register({
        redirect_uris: ["http://127.0.0.1/callback"],
      });

      const response: HttpResult = await approve({
        request: await ticketFor({
          clientId: native.clientId,
          redirectUri: "http://127.0.0.1:53211/callback",
          scope: "mcp:read mcp:write",
        }),
      });

      const redirectUrl: URL = new URL(response.json.redirectUrl);

      expect(redirectUrl.origin).toBe("http://127.0.0.1:53211");
      expect(redirectUrl.pathname).toBe("/callback");
      expect(harness.store.rows("token")[0]!["redirectUri"]).toBe(
        "http://127.0.0.1:53211/callback",
      );
    });

    it("keeps a query the redirect URI already had", async () => {
      const withQuery: RegisteredTestClient = await harness.register({
        redirect_uris: ["https://client.example/callback?tenant=acme"],
      });

      const response: HttpResult = await approve({
        request: await ticketFor({
          clientId: withQuery.clientId,
          redirectUri: "https://client.example/callback?tenant=acme",
          scope: "mcp:read mcp:write",
        }),
      });

      const redirectUrl: URL = new URL(response.json.redirectUrl);

      expect(redirectUrl.searchParams.get("tenant")).toBe("acme");
      expect(redirectUrl.searchParams.get("code")).not.toBeNull();
    });

    describe("when it cannot be written", () => {
      const DATABASE_FAILURE: string =
        'connection to server at "db.internal" (10.0.0.5), port 5432 failed';

      // What the page is told, and that it is told nothing else.
      function expectOnlyThatItFailed(response: HttpResult): void {
        expect(response.status).toBe(500);
        expect(response.json).toEqual({ message: UNEXPECTED_FAILURE_MESSAGE });
        expect(response.text).not.toContain("db.internal");
        expect(response.text).not.toContain("10.0.0.5");
        expect("redirectUrl" in response.json).toBe(false);
      }

      function expectCauseLogged(): void {
        expect(logger.error as jest.Mock).toHaveBeenCalledWith(
          UNEXPECTED_FAILURE_LOG_LINE,
        );
        expect(logger.error as jest.Mock).toHaveBeenCalledWith(
          expect.objectContaining({ message: DATABASE_FAILURE }),
        );
      }

      it("says only that it failed, and leaves nothing behind, when the grant cannot be written", async () => {
        harness.store.intercept("grant", "create", (): void => {
          throw new Error(DATABASE_FAILURE);
        });

        const response: HttpResult = await approve({});

        expectOnlyThatItFailed(response);
        expectCauseLogged();
        expectNothingWritten();
      });

      it("takes back the approval it had recorded when the code cannot be written", async () => {
        harness.store.intercept("token", "create", (): void => {
          throw new Error(DATABASE_FAILURE);
        });

        const response: HttpResult = await approve({});

        expectOnlyThatItFailed(response);
        expectCauseLogged();

        /*
         * The grant was written before the code failed. Nobody was handed a
         * code for it, so it can never be collected: it is removed, not left
         * to sit in the list of what this member approved until it lapses.
         */
        expect(harness.store.callsTo("grant", "create")).toHaveLength(1);
        expectNothingWritten();
      });

      it("removes that approval as the server, not as the member: nobody disconnected anything", async () => {
        harness.store.intercept("token", "create", (): void => {
          throw new Error(DATABASE_FAILURE);
        });

        await approve({});

        const removals: Array<StoreCall> = harness.store.callsTo(
          "grant",
          "deleteOneBy",
        );

        expect(removals).toHaveLength(1);
        expect(removals[0]!.input["props"]).toEqual({ isRoot: true });
      });

      it("still says only that it failed when the approval cannot be taken back either", async () => {
        harness.store.intercept("token", "create", (): void => {
          throw new Error(DATABASE_FAILURE);
        });
        harness.store.intercept("grant", "deleteOneBy", (): void => {
          throw new Error("the database is still away");
        });

        const response: HttpResult = await approve({});

        // The first failure is the one reported; the clean-up's is not.
        expectOnlyThatItFailed(response);
        expectCauseLogged();
        expect(response.text).not.toContain("still away");
        expect(harness.store.count("token")).toBe(0);

        // What is left never became a connection, and lapses in five minutes.
        const left: Array<StoreRow> = harness.store.grants();

        expect(left).toHaveLength(1);
        expect(left[0]!["activatedAt"]).toBeUndefined();
      });

      it("can be approved again once the database is back", async () => {
        harness.store.intercept("token", "create", (): void => {
          throw new Error(DATABASE_FAILURE);
        });

        expect((await approve({})).status).toBe(500);

        harness.store.clearInterceptors();

        const response: HttpResult = await approve({});

        expect(response.status).toBe(200);
        expect(harness.store.count("grant")).toBe(1);
        expect(harness.store.count("token")).toBe(1);
      });
    });
  });

  describe("a failure nobody chose the wording of", () => {
    /*
     * The three steps answer through one place. What they decide to say - a
     * ticket has expired, a plan does not allow it - is said as it is.
     * Anything else is a fault whose message can describe the inside of the
     * server; it goes to the log, and the page is told only that it failed.
     */
    it("is not what details shows when the member's projects cannot be read", async () => {
      const cause: Error = new Error(
        'relation "Project" does not exist at db.internal',
      );

      (
        jest.spyOn(ProjectService, "findBy") as unknown as jest.SpyInstance
      ).mockImplementationOnce(async (): Promise<never> => {
        throw cause;
      });

      const response: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(response.status).toBe(500);
      expect(response.json).toEqual({ message: UNEXPECTED_FAILURE_MESSAGE });
      expect(response.text).not.toContain("db.internal");
      expect(logger.error as jest.Mock).toHaveBeenCalledWith(
        UNEXPECTED_FAILURE_LOG_LINE,
      );
      expect(logger.error as jest.Mock).toHaveBeenCalledWith(cause);
    });

    it("is not what deny shows when a bug throws in it", async () => {
      const cause: TypeError = new TypeError(
        "Cannot read properties of undefined (reading 'redirectUri')",
      );

      const spy: jest.SpyInstance = jest
        .spyOn(AuthorizationRequest, "buildErrorRedirect")
        .mockImplementationOnce((): never => {
          throw cause;
        }) as unknown as jest.SpyInstance;

      try {
        const response: HttpResult = await harness.consent("deny", {
          request: ticket,
        });

        expect(response.status).toBe(500);
        expect(response.json).toEqual({ message: UNEXPECTED_FAILURE_MESSAGE });
        expect(response.text).not.toContain("redirectUri");
        expect(logger.error as jest.Mock).toHaveBeenCalledWith(cause);
      } finally {
        spy.mockRestore();
      }
    });

    it.each<[ConsentStep]>([["details"], ["approve"], ["deny"]])(
      "is not confused with what %s decides to say: an expired ticket is still told as it is",
      async (step: ConsentStep) => {
        const response: HttpResult = await harness.consent(
          step,
          bodyFor(step, "not-a-ticket"),
        );

        expect(response.status).toBe(400);
        expect(response.json.message).toBe(EXPIRED_MESSAGE);
        expect(logger.error as jest.Mock).not.toHaveBeenCalledWith(
          UNEXPECTED_FAILURE_LOG_LINE,
        );
      },
    );

    it("works again on the next request: one failure poisons nothing", async () => {
      (
        jest.spyOn(ProjectService, "findBy") as unknown as jest.SpyInstance
      ).mockImplementationOnce(async (): Promise<never> => {
        throw new Error("connection terminated unexpectedly");
      });

      expect(
        (await harness.consent("details", { request: ticket })).status,
      ).toBe(500);

      const response: HttpResult = await harness.consent("details", {
        request: ticket,
      });

      expect(response.status).toBe(200);
      expect(response.json.projects).toHaveLength(1);
    });
  });

  describe("deny", () => {
    it("answers with the client's redirect URI carrying access_denied, the state and the issuer", async () => {
      const response: HttpResult = await harness.consent("deny", {
        request: ticket,
      });

      expect(response.status).toBe(200);
      expect(Object.keys(response.json)).toEqual(["redirectUrl"]);

      const redirectUrl: URL = new URL(response.json.redirectUrl);

      expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe(
        DEFAULT_REDIRECT_URI,
      );
      expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
      expect(redirectUrl.searchParams.get("error_description")).toBe(
        "The request was denied.",
      );
      expect(redirectUrl.searchParams.get("state")).toBe("client-state");
      expect(redirectUrl.searchParams.get("iss")).toBe(harness.issuer);
      expect(redirectUrl.searchParams.get("code")).toBeNull();
    });

    it("writes nothing", async () => {
      await harness.consent("deny", { request: ticket });

      expectNothingWritten();
    });

    it("needs no project: a member who can connect nothing can still say no", async () => {
      const loner: TestMember = harness.addMember();

      harness.signIn(loner);

      const response: HttpResult = await harness.consent("deny", {
        request: ticket,
      });

      expect(response.status).toBe(200);
      expect(new URL(response.json.redirectUrl).searchParams.get("error")).toBe(
        "access_denied",
      );
    });

    it("leaves state out when the client sent none", async () => {
      const response: HttpResult = await harness.consent("deny", {
        request: await ticketFor({}),
      });

      expect(new URL(response.json.redirectUrl).searchParams.has("state")).toBe(
        false,
      );
    });
  });
});
