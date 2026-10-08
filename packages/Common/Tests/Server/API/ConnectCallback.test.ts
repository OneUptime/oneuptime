import ConnectCallback, {
  ConnectCallbackFinish,
  ConnectCallbackRefusal,
  ConnectCallbackSpec,
} from "../../../Server/API/ConnectCallback";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import CallerPlan from "../../../Server/Utils/Billing/CallerPlan";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import {
  ConnectCallbackError,
  ConnectProvider,
  ConnectStartPage,
} from "../../../Types/Workspace/ConnectCallback";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * HOW A CONNECT CALLBACK ANSWERS (ConnectCallback).
 *
 * Every Slack, Microsoft Teams and GitHub connect callback is registered
 * through ConnectCallback.route, which spends the state, asks the start's
 * question again and finishes - and answers every way that can end with a
 * redirect to the page the connection started from, telling it a code:
 *
 *  - a refusal is its own code; anything else - an Exception that is not a
 *    refusal, an HTTPErrorResponse, something that is not even an Error - is
 *    "could not finish", and what it said is logged, never sent;
 *  - with no state that can be spent, no project can be trusted, so the
 *    browser goes to the Dashboard's connect-return page instead;
 *  - the handler never throws and always answers, once.
 *
 * Tests/Server/API/ConnectCallbacksAnswer drives the real callbacks.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("6c000000-0000-4000-8000-0000000000e1");

function pageOf(path: string): string {
  return `${DashboardClientUrl.toString()}/${PROJECT_ID.toString()}${path}`;
}

function connectReturn(provider: string): string {
  return `${DashboardClientUrl.toString()}/connect-return?provider=${provider}`;
}

function record(
  extra: Partial<WorkspaceOAuthStateRecord> = {},
): WorkspaceOAuthStateRecord {
  return {
    flow: WorkspaceOAuthFlow.SlackInstall,
    projectId: PROJECT_ID,
    userId: USER_ID,
    startPage: ConnectStartPage.ProjectSettings,
    ...extra,
  };
}

interface FakeResponse {
  headersSent: boolean;
  redirectedTo: Array<string>;
  statusCode: number | null;
  sent: Array<unknown>;
  failRedirect: boolean;
}

function fakeResponse(): { res: ExpressResponse; probe: FakeResponse } {
  const probe: FakeResponse = {
    headersSent: false,
    redirectedTo: [],
    statusCode: null,
    sent: [],
    failRedirect: false,
  };

  const res: Record<string, unknown> = {
    redirect: (url: string): void => {
      if (probe.failRedirect) {
        throw new Error("upstream-redirect-failure");
      }

      probe.redirectedTo.push(url);
      probe.headersSent = true;
    },
    status: (code: number): unknown => {
      probe.statusCode = code;
      return res;
    },
    send: (body: unknown): void => {
      probe.sent.push(body);
      probe.headersSent = true;
    },
  };

  Object.defineProperty(res, "headersSent", {
    get: (): boolean => {
      return probe.headersSent;
    },
  });

  return { res: res as unknown as ExpressResponse, probe };
}

function fakeRequest(query: Record<string, string> = {}): ExpressRequest {
  return {
    query: query,
    params: {},
    headers: {},
    cookies: {},
  } as unknown as ExpressRequest;
}

// A spec whose every step does nothing unless a test says otherwise.
function spec(
  overrides: Partial<ConnectCallbackSpec> = {},
): ConnectCallbackSpec {
  return {
    provider: ConnectProvider.Slack,
    spendState: async (): Promise<WorkspaceOAuthStateRecord | null> => {
      return record();
    },
    askAgain: async (): Promise<void> => {
      return undefined;
    },
    refusedAs: ConnectCallbackError.NoPermission,
    finish: async (data: ConnectCallbackFinish): Promise<void> => {
      data.backToPage();
    },
    ...overrides,
  };
}

async function run(
  callbackSpec: ConnectCallbackSpec,
  query: Record<string, string> = {},
): Promise<FakeResponse> {
  const { res, probe } = fakeResponse();

  await expect(
    ConnectCallback.route(callbackSpec)(fakeRequest(query), res),
  ).resolves.toBeUndefined();

  return probe;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("codeFor: what the page is told", () => {
  test("a refusal is told its own code", () => {
    for (const code of Object.values(ConnectCallbackError)) {
      expect(
        ConnectCallback.codeFor(new ConnectCallbackRefusal(code, "why")),
      ).toBe(code);
    }
  });

  test.each([
    ["an Exception that is not a refusal", new BadDataException("upstream")],
    ["an Error", new Error("upstream")],
    ["an HTTPErrorResponse", new HTTPErrorResponse(502, { error: "x" }, {})],
    ["a string", "upstream"],
    ["an object", { detail: "upstream" }],
    ["nothing", undefined],
  ])("%s is told could-not-finish", (_label: string, error: unknown) => {
    expect(ConnectCallback.codeFor(error)).toBe(
      ConnectCallbackError.CouldNotFinish,
    );
  });
});

describe("refusalOfQuestion: the start's question, refused", () => {
  test("a plan refusal is the plan", () => {
    const refusal: unknown = ConnectCallback.refusalOfQuestion(
      new PaymentRequiredException("Please upgrade your plan to Growth"),
      ConnectCallbackError.NoPermission,
    );

    expect(ConnectCallback.codeFor(refusal)).toBe(
      ConnectCallbackError.PlanRequired,
    );
  });

  test.each([
    ConnectCallbackError.NoPermission,
    ConnectCallbackError.NotAMember,
  ])("any other authorization refusal is the callback's own: %s", (code) => {
    const refusal: unknown = ConnectCallback.refusalOfQuestion(
      new NotAuthorizedException("You may not."),
      code,
    );

    expect(ConnectCallback.codeFor(refusal)).toBe(code);
  });

  test("a plan that could not be read is no refusal of the person", () => {
    const unknownPlan: NotAuthorizedException = new NotAuthorizedException(
      CallerPlan.PLAN_UNKNOWN_MESSAGE,
    );

    const answer: unknown = ConnectCallback.refusalOfQuestion(
      unknownPlan,
      ConnectCallbackError.NoPermission,
    );

    expect(answer).toBe(unknownPlan);
    expect(ConnectCallback.codeFor(answer)).toBe(
      ConnectCallbackError.CouldNotFinish,
    );
  });

  test("a read that failed is not a refusal at all", () => {
    const failure: Error = new Error('relation "TeamMember" does not exist');

    expect(
      ConnectCallback.refusalOfQuestion(
        failure,
        ConnectCallbackError.NoPermission,
      ),
    ).toBe(failure);
  });
});

describe("refusalOfProviderError: what the provider said", () => {
  test("nothing said is no refusal", () => {
    expect(ConnectCallback.refusalOfProviderError(fakeRequest())).toBeNull();
  });

  test("access_denied - cancelled, or not allowed - is cancelled", () => {
    const refusal: ConnectCallbackRefusal | null =
      ConnectCallback.refusalOfProviderError(
        fakeRequest({ error: "access_denied" }),
      );

    expect(refusal?.code).toBe(ConnectCallbackError.Cancelled);
  });

  test("anything else is could-not-finish, its words kept for the log only", () => {
    const refusal: ConnectCallbackRefusal | null =
      ConnectCallback.refusalOfProviderError(
        fakeRequest({
          error: "invalid_request",
          error_description: "AADSTS90014: a field is missing",
        }),
      );

    expect(refusal?.code).toBe(ConnectCallbackError.CouldNotFinish);
    expect(refusal?.message).toContain("AADSTS90014");
  });
});

describe("the page a connection goes back to", () => {
  test.each([
    [
      ConnectProvider.Slack,
      ConnectStartPage.ProjectSettings,
      "/settings/slack-integration",
    ],
    [
      ConnectProvider.Slack,
      ConnectStartPage.UserSettings,
      "/user-settings/slack-integration",
    ],
    [
      ConnectProvider.MicrosoftTeams,
      ConnectStartPage.ProjectSettings,
      "/settings/microsoft-teams-integration",
    ],
    [
      ConnectProvider.MicrosoftTeams,
      ConnectStartPage.UserSettings,
      "/user-settings/microsoft-teams-integration",
    ],
    [
      ConnectProvider.GitHub,
      ConnectStartPage.ProjectSettings,
      "/code-repository",
    ],
    [ConnectProvider.GitHub, ConnectStartPage.UserSettings, "/code-repository"],
  ])(
    "%s started on %s goes back to %s",
    (provider: ConnectProvider, startPage: ConnectStartPage, path: string) => {
      expect(
        ConnectCallback.getPageUrl({
          provider: provider,
          record: record({ startPage: startPage }),
        }).toString(),
      ).toBe(pageOf(path));
    },
  );

  test.each(Object.values(ConnectProvider))(
    "with no project to trust, %s goes to the Dashboard's connect-return page",
    (provider: ConnectProvider) => {
      expect(ConnectCallback.getConnectReturnUrl(provider).toString()).toBe(
        connectReturn(provider),
      );
    },
  );
});

describe("route: one order, and every ending answered once", () => {
  test("connected: back to the page, with what finish adds, each value encoded", async () => {
    const probe: FakeResponse = await run(
      spec({
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          data.backToPage({ installation_id: "42&error=x" });
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      `${pageOf("/settings/slack-integration")}?installation_id=42%26error%3Dx`,
    ]);
  });

  test("the page is the one the state's start page names", async () => {
    const probe: FakeResponse = await run(
      spec({
        spendState: async (): Promise<WorkspaceOAuthStateRecord | null> => {
          return record({ startPage: ConnectStartPage.UserSettings });
        },
        askAgain: async (): Promise<void> => {
          throw new NotAuthorizedException("no");
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      `${pageOf("/user-settings/slack-integration")}?error=no-permission`,
    ]);
  });

  test("a state that cannot be spent: the Dashboard, told link-invalid, and nothing else runs", async () => {
    let asked: boolean = false;
    let finished: boolean = false;

    const probe: FakeResponse = await run(
      spec({
        spendState: async (): Promise<WorkspaceOAuthStateRecord | null> => {
          return null;
        },
        askAgain: async (): Promise<void> => {
          asked = true;
        },
        finish: async (): Promise<void> => {
          finished = true;
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      `${connectReturn("slack")}&error=link-invalid`,
    ]);
    expect(asked).toBe(false);
    expect(finished).toBe(false);
  });

  test("a state that cannot even be read: the Dashboard, told could-not-finish", async () => {
    const probe: FakeResponse = await run(
      spec({
        provider: ConnectProvider.MicrosoftTeams,
        spendState: async (): Promise<WorkspaceOAuthStateRecord | null> => {
          throw { code: "ECONNRESET", detail: "upstream-cache-detail" };
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      `${connectReturn("microsoft-teams")}&error=could-not-finish`,
    ]);
    expect(JSON.stringify(probe)).not.toContain("upstream-cache-detail");
    expect(logger.error).toHaveBeenCalled();
  });

  test("the question refused: the page, told the callback's own code, and nothing is finished", async () => {
    let finished: boolean = false;

    const probe: FakeResponse = await run(
      spec({
        refusedAs: ConnectCallbackError.NotAMember,
        askAgain: async (): Promise<void> => {
          throw new NotAuthorizedException("You are not a member.");
        },
        finish: async (): Promise<void> => {
          finished = true;
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      `${pageOf("/settings/slack-integration")}?error=not-a-member`,
    ]);
    expect(finished).toBe(false);
  });

  test("the plan refused: the page, told plan-required", async () => {
    const probe: FakeResponse = await run(
      spec({
        provider: ConnectProvider.GitHub,
        askAgain: async (): Promise<void> => {
          throw new PaymentRequiredException("Please upgrade your plan");
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      `${pageOf("/code-repository")}?error=plan-required`,
    ]);
  });

  test("anything finish throws - not even an Error - is answered on the page as could-not-finish", async () => {
    for (const thrown of [
      new Error("upstream-error-text"),
      new BadDataException("upstream-exception-text"),
      new HTTPErrorResponse(500, { error: "upstream-http-text" }, {}),
      "upstream-string-text",
      undefined,
    ]) {
      const probe: FakeResponse = await run(
        spec({
          finish: async (): Promise<void> => {
            throw thrown;
          },
        }),
      );

      expect(probe.redirectedTo).toEqual([
        `${pageOf("/settings/slack-integration")}?error=could-not-finish`,
      ]);
      expect(probe.redirectedTo[0]).not.toContain("upstream");
    }
  });

  test("a refusal finish throws is answered with its code, its reason logged only", async () => {
    const probe: FakeResponse = await run(
      spec({
        finish: async (): Promise<void> => {
          throw new ConnectCallbackRefusal(
            ConnectCallbackError.SlackOtherWorkspace,
            "upstream-team-T999",
          );
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      `${pageOf("/settings/slack-integration")}?error=slack-other-workspace`,
    ]);
    expect(probe.redirectedTo[0]).not.toContain("T999");
    expect(logger.info).toHaveBeenCalled();
  });

  test("an answer already on its way is never answered twice", async () => {
    const probe: FakeResponse = await run(
      spec({
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          data.backToPage();
          throw new Error("after the answer");
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([
      pageOf("/settings/slack-integration"),
    ]);
    expect(probe.sent).toEqual([]);
  });

  test("should even the redirect fail, a plain sentence answers", async () => {
    const { res, probe } = fakeResponse();
    probe.failRedirect = true;

    await expect(
      ConnectCallback.route(
        spec({
          askAgain: async (): Promise<void> => {
            throw new NotAuthorizedException("no");
          },
        }),
      )(fakeRequest(), res),
    ).resolves.toBeUndefined();

    expect(probe.statusCode).toBe(500);
    expect(probe.sent).toEqual([
      { message: "OneUptime could not finish connecting. Please try again." },
    ]);
  });

  test("a provider's own redirect asks for nothing: the provider's page, with nothing to refuse", async () => {
    let spent: boolean = false;

    const probe: FakeResponse = await run(
      spec({
        provider: ConnectProvider.GitHub,
        isProviderRedirect: (): boolean => {
          return true;
        },
        spendState: async (): Promise<WorkspaceOAuthStateRecord | null> => {
          spent = true;
          return null;
        },
      }),
    );

    expect(probe.redirectedTo).toEqual([connectReturn("github")]);
    expect(spent).toBe(false);
  });

  test("the order: the state, then the question, then finishing", async () => {
    const order: Array<string> = [];

    await run(
      spec({
        spendState: async (): Promise<WorkspaceOAuthStateRecord | null> => {
          order.push("spend");
          return record();
        },
        askAgain: async (): Promise<void> => {
          order.push("ask");
        },
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          order.push("finish");
          data.backToPage();
        },
      }),
    );

    expect(order).toEqual(["spend", "ask", "finish"]);
  });
});
