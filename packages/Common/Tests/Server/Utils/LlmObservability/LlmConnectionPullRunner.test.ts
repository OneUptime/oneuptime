import LlmConnectionPullRunner, {
  LLM_CHAT_IMPORT_BATCH_SIZE,
  LLM_CHAT_READ_DELAY_MS,
  LLM_CHAT_READ_MAX_DURATION_MS,
  LLM_CHAT_READ_MAX_REQUESTS,
  LlmChatSpanImporter,
  LlmConnectionPullOutcome,
} from "../../../../Server/Utils/LlmObservability/LlmConnectionPullRunner";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LlmObservabilityConnection from "../../../../Models/DatabaseModels/LlmObservabilityConnection";
import Project from "../../../../Models/DatabaseModels/Project";
import Reseller from "../../../../Models/DatabaseModels/Reseller";
import TelemetryIngestionDisabled from "../../../../Server/Middleware/TelemetryIngestionDisabled";
import LlmModelPriceService from "../../../../Server/Services/LlmModelPriceService";
import LlmObservabilityConnectionService from "../../../../Server/Services/LlmObservabilityConnectionService";
import OpenTelemetryIngestService from "../../../../Server/Services/OpenTelemetryIngestService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResellerService from "../../../../Server/Services/ResellerService";
import SpanService from "../../../../Server/Services/SpanService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import LlmChatSpanPayload from "../../../../Server/Utils/LlmObservability/LlmChatSpanPayload";
import LlmConnectorRegistry from "../../../../Server/Utils/LlmObservability/LlmConnectorRegistry";
import {
  LlmChatFetchOptions,
  LlmChatFetchResult,
  LlmConnectionSettings,
  LlmConnector,
  LlmConnectorCallOptions,
  LlmUsageFetchResult,
  LlmUsageWindow,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import LlmProviderUsageWriter from "../../../../Server/Utils/LlmObservability/LlmProviderUsageWriter";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionKind } from "../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmChatPartType,
  LlmChatRole,
  LlmChatTurn,
  LlmUsageRecord,
} from "../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../../Types/ObjectID";

/*
 * One read of one connection: the plan gate, the window or cursor a read
 * starts from, what it hands the writer or the trace ingest (turns already
 * imported are skipped; text is left out when the connection keeps none),
 * and what it records - when it read, what it found, the error without the
 * secret, where the next read resumes and when it comes.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SERVICE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-10-19T15:30:00Z");
const SECRET: string = "sk-admin-runner-secret-0001";

const MINUTE: number = 60 * 1000;

interface Recorded {
  id: ObjectID;
  data: JSONObject;
}

let recorded: Array<Recorded>;
let connection: LlmObservabilityConnection;
let connector: LlmConnector;
let writes: Array<{
  window: LlmUsageWindow;
  records: Array<LlmUsageRecord>;
  target: JSONObject;
}>;
let imported: Array<{ projectId: ObjectID; payload: JSONObject }>;
let chatOptions: Array<LlmChatFetchOptions>;
let existingSpanIds: Set<string>;

const importSpans: LlmChatSpanImporter = async (data: {
  projectId: ObjectID;
  payload: JSONObject;
}): Promise<void> => {
  imported.push(data);
};

function usageConnector(
  fetchUsage: (window: LlmUsageWindow) => Promise<LlmUsageFetchResult>,
): LlmConnector {
  return {
    provider: LlmConnectionProvider.OpenAI,
    kind: LlmConnectionKind.ProviderAccount,
    validateSettings: () => {},
    testConnection: async () => {
      throw new Error("not used");
    },
    fetchUsage: async (
      _settings: LlmConnectionSettings,
      window: LlmUsageWindow,
      _options: LlmConnectorCallOptions,
    ) => {
      return await fetchUsage(window);
    },
  };
}

function turn(index: number, conversation: string = "chat_1"): LlmChatTurn {
  return {
    turnId: `answer_${index}`,
    conversationId: conversation,
    conversationTitle: "Secret plans",
    personEmail: "erin@example.com",
    personId: "user_01",
    personName: "",
    model: "claude-opus-5-5",
    app: "",
    startedAt: new Date(NOW.getTime() - 60 * MINUTE + index * 1000),
    endedAt: new Date(NOW.getTime() - 60 * MINUTE + index * 1000 + 500),
    question: [
      {
        id: `q_${index}`,
        role: LlmChatRole.User,
        createdAt: new Date(NOW.getTime() - 60 * MINUTE),
        parts: [
          {
            type: LlmChatPartType.Text,
            text: `What about the merger ${index}?`,
          },
        ],
      },
    ],
    answer: [],
    url: "",
  };
}

function chatConnector(result: Partial<LlmChatFetchResult>): LlmConnector {
  return {
    provider: LlmConnectionProvider.ClaudeEnterprise,
    kind: LlmConnectionKind.CompanyTool,
    validateSettings: () => {},
    testConnection: async () => {
      throw new Error("not used");
    },
    fetchChats: async (
      _settings: LlmConnectionSettings,
      options: LlmChatFetchOptions,
    ) => {
      chatOptions.push(options);
      return {
        turns: [],
        deletedConversationIds: [],
        complete: true,
        nextState: { cursor: "2026-10-19T15:20:00.000Z" },
        requestCount: 3,
        warnings: [],
        ...result,
      };
    },
  };
}

function lastRecord(): JSONObject {
  expect(recorded.length).toBeGreaterThan(0);
  return recorded[recorded.length - 1]!.data;
}

async function run(): Promise<LlmConnectionPullOutcome> {
  return await LlmConnectionPullRunner.run(CONNECTION, {
    importSpans,
    now: () => {
      return NOW;
    },
  });
}

beforeEach(() => {
  recorded = [];
  writes = [];
  imported = [];
  chatOptions = [];
  existingSpanIds = new Set<string>();

  connection = new LlmObservabilityConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.name = "OpenAI production";
  connection.provider = LlmConnectionProvider.OpenAI;
  connection.isEnabled = true;
  connection.storeConversationText = true;
  connection.pullState = { cursor: "2026-10-18T00:00:00.000Z" };

  jest
    .spyOn(LlmObservabilityConnectionService, "findOneById")
    .mockImplementation((async () => {
      return connection;
    }) as never);
  jest
    .spyOn(LlmObservabilityConnectionService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      recorded.push({ id: data.id, data: data.data });
    }) as never);
  jest
    .spyOn(LlmObservabilityConnectionService, "ensureTelemetryService")
    .mockResolvedValue({
      serviceId: SERVICE,
      serviceName: "OpenAI production",
    });
  jest
    .spyOn(LlmObservabilityConnectionService, "getConnectorSettings")
    .mockImplementation((async () => {
      return {
        provider: connection.provider,
        config: {},
        secrets: { adminKey: SECRET },
      };
    }) as never);
  jest
    .spyOn(LlmConnectionPullRunner, "isTelemetryAllowed")
    .mockResolvedValue(true);
  jest
    .spyOn(LlmConnectionPullRunner, "loadProjectPrices")
    .mockResolvedValue([]);
  jest
    .spyOn(OpenTelemetryIngestService, "telemetryServiceFromName")
    .mockResolvedValue({
      serviceId: SERVICE,
      serviceName: "OpenAI production",
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 45,
    } as never);
  jest.spyOn(LlmProviderUsageWriter, "write").mockImplementation((async (data: {
    window: LlmUsageWindow;
    records: Array<LlmUsageRecord>;
    target: JSONObject;
  }) => {
    writes.push(data);
    return {
      seriesCount: 6,
      pointsWritten: 4,
      inputTokens: 1000,
      outputTokens: 200,
      requests: 12,
      costUsd: 0.5,
      daysWithUsage: 1,
    };
  }) as never);
  jest
    .spyOn(LlmConnectionPullRunner, "findExistingSpanIds")
    .mockImplementation(async () => {
      return existingSpanIds;
    });

  connector = usageConnector(async () => {
    return {
      records: [
        {
          day: new Date("2026-10-19T00:00:00Z"),
          model: "gpt-4o",
          person: "ana@example.com",
          project: "Web",
          apiKey: "",
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          requests: 12,
          costUsd: 0.5,
        },
      ],
      requestCount: 4,
      warnings: ["Key names could not be read."],
    };
  });
  jest.spyOn(LlmConnectorRegistry, "getConnector").mockImplementation(() => {
    return connector;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LlmConnectionPullRunner.run - what is not read", () => {
  test("a connection that is off, or gone, is skipped without a trace", async () => {
    connection.isEnabled = false;
    expect((await run()).status).toBe("skipped");

    jest
      .spyOn(LlmObservabilityConnectionService, "findOneById")
      .mockResolvedValue(null);
    expect((await run()).status).toBe("skipped");

    expect(recorded).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a project whose plan has no telemetry is not read, says so, and is asked again tomorrow", async () => {
    jest
      .spyOn(LlmConnectionPullRunner, "isTelemetryAllowed")
      .mockResolvedValue(false);
    const fetchUsage: jest.Mock = jest.fn();
    connector = usageConnector(fetchUsage as never);

    const outcome: LlmConnectionPullOutcome = await run();

    expect(outcome.status).toBe("skipped");
    expect(fetchUsage).not.toHaveBeenCalled();
    expect(lastRecord()).toEqual({
      lastPulledAt: NOW,
      lastError:
        "AI connections are not part of this project's plan, or telemetry ingestion is turned off.",
      nextPullAt: new Date(NOW.getTime() + 24 * 60 * MINUTE),
    });
  });
});

describe("LlmConnectionPullRunner.run - a provider account", () => {
  test("reads from a few days before its last read and writes what it found", async () => {
    const outcome: LlmConnectionPullOutcome = await run();

    expect(outcome.status).toBe("success");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.window).toEqual({
      startDay: new Date("2026-10-16T00:00:00Z"),
      endDay: new Date("2026-10-20T00:00:00Z"),
    });
    expect(writes[0]!.records).toHaveLength(1);
    expect(writes[0]!.target).toMatchObject({
      projectId: PROJECT,
      connectionId: CONNECTION,
      connectionName: "OpenAI production",
      genAiProviderName: "openai",
      serviceId: SERVICE,
      serviceName: "OpenAI production",
      // The project's metric retention: the service has none of its own.
      retentionInDays: 45,
      costIsEstimated: false,
      projectPriceOverrides: [],
    });
  });

  test("records the read, the cursor, what it found and when it reads next", async () => {
    await run();

    const data: JSONObject = lastRecord();
    expect(data).toMatchObject({
      lastPulledAt: NOW,
      lastSuccessfulPullAt: NOW,
      lastError: null,
      pullState: { cursor: "2026-10-19T00:00:00.000Z" },
      nextPullAt: new Date(NOW.getTime() + 15 * MINUTE),
    });
    expect(data["lastPullResult"]).toMatchObject({
      status: "success",
      kind: "usage",
      days: 4,
      daysWithUsage: 1,
      pointsWritten: 4,
      inputTokens: 1000,
      outputTokens: 200,
      requests: 12,
      costUsd: 0.5,
      requestCount: 4,
      warnings: ["Key names could not be read."],
    });
    expect(recorded[0]!.id).toEqual(CONNECTION);
  });

  test.each([
    [401, LlmConnectionFailureKind.Authentication, 60],
    [403, LlmConnectionFailureKind.Permission, 60],
    [429, LlmConnectionFailureKind.RateLimited, 15],
    [503, LlmConnectionFailureKind.Unavailable, 15],
  ])(
    "an HTTP %i is recorded as a %s failure, without the key, and read again in %i minutes",
    async (status: number, kind: LlmConnectionFailureKind, minutes: number) => {
      connector = usageConnector(async () => {
        throw LlmProviderError.from({
          error: new Error(
            `Data source responded with HTTP ${status}: {"error":"key ${SECRET} refused"}`,
          ),
          step: "usage report",
          providerTitle: "OpenAI",
        });
      });

      const outcome: LlmConnectionPullOutcome = await run();

      expect(outcome.status).toBe("failed");
      const data: JSONObject = lastRecord();
      expect(data["nextPullAt"]).toEqual(
        new Date(NOW.getTime() + minutes * MINUTE),
      );
      expect(data["lastPullResult"]).toMatchObject({
        status: "failed",
        failureKind: kind,
      });
      expect(String(data["lastError"])).toContain(`HTTP ${status}`);
      expect(JSON.stringify(data)).not.toContain(SECRET);
      // A failed read leaves the cursor where it was.
      expect(data["pullState"]).toBeUndefined();
      expect(data["lastSuccessfulPullAt"]).toBeUndefined();
      expect(writes).toEqual([]);
    },
  );

  test("a failure to set up the service is a failed read, never an escaped error", async () => {
    jest
      .spyOn(LlmObservabilityConnectionService, "ensureTelemetryService")
      .mockRejectedValue(new Error("deadlock detected"));

    const outcome: LlmConnectionPullOutcome = await run();

    expect(outcome.status).toBe("failed");
    expect(String(lastRecord()["lastError"])).toContain("deadlock detected");
  });

  test("a read whose outcome cannot be recorded still returns", async () => {
    jest
      .spyOn(LlmObservabilityConnectionService, "updateOneById")
      .mockRejectedValue(new Error("connection terminated"));

    await expect(run()).resolves.toMatchObject({ status: "success" });
  });
});

describe("LlmConnectionPullRunner.run - a company AI tool", () => {
  beforeEach(() => {
    connection.provider = LlmConnectionProvider.ClaudeEnterprise;
    connection.name = "Claude at Acme";
    connection.pullState = { cursor: "2026-10-19T15:00:00.000Z" };
  });

  test("reads since its cursor, up to a few minutes ago, within a budget", async () => {
    connector = chatConnector({});

    await run();

    expect(chatOptions).toHaveLength(1);
    expect(chatOptions[0]).toMatchObject({
      state: { cursor: "2026-10-19T15:00:00.000Z" },
      backfillStart: new Date(NOW.getTime() - 7 * 24 * 60 * MINUTE),
      windowEnd: new Date(NOW.getTime() - LLM_CHAT_READ_DELAY_MS),
      maxRequests: LLM_CHAT_READ_MAX_REQUESTS,
      maxDurationMs: LLM_CHAT_READ_MAX_DURATION_MS,
    });
    expect(chatOptions[0]!.now!()).toEqual(NOW);
  });

  test("imports only the turns not imported before, as GenAI spans of the connection's service", async () => {
    connector = chatConnector({
      turns: [turn(1), turn(2), turn(3, "chat_2")],
      deletedConversationIds: ["chat_9"],
    });
    existingSpanIds = new Set([
      LlmChatSpanPayload.spanIdOf(CONNECTION.toString(), "answer_2"),
    ]);

    const outcome: LlmConnectionPullOutcome = await run();

    expect(imported).toHaveLength(1);
    expect(imported[0]!.projectId).toEqual(PROJECT);
    const spans: Array<JSONObject> = (
      (imported[0]!.payload["resourceSpans"] as Array<JSONObject>)[0]![
        "scopeSpans"
      ] as Array<JSONObject>
    )[0]!["spans"] as Array<JSONObject>;
    expect(
      spans.map((span: JSONObject) => {
        return span["spanId"];
      }),
    ).toEqual([
      LlmChatSpanPayload.spanIdOf(CONNECTION.toString(), "answer_1"),
      LlmChatSpanPayload.spanIdOf(CONNECTION.toString(), "answer_3"),
    ]);
    expect(JSON.stringify(imported[0]!.payload)).toContain(
      "What about the merger 1?",
    );

    expect(outcome.status).toBe("success");
    expect(lastRecord()).toMatchObject({
      pullState: { cursor: "2026-10-19T15:20:00.000Z" },
      nextPullAt: new Date(NOW.getTime() + 15 * MINUTE),
    });
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      kind: "conversations",
      turnsRead: 3,
      turnsImported: 2,
      conversationsImported: 2,
      deletedConversations: 1,
      complete: true,
    });
  });

  test("a turn read twice in one read is imported once", async () => {
    connector = chatConnector({ turns: [turn(1), turn(1), turn(2)] });

    await run();

    const spans: Array<JSONObject> = (
      (imported[0]!.payload["resourceSpans"] as Array<JSONObject>)[0]![
        "scopeSpans"
      ] as Array<JSONObject>
    )[0]!["spans"] as Array<JSONObject>;
    expect(spans).toHaveLength(2);
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      turnsRead: 3,
      turnsImported: 2,
    });
  });

  test("a connection that keeps no text imports who, when and which model - and nothing anyone wrote", async () => {
    connection.storeConversationText = false;
    connector = chatConnector({ turns: [turn(1)] });

    await run();

    const payload: string = JSON.stringify(imported[0]!.payload);
    expect(payload).not.toContain("merger");
    expect(payload).not.toContain("Secret plans");
    expect(payload).toContain("erin@example.com");
  });

  test("a read that stopped part way continues in a minute from where it stopped", async () => {
    connector = chatConnector({
      turns: [turn(1)],
      complete: false,
      nextState: {
        cursor: "2026-10-19T15:00:00.000Z",
        windowStart: "a",
        windowEnd: "b",
        nextIndex: 40,
      },
    });

    const outcome: LlmConnectionPullOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(lastRecord()).toMatchObject({
      pullState: {
        cursor: "2026-10-19T15:00:00.000Z",
        windowStart: "a",
        windowEnd: "b",
        nextIndex: 40,
      },
      nextPullAt: new Date(NOW.getTime() + MINUTE),
    });
  });

  test("turns go to the ingest in batches", async () => {
    const turns: Array<LlmChatTurn> = Array.from(
      { length: LLM_CHAT_IMPORT_BATCH_SIZE * 2 + 1 },
      (_: unknown, index: number) => {
        return turn(index, `chat_${index % 5}`);
      },
    );
    connector = chatConnector({ turns });

    await run();

    expect(
      imported.map((call: { payload: JSONObject }) => {
        return (
          (
            (call.payload["resourceSpans"] as Array<JSONObject>)[0]![
              "scopeSpans"
            ] as Array<JSONObject>
          )[0]!["spans"] as Array<JSONObject>
        ).length;
      }),
    ).toEqual([LLM_CHAT_IMPORT_BATCH_SIZE, LLM_CHAT_IMPORT_BATCH_SIZE, 1]);
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      turnsImported: LLM_CHAT_IMPORT_BATCH_SIZE * 2 + 1,
      conversationsImported: 5,
    });
  });

  test("an ingest that fails fails the read, and the cursor stays for the next one", async () => {
    connector = chatConnector({ turns: [turn(1)] });

    const outcome: LlmConnectionPullOutcome = await LlmConnectionPullRunner.run(
      CONNECTION,
      {
        importSpans: async () => {
          throw new Error("queue full");
        },
        now: () => {
          return NOW;
        },
      },
    );

    expect(outcome.status).toBe("failed");
    expect(lastRecord()["pullState"]).toBeUndefined();
  });
});

describe("LlmConnectionPullRunner helpers", () => {
  test.each([
    [{ outcome: "partial" as const }, 1],
    [{ outcome: "success" as const }, 15],
    [{ outcome: "failed" as const }, 15],
    [
      {
        outcome: "failed" as const,
        failureKind: LlmConnectionFailureKind.Authentication,
      },
      60,
    ],
    [
      {
        outcome: "failed" as const,
        failureKind: LlmConnectionFailureKind.Permission,
      },
      60,
    ],
    [
      {
        outcome: "failed" as const,
        failureKind: LlmConnectionFailureKind.RateLimited,
      },
      15,
    ],
  ])("next read after %j: %i minutes", (data: JSONObject, minutes: number) => {
    expect(
      LlmConnectionPullRunner.nextPullAt({
        now: NOW,
        intervalInMinutes: 15,
        ...(data as never),
      }),
    ).toEqual(new Date(NOW.getTime() + minutes * MINUTE));
  });

  test("a long interval is kept after a failure", () => {
    expect(
      LlmConnectionPullRunner.nextPullAt({
        now: NOW,
        intervalInMinutes: 60,
        outcome: "failed",
      }),
    ).toEqual(new Date(NOW.getTime() + 60 * MINUTE));
  });

  test("a stored resume point is read back only as far as it makes sense", () => {
    expect(
      LlmConnectionPullRunner.readPullState({
        cursor: "2026-10-19T15:00:00.000Z",
        windowStart: 5,
        windowEnd: "",
        pageToken: "abc",
        nextIndex: -1,
        extra: "ignored",
      }),
    ).toEqual({
      cursor: "2026-10-19T15:00:00.000Z",
      windowStart: undefined,
      windowEnd: undefined,
      pageToken: "abc",
      nextIndex: undefined,
    });
    expect(
      LlmConnectionPullRunner.readPullState({ nextIndex: 3 }).nextIndex,
    ).toBe(3);
    expect(LlmConnectionPullRunner.readPullState(null)).toEqual({
      cursor: undefined,
      windowStart: undefined,
      windowEnd: undefined,
      pageToken: undefined,
      nextIndex: undefined,
    });
    expect(
      LlmConnectionPullRunner.readPullState([1, 2]).cursor,
    ).toBeUndefined();
  });
});

describe("LlmConnectionPullRunner.isTelemetryAllowed", () => {
  beforeEach(() => {
    (
      LlmConnectionPullRunner.isTelemetryAllowed as unknown as jest.Mock
    ).mockRestore?.();
  });

  function project(resellerId?: ObjectID): Project {
    const value: Project = new Project();
    value.id = PROJECT;
    if (resellerId) {
      value.resellerId = resellerId;
    }
    return value;
  }

  test("an installation with telemetry ingestion off reads nothing", async () => {
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(true);
    const findProject: jest.SpiedFunction<typeof ProjectService.findOneById> =
      jest.spyOn(ProjectService, "findOneById");

    expect(await LlmConnectionPullRunner.isTelemetryAllowed(PROJECT)).toBe(
      false,
    );
    expect(findProject).not.toHaveBeenCalled();
  });

  test("a project of no reseller reads; a reseller's project reads only with telemetry features", async () => {
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
    const reseller: Reseller = new Reseller();
    reseller.enableTelemetryFeatures = false;
    const resellerId: ObjectID = ObjectID.generate();

    jest.spyOn(ProjectService, "findOneById").mockResolvedValueOnce(project());
    expect(await LlmConnectionPullRunner.isTelemetryAllowed(PROJECT)).toBe(
      true,
    );

    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project(resellerId));
    jest.spyOn(ResellerService, "findOneById").mockResolvedValueOnce(reseller);
    expect(await LlmConnectionPullRunner.isTelemetryAllowed(PROJECT)).toBe(
      false,
    );

    reseller.enableTelemetryFeatures = true;
    jest.spyOn(ResellerService, "findOneById").mockResolvedValueOnce(reseller);
    expect(await LlmConnectionPullRunner.isTelemetryAllowed(PROJECT)).toBe(
      true,
    );

    jest.spyOn(ProjectService, "findOneById").mockResolvedValueOnce(null);
    expect(await LlmConnectionPullRunner.isTelemetryAllowed(PROJECT)).toBe(
      false,
    );
  });
});

describe("LlmConnectionPullRunner.findExistingSpanIds", () => {
  beforeEach(() => {
    (
      LlmConnectionPullRunner.findExistingSpanIds as unknown as jest.Mock
    ).mockRestore?.();
  });

  test("asks the connection's service for the ids, a thousand at a time, every value a parameter", async () => {
    const statements: Array<Statement> = [];
    jest.spyOn(SpanService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ) => {
      statements.push(statement);
      return {
        json: async () => {
          return { data: [{ spanId: "ABCDEF0123456789" }, { spanId: 7 }] };
        },
      };
    }) as never);

    const ids: Array<string> = Array.from(
      { length: 1500 },
      (_: unknown, index: number) => {
        return index.toString(16).padStart(16, "0");
      },
    );

    const found: Set<string> =
      await LlmConnectionPullRunner.findExistingSpanIds({
        projectId: PROJECT,
        serviceId: SERVICE,
        spanIds: ids,
        from: new Date("2026-10-18T00:00:00Z"),
        to: new Date("2026-10-20T00:00:00Z"),
      });

    expect(found).toEqual(new Set(["abcdef0123456789"]));
    expect(statements).toHaveLength(2);
    expect(statements[0]!.query).toContain(
      `SELECT spanId FROM ${AnalyticsTableName.Span}`,
    );
    expect(statements[0]!.query).not.toContain(PROJECT.toString());

    const values: Array<unknown> = Object.values(statements[0]!.query_params);
    expect(values).toEqual(
      expect.arrayContaining([PROJECT.toString(), SERVICE.toString()]),
    );
    expect(
      values.find((value: unknown) => {
        return Array.isArray(value);
      }),
    ).toHaveLength(1000);
    expect(
      Object.values(statements[1]!.query_params).find((value: unknown) => {
        return Array.isArray(value);
      }),
    ).toHaveLength(500);
  });
});

describe("LlmConnectionPullRunner.loadProjectPrices", () => {
  beforeEach(() => {
    (
      LlmConnectionPullRunner.loadProjectPrices as unknown as jest.Mock
    ).mockRestore?.();
  });

  test("the project's enabled prices, normalized", async () => {
    jest.spyOn(LlmModelPriceService, "findBy").mockResolvedValue([
      {
        modelPrefix: " GPT-4o ",
        inputPricePerMillionTokensInUSD: 1,
        outputPricePerMillionTokensInUSD: 2,
      },
      { modelPrefix: "", inputPricePerMillionTokensInUSD: 9 },
    ] as never);

    expect(await LlmConnectionPullRunner.loadProjectPrices(PROJECT)).toEqual([
      {
        modelPrefix: "gpt-4o",
        inputPricePerMillionTokensInUSD: 1,
        outputPricePerMillionTokensInUSD: 2,
      },
    ]);
  });
});
