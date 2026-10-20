import { describe, expect, test } from "@jest/globals";
import GraphCopilotClient, {
  GraphPerson,
} from "../../../../Server/Utils/LlmObservability/Connectors/Microsoft365Copilot/GraphCopilotClient";
import Microsoft365CopilotConnector, {
  MICROSOFT_365_COPILOT_MODEL,
} from "../../../../Server/Utils/LlmObservability/Connectors/Microsoft365Copilot/Microsoft365CopilotConnector";
import {
  LlmChatFetchOptions,
  LlmChatFetchResult,
  LlmConnectionSettings,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmChatPartType,
  LlmChatRole,
  LlmChatTurn,
} from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  FakeProviderApi,
  FakeRoute,
  createFakeProviderApi,
  everythingSent,
  json,
  queryValues,
  sequence,
} from "./FakeProviderApi";

/*
 * The Microsoft 365 Copilot connection against fake Entra ID and Microsoft
 * Graph endpoints: the app's sign-in for Graph, the people read (the whole
 * tenant or one group, enabled accounts only, pages followed on the Graph
 * host only), each person's Copilot interactions in one window, prompts and
 * answers paired by requestId into turns (HTML and plain text read as text,
 * adaptive card answers, files named but never read), the window resumed
 * person by person when a read reaches its budget, and a test that counts
 * without returning anything anyone wrote.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const GROUP: string = "f0e1d2c3-b4a5-4697-8899-aabbccddeeff";
const SECRET: string = "copilot~secret~value~for~tests~5678";
const TOKEN: string = "eyJ0eXAiOiJKV1QifQ.eyJhdWQiOiJncmFwaCJ9.c2lnbmF0dXJl";
const NOW: Date = new Date("2026-10-19T12:00:00Z");
const BACKFILL_START: Date = new Date("2026-10-12T12:00:00Z");
const WINDOW_END: Date = new Date("2026-10-19T11:55:00Z");

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.Microsoft365Copilot,
  config: { tenantId: TENANT, clientId: CLIENT, cloud: "public" },
  secrets: { clientSecret: SECRET },
};

const USERS: Array<JSONObject> = [
  {
    id: "u-2",
    mail: "bob@contoso.com",
    displayName: "Bob",
    accountEnabled: true,
  },
  {
    id: "u-1",
    mail: null,
    userPrincipalName: "ana@contoso.onmicrosoft.com",
    displayName: "Ana",
    accountEnabled: true,
  },
  {
    id: "u-3",
    mail: "gone@contoso.com",
    displayName: "Gone",
    accountEnabled: false,
  },
];

function interaction(data: {
  id: string;
  requestId: string;
  sessionId: string;
  app: string;
  prompt: boolean;
  at: string;
  body: JSONObject;
  extra?: JSONObject;
}): JSONObject {
  return {
    id: data.id,
    sessionId: data.sessionId,
    requestId: data.requestId,
    appClass: `IPM.SkypeTeams.Message.Copilot.${data.app}`,
    interactionType: data.prompt ? "userPrompt" : "aiResponse",
    createdDateTime: data.at,
    locale: "en-us",
    body: data.body,
    attachments: [],
    links: [],
    mentions: [],
    from: data.prompt
      ? { user: { id: "u-1", displayName: "Ana" } }
      : { application: { id: "copilot", displayName: "Microsoft 365 Chat" } },
    ...(data.extra || {}),
  };
}

const CARD: JSONObject = {
  type: "AdaptiveCard",
  body: [
    { type: "TextBlock", text: "Copilot" },
    {
      type: "Container",
      items: [
        {
          type: "TextBlock",
          id: "MessageTextField",
          text: "You have 3 meetings today.",
        },
        { type: "TextBlock", text: "AI-generated content may be incorrect" },
      ],
    },
  ],
};

const ANA_INTERACTIONS: Array<JSONObject> = [
  interaction({
    id: "i1",
    requestId: "r1",
    sessionId: "s1",
    app: "Word",
    prompt: true,
    at: "2026-10-19T09:00:00Z",
    body: { contentType: "text", content: "Is latency < 200ms in the report?" },
  }),
  interaction({
    id: "i2",
    requestId: "r1",
    sessionId: "s1",
    app: "Word",
    prompt: false,
    at: "2026-10-19T09:00:05Z",
    body: {
      contentType: "html",
      content:
        "<p>Yes &amp; it is <b>180ms</b>.</p>\n<p>See the table.</p><script>x()</script>",
    },
    extra: {
      links: [
        {
          displayName: "Q3 report.docx",
          linkUrl: "https://contoso.sharepoint.com/q3.docx",
        },
      ],
    },
  }),
  interaction({
    id: "i3",
    requestId: "r2",
    sessionId: "s2",
    app: "BizChat",
    prompt: true,
    at: "2026-10-19T09:10:00Z",
    body: { contentType: "text", content: "What is on my calendar?" },
  }),
  interaction({
    id: "i4",
    requestId: "r2",
    sessionId: "s2",
    app: "BizChat",
    prompt: false,
    at: "2026-10-19T09:10:07Z",
    body: {
      contentType: "html",
      content: '<attachment id="card-1"></attachment>',
    },
    extra: {
      attachments: [
        {
          attachmentId: "card-1",
          contentType: "application/vnd.microsoft.card.adaptive",
          content: JSON.stringify(CARD),
        },
      ],
    },
  }),
  // A prompt still waiting for its answer, asked 10 minutes ago.
  interaction({
    id: "i5",
    requestId: "r3",
    sessionId: "s2",
    app: "BizChat",
    prompt: true,
    at: "2026-10-19T11:50:00Z",
    body: { contentType: "text", content: "And tomorrow?" },
  }),
];

const BOB_INTERACTIONS: Array<JSONObject> = [
  interaction({
    id: "b1",
    requestId: "rb",
    sessionId: "sb",
    app: "Teams",
    prompt: true,
    at: "2026-10-18T15:00:00Z",
    body: { contentType: "text", content: "Summarize this meeting" },
  }),
  interaction({
    id: "b2",
    requestId: "rb",
    sessionId: "sb",
    app: "Teams",
    prompt: false,
    at: "2026-10-18T15:00:09Z",
    body: {
      contentType: "html",
      content: "<div>The team agreed to ship Friday.</div>",
    },
  }),
];

function routes(
  overrides: Partial<Record<string, FakeRoute["respond"]>> = {},
): Array<FakeRoute> {
  return [
    {
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond:
        overrides["token"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({
            token_type: "Bearer",
            expires_in: 3599,
            access_token: TOKEN,
          });
        }),
    },
    {
      path: "/v1.0/users",
      respond:
        overrides["users"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({ value: USERS });
        }),
    },
    {
      path: `/v1.0/groups/${GROUP}/transitiveMembers/microsoft.graph.user`,
      respond:
        overrides["group"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({ value: [USERS[0]] });
        }),
    },
    {
      path: "/v1.0/copilot/users/u-1/interactionHistory/getAllEnterpriseInteractions",
      respond:
        overrides["ana"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({ value: ANA_INTERACTIONS });
        }),
    },
    {
      path: "/v1.0/copilot/users/u-2/interactionHistory/getAllEnterpriseInteractions",
      respond:
        overrides["bob"] ||
        ((): ReturnType<FakeRoute["respond"]> => {
          return json({ value: BOB_INTERACTIONS });
        }),
    },
  ];
}

const ANA_PATH: string =
  "/v1.0/copilot/users/u-1/interactionHistory/getAllEnterpriseInteractions";
const BOB_PATH: string =
  "/v1.0/copilot/users/u-2/interactionHistory/getAllEnterpriseInteractions";

function options(
  api: FakeProviderApi,
  overrides: Partial<LlmChatFetchOptions> = {},
): LlmChatFetchOptions {
  return {
    transport: api.transport,
    now: (): Date => {
      return NOW;
    },
    state: {},
    backfillStart: BACKFILL_START,
    windowEnd: WINDOW_END,
    maxRequests: 400,
    maxDurationMs: 60000,
    ...overrides,
  };
}

function client(
  api: FakeProviderApi,
  cloud: "public" | "usgov" = "public",
): GraphCopilotClient {
  return new GraphCopilotClient({
    tenantId: TENANT,
    clientId: CLIENT,
    clientSecret: SECRET,
    cloud,
    transport: api.transport,
  });
}

function turnIds(turns: Array<LlmChatTurn>): Array<string> {
  return turns.map((turn: LlmChatTurn) => {
    return turn.turnId;
  });
}

const ANA: GraphPerson = {
  id: "u-1",
  email: "ana@contoso.onmicrosoft.com",
  name: "Ana",
};

describe("GraphCopilotClient", () => {
  test("signs in once for Graph and sends the token, never the secret, to Graph", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());
    const graph: GraphCopilotClient = client(api);

    await graph.listPeople("");
    await graph.listInteractions({
      userId: "u-1",
      startTime: BACKFILL_START,
      endTime: WINDOW_END,
    });

    const tokenRequests: Array<DataSourceHttpRequest> = api.requestsTo(
      `/${TENANT}/oauth2/v2.0/token`,
    );
    expect(tokenRequests).toHaveLength(1);
    expect(new URL(tokenRequests[0]!.url).host).toBe(
      "login.microsoftonline.com",
    );
    expect(tokenRequests[0]!.body).toMatchObject({
      grant_type: "client_credentials",
      client_id: CLIENT,
      scope: "https://graph.microsoft.com/.default",
    });

    const graphRequests: Array<DataSourceHttpRequest> = api.requests.filter(
      (request: DataSourceHttpRequest) => {
        return request !== tokenRequests[0];
      },
    );
    expect(graphRequests).toHaveLength(2);

    for (const request of graphRequests) {
      expect(new URL(request.url).host).toBe("graph.microsoft.com");
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${TOKEN}`);
      expect(everythingSent(request)).not.toContain(SECRET);
    }

    expect(graph.getRequestCount()).toBe(3);
  });

  test("the whole tenant's enabled people, by id, with their email or sign-in name", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const people: Array<GraphPerson> = await client(api).listPeople("");

    expect(people).toEqual([
      { id: "u-1", email: "ana@contoso.onmicrosoft.com", name: "Ana" },
      { id: "u-2", email: "bob@contoso.com", name: "Bob" },
    ]);

    const request: DataSourceHttpRequest = api.requestsTo("/v1.0/users")[0]!;
    expect(queryValues(request, "$select")).toEqual([
      "id,mail,userPrincipalName,displayName,accountEnabled",
    ]);
    expect(queryValues(request, "$top")).toEqual(["999"]);
  });

  test("one group's people, nested groups included", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const people: Array<GraphPerson> = await client(api).listPeople(GROUP);

    expect(
      people.map((person: GraphPerson) => {
        return person.id;
      }),
    ).toEqual(["u-2"]);
    expect(api.requestsTo("/v1.0/users")).toHaveLength(0);
  });

  test("a group that is not a GUID is refused before anything is sent", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await expect(client(api).listPeople("../users")).rejects.toThrow(
      BadDataException,
    );
    expect(api.requests).toHaveLength(0);
  });

  test("pages are followed on the Graph host, and never to another host", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        users: sequence([
          json({
            value: [USERS[0]],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/users?$skiptoken=page2",
          }),
          json({
            value: [USERS[1]],
            "@odata.nextLink":
              "https://attacker.example.com/v1.0/users?$skiptoken=page3",
          }),
        ]),
      }),
    );

    const people: Array<GraphPerson> = await client(api).listPeople("");

    expect(people).toHaveLength(2);
    const userReads: Array<DataSourceHttpRequest> =
      api.requestsTo("/v1.0/users");
    expect(userReads).toHaveLength(2);
    expect(queryValues(userReads[1]!, "$skiptoken")).toEqual(["page2"]);
    expect(
      api.requests.some((request: DataSourceHttpRequest) => {
        return new URL(request.url).host === "attacker.example.com";
      }),
    ).toBe(false);
  });

  test("interactions are read in a window bounded on both sides", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await client(api).listInteractions({
      userId: "u-1",
      startTime: BACKFILL_START,
      endTime: WINDOW_END,
    });

    const request: DataSourceHttpRequest = api.requestsTo(ANA_PATH)[0]!;
    expect(queryValues(request, "$filter")).toEqual([
      "createdDateTime gt 2026-10-12T12:00:00.000Z and createdDateTime lt 2026-10-19T11:55:00.000Z",
    ]);
    expect(queryValues(request, "$top")).toEqual(["100"]);
  });

  test.each([["u-1/../../users"], ["u-1?x=1"], [""]])(
    "a user id that would change the path (%s) is refused",
    async (userId: string) => {
      const api: FakeProviderApi = createFakeProviderApi(routes());

      await expect(
        client(api).listInteractions({
          userId,
          startTime: BACKFILL_START,
          endTime: WINDOW_END,
        }),
      ).rejects.toThrow(BadDataException);
    },
  );

  test("Azure Government signs in and reads Graph on its own hosts", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await client(api, "usgov").listPeople("");

    expect(new URL(api.requests[0]!.url).host).toBe("login.microsoftonline.us");
    expect(api.requests[0]!.body).toMatchObject({
      scope: "https://graph.microsoft.us/.default",
    });
    expect(new URL(api.requests[1]!.url).host).toBe("graph.microsoft.us");
  });
});

describe("Microsoft365CopilotConnector text", () => {
  test("HTML reads as lines of text, entities decoded, scripts gone", () => {
    expect(
      Microsoft365CopilotConnector.readInteractionText(ANA_INTERACTIONS[1]!),
    ).toBe("Yes & it is 180ms.\n\nSee the table.");
    expect(
      Microsoft365CopilotConnector.readHtmlText(
        "<p>one<br/>two</p><ul><li>a</li><li>b</li></ul>",
      ),
    ).toBe("one\ntwo\n\na\nb");
    expect(
      Microsoft365CopilotConnector.readHtmlText(
        "<table><tr><th>Day</th><th>Calls</th></tr><tr><td>Mon</td><td>12</td></tr></table>",
      ),
    ).toBe("Day Calls\nMon 12");
  });

  test("plain text keeps a < a person typed", () => {
    expect(
      Microsoft365CopilotConnector.readInteractionText(ANA_INTERACTIONS[0]!),
    ).toBe("Is latency < 200ms in the report?");
  });

  test("an answer held in an adaptive card is read from its message field", () => {
    expect(
      Microsoft365CopilotConnector.readInteractionText(ANA_INTERACTIONS[3]!),
    ).toBe("You have 3 meetings today.");
  });

  test("a card without a message field reads as its text blocks; a broken card as nothing", () => {
    expect(
      Microsoft365CopilotConnector.readAdaptiveCardText({
        type: "AdaptiveCard",
        body: [
          { type: "TextBlock", text: "First" },
          {
            type: "ColumnSet",
            columns: [
              {
                type: "Column",
                items: [{ type: "TextBlock", text: "Second" }],
              },
            ],
          },
        ],
      }),
    ).toBe("First\n\nSecond");
    expect(Microsoft365CopilotConnector.readAdaptiveCardText("{not json")).toBe(
      "",
    );
  });

  test.each([
    ["IPM.SkypeTeams.Message.Copilot.Word", "Word"],
    ["IPM.SkypeTeams.Message.Copilot.BizChat", "Copilot Chat"],
    ["IPM.SkypeTeams.Message.Copilot.Teams", "Teams"],
    ["IPM.SkypeTeams.Message.Copilot.Designer", "Designer"],
  ])("%s is %s", (appClass: string, name: string) => {
    expect(Microsoft365CopilotConnector.appNameOf(appClass)).toBe(name);
  });

  test("tag names are read as a browser reads them", () => {
    expect(Microsoft365CopilotConnector.tagNameOf("<br/>")).toBe("br");
    expect(Microsoft365CopilotConnector.tagNameOf("</P>")).toBe("p");
    expect(Microsoft365CopilotConnector.tagNameOf('<li class="x">')).toBe("li");
    expect(Microsoft365CopilotConnector.tagNameOf("<!-- c -->")).toBe("");
  });
});

describe("Microsoft365CopilotConnector turns", () => {
  test("a prompt and its answers share a requestId and are one turn", () => {
    const turns: Array<LlmChatTurn> = Microsoft365CopilotConnector.buildTurns({
      person: ANA,
      interactions: ANA_INTERACTIONS,
      now: NOW,
    });

    // r3's prompt has waited 10 minutes: not a turn yet.
    expect(turnIds(turns)).toEqual(["r1", "r2"]);
    expect(turns[0]).toMatchObject({
      conversationId: "s1",
      conversationTitle: "",
      personEmail: "ana@contoso.onmicrosoft.com",
      personId: "u-1",
      personName: "Ana",
      model: MICROSOFT_365_COPILOT_MODEL,
      app: "Word",
      startedAt: new Date("2026-10-19T09:00:00Z"),
      endedAt: new Date("2026-10-19T09:00:05Z"),
      url: "",
    });
    expect(turns[0]!.question[0]!.role).toBe(LlmChatRole.User);
    expect(turns[0]!.answer[0]!.role).toBe(LlmChatRole.Assistant);
    // The file the answer pointed to is named, never read.
    expect(turns[0]!.answer[0]!.parts).toEqual([
      {
        type: LlmChatPartType.Text,
        text: "Yes & it is 180ms.\n\nSee the table.",
      },
      { type: LlmChatPartType.File, text: "Q3 report.docx" },
    ]);
    expect(turns[1]).toMatchObject({
      conversationId: "s2",
      app: "Copilot Chat",
    });
  });

  test("a prompt with no answer for an hour is a turn of its own", () => {
    const turns: Array<LlmChatTurn> = Microsoft365CopilotConnector.buildTurns({
      person: ANA,
      interactions: ANA_INTERACTIONS,
      now: new Date("2026-10-19T12:50:00Z"),
    });

    expect(turnIds(turns)).toEqual(["r1", "r2", "r3"]);
    expect(turns[2]!.answer).toEqual([]);
  });

  test("an answer whose prompt fell before the window is still a turn", () => {
    const turns: Array<LlmChatTurn> = Microsoft365CopilotConnector.buildTurns({
      person: ANA,
      interactions: [ANA_INTERACTIONS[1]!],
      now: NOW,
    });

    expect(turnIds(turns)).toEqual(["r1"]);
    expect(turns[0]!.question).toEqual([]);
  });

  test("an interaction without a requestId is a turn by its own id; one without a time is left out", () => {
    const turns: Array<LlmChatTurn> = Microsoft365CopilotConnector.buildTurns({
      person: ANA,
      interactions: [
        { ...BOB_INTERACTIONS[1]!, requestId: "" },
        {
          ...BOB_INTERACTIONS[0]!,
          requestId: "rx",
          createdDateTime: "yesterday",
        },
      ],
      now: NOW,
    });

    expect(turnIds(turns)).toEqual(["b2"]);
  });
});

describe("Microsoft365CopilotConnector reads", () => {
  test("the first read covers the backfill for every enabled person", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmChatFetchResult =
      await new Microsoft365CopilotConnector().fetchChats(
        SETTINGS,
        options(api),
      );

    expect(result.complete).toBe(true);
    expect(turnIds(result.turns)).toEqual(["r1", "r2", "rb"]);
    expect(result.turns[2]).toMatchObject({
      personEmail: "bob@contoso.com",
      app: "Teams",
    });
    expect(result.deletedConversationIds).toEqual([]);
    expect(result.nextState).toEqual({ cursor: "2026-10-19T11:55:00.000Z" });

    for (const path of [ANA_PATH, BOB_PATH]) {
      expect(queryValues(api.requestsTo(path)[0]!, "$filter")).toEqual([
        "createdDateTime gt 2026-10-12T12:00:00.000Z and createdDateTime lt 2026-10-19T11:55:00.000Z",
      ]);
    }

    // The disabled account is not read.
    expect(
      api.requests.some((request: DataSourceHttpRequest) => {
        return request.url.includes("/users/u-3/");
      }),
    ).toBe(false);
  });

  test("a later read starts two hours before the cursor", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    await new Microsoft365CopilotConnector().fetchChats(
      SETTINGS,
      options(api, { state: { cursor: "2026-10-19T10:00:00.000Z" } }),
    );

    expect(queryValues(api.requestsTo(ANA_PATH)[0]!, "$filter")).toEqual([
      "createdDateTime gt 2026-10-19T08:00:00.000Z and createdDateTime lt 2026-10-19T11:55:00.000Z",
    ]);
  });

  test("a read that reaches its budget stops between people and the next one resumes there", async () => {
    const first: FakeProviderApi = createFakeProviderApi(routes());

    // Sign-in, people and Ana's interactions: three requests.
    const stopped: LlmChatFetchResult =
      await new Microsoft365CopilotConnector().fetchChats(
        SETTINGS,
        options(first, { maxRequests: 3 }),
      );

    expect(stopped.complete).toBe(false);
    expect(turnIds(stopped.turns)).toEqual(["r1", "r2"]);
    expect(stopped.nextState).toEqual({
      cursor: undefined,
      windowStart: "2026-10-12T12:00:00.000Z",
      windowEnd: "2026-10-19T11:55:00.000Z",
      nextIndex: 1,
    });
    expect(first.requestsTo(BOB_PATH)).toHaveLength(0);

    // The next read, later, finishes the same window from Bob on.
    const second: FakeProviderApi = createFakeProviderApi(routes());
    const resumed: LlmChatFetchResult =
      await new Microsoft365CopilotConnector().fetchChats(
        SETTINGS,
        options(second, {
          state: stopped.nextState,
          windowEnd: new Date("2026-10-19T12:30:00Z"),
        }),
      );

    expect(resumed.complete).toBe(true);
    expect(turnIds(resumed.turns)).toEqual(["rb"]);
    expect(second.requestsTo(ANA_PATH)).toHaveLength(0);
    expect(queryValues(second.requestsTo(BOB_PATH)[0]!, "$filter")).toEqual([
      "createdDateTime gt 2026-10-12T12:00:00.000Z and createdDateTime lt 2026-10-19T11:55:00.000Z",
    ]);
    expect(resumed.nextState).toEqual({ cursor: "2026-10-19T11:55:00.000Z" });
  });

  test("a window with nothing in it yet sends nothing", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmChatFetchResult =
      await new Microsoft365CopilotConnector().fetchChats(
        SETTINGS,
        options(api, { state: { cursor: "2026-10-19T14:00:00.000Z" } }),
      );

    expect(result).toMatchObject({
      turns: [],
      complete: true,
      requestCount: 0,
    });
    expect(result.nextState).toEqual({ cursor: "2026-10-19T14:00:00.000Z" });
    expect(api.requests).toHaveLength(0);
  });

  test("a group setting reads that group's people only", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmChatFetchResult =
      await new Microsoft365CopilotConnector().fetchChats(
        { ...SETTINGS, config: { ...SETTINGS.config, groupId: GROUP } },
        options(api),
      );

    expect(turnIds(result.turns)).toEqual(["rb"]);
    expect(api.requestsTo(ANA_PATH)).toHaveLength(0);
  });
});

describe("Microsoft365CopilotConnector test", () => {
  test("counts people and one person's conversations, and returns nothing anyone wrote", async () => {
    const api: FakeProviderApi = createFakeProviderApi(routes());

    const result: LlmConnectionTestResult =
      await new Microsoft365CopilotConnector().testConnection(SETTINGS, {
        transport: api.transport,
        now: (): Date => {
          return NOW;
        },
      });

    expect(result.status).toBe("pass");
    expect(result.counts).toEqual({ days: 7, conversations: 2, people: 2 });
    // Sign-in, people, and the first person's interactions only.
    expect(api.requests).toHaveLength(3);
    expect(api.requestsTo(BOB_PATH)).toHaveLength(0);
    expect(queryValues(api.requestsTo(ANA_PATH)[0]!, "$filter")).toEqual([
      "createdDateTime gt 2026-10-12T12:00:00.000Z and createdDateTime lt 2026-10-19T12:00:00.000Z",
    ]);

    const said: string = JSON.stringify(result);
    for (const words of ["latency", "180ms", "meetings", "Q3 report"]) {
      expect(said).not.toContain(words);
    }
  });

  test("a tenant with nobody in it is a warning", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        users: (): ReturnType<FakeRoute["respond"]> => {
          return json({ value: [] });
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new Microsoft365CopilotConnector().testConnection(SETTINGS, {
        transport: api.transport,
      });

    expect(result.status).toBe("warn");
    expect(result.counts).toMatchObject({ people: 0, conversations: 0 });
  });

  test("a wrong secret is an authentication failure without the secret", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        token: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            {
              error: "invalid_client",
              error_description: `AADSTS7000215: Invalid client secret provided: ${SECRET}`,
            },
            401,
          );
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new Microsoft365CopilotConnector().testConnection(SETTINGS, {
        transport: api.transport,
      });

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Authentication);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("an app without the Copilot permission is a permission failure", async () => {
    const api: FakeProviderApi = createFakeProviderApi(
      routes({
        ana: (): ReturnType<FakeRoute["respond"]> => {
          return json(
            {
              error: {
                code: "Forbidden",
                message: "Missing role AiEnterpriseInteraction.Read.All",
              },
            },
            403,
          );
        },
      }),
    );

    const result: LlmConnectionTestResult =
      await new Microsoft365CopilotConnector().testConnection(SETTINGS, {
        transport: api.transport,
      });

    expect(result.failureKind).toBe(LlmConnectionFailureKind.Permission);
    expect(result.message).toContain("interactions request");
  });

  test.each([
    {
      name: "a client id that is not a GUID",
      config: { clientId: "my-app" },
      words: "Application (client) ID",
    },
    {
      name: "a group that is not a GUID",
      config: { groupId: "all-staff" },
      words: "Group object ID",
    },
    { name: "an unknown cloud", config: { cloud: "china" }, words: "Cloud" },
    {
      name: "a tenant that is not a tenant",
      config: { tenantId: "not a tenant" },
      words: "tenant",
    },
  ])(
    "$name is refused before anything is sent",
    async ({ config, words }: { config: JSONObject; words: string }) => {
      const api: FakeProviderApi = createFakeProviderApi(routes());

      const result: LlmConnectionTestResult =
        await new Microsoft365CopilotConnector().testConnection(
          { ...SETTINGS, config: { ...SETTINGS.config, ...config } },
          { transport: api.transport },
        );

      expect(result.failureKind).toBe(LlmConnectionFailureKind.Settings);
      expect(result.message).toContain(words);
      expect(api.requests).toHaveLength(0);
    },
  );
});
