import ToolImportRun from "../../../../Models/DatabaseModels/ToolImportRun";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../../Server/Infrastructure/Semaphore";
import ToolImportRunService from "../../../../Server/Services/ToolImportRunService";
import ToolImportApplier from "../../../../Server/Utils/ToolImport/ToolImportApplier";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import ToolImportRunExecutor, {
  cleanUploadFileName,
  TOOL_IMPORT_RUN_JOB,
  TOOL_IMPORT_STALE_RUN_MS,
} from "../../../../Server/Utils/ToolImport/ToolImportRunExecutor";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import Includes from "../../../../Types/BaseDatabase/Includes";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { getToolImportSourceDefinition } from "../../../../Types/ToolImport/ToolImportCatalog";
import {
  TOOL_IMPORT_MAX_FILE_NAME_LENGTH,
  TOOL_IMPORT_MAX_UPLOAD_BYTES,
  TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS,
} from "../../../../Types/ToolImport/ToolImportLimits";
import {
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportReport,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "../../../../Types/ToolImport/ToolImportRunStatus";
import { ToolImportSnapshot } from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  GRAFANA_API_URL,
  GRAFANA_HOST,
  GRAFANA_TOKEN,
  grafanaOnCallApi,
} from "./GrafanaOnCallFixtures";
import { OPSGENIE_KEY, opsGenieApi, opsGenieError } from "./OpsGenieFixtures";
import { PAGERDUTY_KEY, pagerDutyApi } from "./PagerDutyFixtures";
import {
  SPLUNK_API_ID,
  SPLUNK_KEY,
  splunkOnCallApi,
} from "./SplunkOnCallFixtures";
import { FixtureApi, json } from "./ToolImportFixtureTransport";
import { KUMA_SECRETS, kumaBackupText } from "./UptimeKumaFixtures";
import { UPTIMEROBOT_KEY, uptimeRobotApi } from "./UptimeRobotFixtures";
import {
  fullAccess,
  person,
  projectState,
  snapshot,
} from "./ToolImportSnapshotFixtures";

/*
 * The run's life around the read and the import: who may start what, one
 * import of a project at a time, the job (which carries the run's id and
 * never the key), the key cleared the moment the read ends however it
 * ends, the import acting as the person with what they may do now, the
 * report stored, and the sweep that fails what a dead worker left behind.
 * The read runs the real Opsgenie adapter against a fixture Opsgenie.
 */

jest.mock("../../../../Server/Services/ToolImportRunService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});
jest.mock("../../../../Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Worker: "Worker" },
  };
});
jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
    SemaphoreLockTimeoutError: class extends Error {},
  };
});
jest.mock(
  "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization",
  () => {
    return {
      __esModule: true,
      default: { getProjectMemberProps: jest.fn() },
    };
  },
);
jest.mock("../../../../Server/Utils/Billing/CallerPlan", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../../Server/Utils/Billing/CallerPlan",
  );

  /*
   * The props a test builds carry their plan already: withPlan hands them
   * back as they are, and every other rule is the real one.
   */
  const CallerPlanWithTestProps: Record<string, unknown> = Object.create(
    actual.default,
  );
  CallerPlanWithTestProps["withPlan"] = jest.fn(async (props: unknown) => {
    return props;
  });

  return { __esModule: true, default: CallerPlanWithTestProps };
});
jest.mock(
  "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader",
  () => {
    return {
      __esModule: true,
      default: { readState: jest.fn(), readAccess: jest.fn() },
    };
  },
);
jest.mock("../../../../Server/Utils/ToolImport/ToolImportApplier", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/Utils/ToolImport/ToolImportApplier",
  );

  return {
    __esModule: true,
    ...actual,
    default: { apply: jest.fn() },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const OTHER_USER_ID: ObjectID = ObjectID.generate();

// The real transport factory, before each test replaces it with a fixture.
const PRODUCTION_TRANSPORT_FACTORY: typeof ToolImportRunExecutor.transportFactory =
  ToolImportRunExecutor.transportFactory;

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

// The runs table, in memory.
class Runs {
  public rows: Map<string, Record<string, unknown>> = new Map<
    string,
    Record<string, unknown>
  >();
  public updates: Array<{ id: string; data: Record<string, unknown> }> = [];

  public add(row: Record<string, unknown>): string {
    const id: string = (row["_id"] as string) || ObjectID.generate().toString();
    this.rows.set(id, {
      createdAt: new Date(),
      updatedAt: new Date(),
      projectId: PROJECT_ID,
      createdByUserId: USER_ID,
      ...row,
      _id: id,
    });
    return id;
  }

  public get(id: string | ObjectID): Record<string, unknown> {
    return this.rows.get(id.toString())!;
  }

  public toModel(row: Record<string, unknown>): ToolImportRun {
    const run: ToolImportRun = new ToolImportRun();
    Object.assign(run, row);
    run.id = new ObjectID(row["_id"] as string);
    return run;
  }

  public matches(
    row: Record<string, unknown>,
    query: Record<string, unknown>,
  ): boolean {
    return Object.entries(query).every(([key, expected]: [string, unknown]) => {
      const actual: unknown = row[key];

      if (expected instanceof Includes) {
        return (expected.values as Array<unknown>)
          .map((value: unknown) => {
            return String(value);
          })
          .includes(String(actual));
      }

      if (expected instanceof LessThan) {
        return (
          actual instanceof Date &&
          actual.getTime() < (expected.value as Date).getTime()
        );
      }

      return String(actual) === String(expected);
    });
  }

  public install(): void {
    (ToolImportRunService.create as jest.Mock).mockImplementation(
      async (args: { data: ToolImportRun }): Promise<ToolImportRun> => {
        const row: Record<string, unknown> = { ...args.data } as Record<
          string,
          unknown
        >;
        const id: string = this.add(row);
        return this.toModel(this.get(id));
      },
    );

    (ToolImportRunService.findOneById as jest.Mock).mockImplementation(
      async (args: { id: ObjectID }): Promise<ToolImportRun | null> => {
        const row: Record<string, unknown> | undefined = this.rows.get(
          args.id.toString(),
        );
        return row ? this.toModel(row) : null;
      },
    );

    (ToolImportRunService.findOneBy as jest.Mock).mockImplementation(
      async (args: {
        query: Record<string, unknown>;
      }): Promise<ToolImportRun | null> => {
        const row: Record<string, unknown> | undefined = [
          ...this.rows.values(),
        ].find((candidate: Record<string, unknown>) => {
          return this.matches(candidate, args.query);
        });
        return row ? this.toModel(row) : null;
      },
    );

    (ToolImportRunService.findBy as jest.Mock).mockImplementation(
      async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<ToolImportRun>> => {
        return [...this.rows.values()]
          .filter((candidate: Record<string, unknown>) => {
            return this.matches(candidate, args.query);
          })
          .map((row: Record<string, unknown>) => {
            return this.toModel(row);
          });
      },
    );

    (ToolImportRunService.updateOneById as jest.Mock).mockImplementation(
      async (args: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        const row: Record<string, unknown> = this.get(args.id);
        this.updates.push({ id: args.id.toString(), data: args.data });
        Object.assign(row, args.data, { updatedAt: new Date() });
      },
    );
  }
}

let runs: Runs;

beforeEach(() => {
  jest.clearAllMocks();
  runs = new Runs();
  runs.install();
  (Semaphore.lock as jest.Mock).mockResolvedValue({ key: "lock" });
  (Semaphore.release as jest.Mock).mockResolvedValue(undefined);
  (Queue.addJob as jest.Mock).mockResolvedValue(undefined);
  ToolImportRunExecutor.transportFactory = (): never => {
    throw new Error("A test must give the read a fixture transport.");
  };
  // Reads keep a tool's pace by waiting: here they wait no real time.
  waits = [];
  ToolImportRunExecutor.readSleep = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
});

let waits: Array<number> = [];

describe("ToolImportRunExecutor.validateReadRequest", () => {
  test("a known tool, one of its regions and a key on its own", () => {
    expect(
      ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.OpsGenie,
        region: "EU",
        apiKey: `  ${OPSGENIE_KEY}\n`,
      }),
    ).toEqual({
      source: ToolImportSource.OpsGenie,
      region: {
        value: "EU",
        title: "EU (api.eu.opsgenie.com)",
        host: "api.eu.opsgenie.com",
      },
      apiKey: OPSGENIE_KEY,
    });
  });

  test.each([
    [
      "an unknown tool",
      { source: "Elsewhere", region: "", apiKey: "k" },
      "Choose a tool to import from.",
    ],
    [
      "a region the tool does not have",
      { source: "OpsGenie", region: "MARS", apiKey: "k" },
      "Choose one of Opsgenie's regions.",
    ],
    [
      "an empty key",
      { source: "OpsGenie", region: "US", apiKey: "   " },
      "Paste your Opsgenie API key.",
    ],
    [
      "a key that is not text",
      { source: "OpsGenie", region: "US", apiKey: 12345 },
      "Paste your Opsgenie API key.",
    ],
    [
      "a key with spaces in it",
      { source: "OpsGenie", region: "US", apiKey: "two words" },
      "That does not look like your Opsgenie API key. Paste the key on its own.",
    ],
    [
      "a key longer than any key",
      { source: "IncidentIo", region: "", apiKey: "k".repeat(513) },
      "That does not look like your incident.io API key. Paste the key on its own.",
    ],
  ] as Array<[string, Record<string, unknown>, string]>)(
    "refuses %s",
    (_label: string, request: Record<string, unknown>, message: string) => {
      expect(() => {
        return ToolImportRunExecutor.validateReadRequest(
          request as { source: unknown; region: unknown; apiKey: unknown },
        );
      }).toThrow(message);
    },
  );
});

describe("ToolImportRunExecutor.startRead", () => {
  test("creates a Reading run with the key on it, and queues a job that carries only the run's id", async () => {
    const runId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: ToolImportSource.OpsGenie,
      region: "EU",
      apiKey: OPSGENIE_KEY,
    });

    expect(runs.get(runId)).toMatchObject({
      source: ToolImportSource.OpsGenie,
      region: "EU",
      status: ToolImportRunStatus.Reading,
      apiKey: OPSGENIE_KEY,
    });
    expect(String(runs.get(runId)["createdByUserId"])).toBe(USER_ID.toString());

    expect(Queue.addJob).toHaveBeenCalledWith(
      "Worker",
      `${runId.toString()}-read`,
      TOOL_IMPORT_RUN_JOB,
      { runId: runId.toString() },
      { attempts: 1 },
    );
    expect(
      JSON.stringify((Queue.addJob as jest.Mock).mock.calls),
    ).not.toContain(OPSGENIE_KEY);
    expect(Semaphore.release).toHaveBeenCalled();
  });

  test("a tool with one API stores no region", async () => {
    const runId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: ToolImportSource.IncidentIo,
      region: undefined,
      apiKey: "inc_key_123456",
    });

    expect(runs.get(runId)["region"]).toBeUndefined();
  });

  test("only one import of a project reads or imports at a time", async () => {
    runs.add({ status: ToolImportRunStatus.Importing, updatedAt: new Date() });

    await expect(
      ToolImportRunExecutor.startRead({
        projectId: PROJECT_ID,
        userId: OTHER_USER_ID,
        source: ToolImportSource.OpsGenie,
        region: "US",
        apiKey: OPSGENIE_KEY,
      }),
    ).rejects.toThrow("Another import is running in this project.");
    expect(Queue.addJob).not.toHaveBeenCalled();
    expect(Semaphore.release).toHaveBeenCalled();
  });

  test("an import a dead worker left running does not block a new one: it is failed first", async () => {
    const stuckId: string = runs.add({
      status: ToolImportRunStatus.Reading,
      apiKey: "old-key",
      updatedAt: new Date(Date.now() - TOOL_IMPORT_STALE_RUN_MS - 60_000),
    });

    await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: ToolImportSource.OpsGenie,
      region: "US",
      apiKey: OPSGENIE_KEY,
    });

    expect(runs.get(stuckId)).toMatchObject({
      status: ToolImportRunStatus.Failed,
      apiKey: null,
    });
  });

  test("reading again discards the person's earlier previews and what was read for them, not anyone else's", async () => {
    const mine: string = runs.add({
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: { people: [] },
    });
    const theirs: string = runs.add({
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: { people: [] },
      createdByUserId: OTHER_USER_ID,
    });
    const finished: string = runs.add({
      status: ToolImportRunStatus.Completed,
      report: { items: [] },
    });

    const runId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: ToolImportSource.OpsGenie,
      region: "US",
      apiKey: OPSGENIE_KEY,
    });

    expect(runs.get(mine)).toMatchObject({
      status: ToolImportRunStatus.Cancelled,
      snapshot: null,
      apiKey: null,
    });
    expect(runs.get(theirs)).toMatchObject({
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: { people: [] },
    });
    expect(runs.get(finished)["status"]).toBe(ToolImportRunStatus.Completed);
    expect(runs.get(runId)["status"]).toBe(ToolImportRunStatus.Reading);
  });

  test("a job that cannot be queued fails the run, and clears its key", async () => {
    (Queue.addJob as jest.Mock).mockRejectedValue(new Error("valkey down"));

    await expect(
      ToolImportRunExecutor.startRead({
        projectId: PROJECT_ID,
        userId: USER_ID,
        source: ToolImportSource.OpsGenie,
        region: "US",
        apiKey: OPSGENIE_KEY,
      }),
    ).rejects.toThrow("The import could not be queued. Try again.");

    const row: Record<string, unknown> = [...runs.rows.values()][0]!;

    expect(row).toMatchObject({
      status: ToolImportRunStatus.Failed,
      apiKey: null,
    });
  });
});

describe("ToolImportRunExecutor: the worker reads", () => {
  function readingRun(): string {
    return runs.add({
      source: ToolImportSource.OpsGenie,
      region: "US",
      status: ToolImportRunStatus.Reading,
      apiKey: OPSGENIE_KEY,
    });
  }

  test("what was read is stored for the preview, and the key is cleared", async () => {
    const api: FixtureApi = opsGenieApi();
    ToolImportRunExecutor.transportFactory = (hosts: Array<string>) => {
      expect(hosts).toEqual(["api.opsgenie.com", "api.eu.opsgenie.com"]);
      return api.transport;
    };

    const runId: string = readingRun();

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const row: Record<string, unknown> = runs.get(runId);

    expect(row["status"]).toBe(ToolImportRunStatus.ReadyToReview);
    expect(row["apiKey"]).toBeNull();
    expect(row["accountName"]).toBe("acme");
    expect(row["progress"]).toBeNull();
    expect((row["snapshot"] as ToolImportSnapshot).people).toHaveLength(3);
    expect(JSON.stringify(row["snapshot"])).not.toContain(OPSGENIE_KEY);
  });

  test("the read's progress names what it reads", async () => {
    ToolImportRunExecutor.transportFactory = () => {
      return opsGenieApi().transport;
    };

    const runId: string = readingRun();

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const kinds: Array<unknown> = runs.updates
      .filter(
        (update: { id: string; data: Record<string, unknown> }): boolean => {
          return Boolean(update.data["progress"]);
        },
      )
      .map((update: { id: string; data: Record<string, unknown> }): unknown => {
        return (update.data["progress"] as JSONObject)["kind"];
      });

    expect(kinds).toEqual([
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Service,
    ]);
  });

  test("a refused key fails the run with what to check, clears the key, and never stores it in the error", async () => {
    const api: FixtureApi = opsGenieApi().add({
      path: "/v2/account",
      answers: [json(opsGenieError(401, `bad key ${OPSGENIE_KEY}`), 401)],
    });
    ToolImportRunExecutor.transportFactory = () => {
      return api.transport;
    };

    const runId: string = readingRun();

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const row: Record<string, unknown> = runs.get(runId);

    expect(row["status"]).toBe(ToolImportRunStatus.Failed);
    expect(row["apiKey"]).toBeNull();
    expect(row["snapshot"]).toBeNull();
    expect(row["error"]).toContain("Opsgenie did not accept the API key");
    expect(String(row["error"])).not.toContain(OPSGENIE_KEY);
    expect(row["completedAt"]).toBeInstanceOf(Date);
  });

  test("a run whose key is gone asks for it again", async () => {
    ToolImportRunExecutor.transportFactory = () => {
      return opsGenieApi().transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.OpsGenie,
      region: "US",
      status: ToolImportRunStatus.Reading,
      apiKey: null,
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Failed,
      error: "The API key is no longer here. Paste it again to read the tool.",
    });
  });

  test("a run another worker holds is left to it", async () => {
    (Semaphore.lock as jest.Mock).mockRejectedValue(
      new SemaphoreLockTimeoutError("held"),
    );

    const runId: string = readingRun();

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(runs.get(runId)["status"]).toBe(ToolImportRunStatus.Reading);
    expect(ToolImportRunService.findOneById).not.toHaveBeenCalled();
  });

  test("a finished run is left as it is", async () => {
    const runId: string = runs.add({
      source: ToolImportSource.OpsGenie,
      status: ToolImportRunStatus.Completed,
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(runs.updates).toEqual([]);
    expect(Semaphore.release).toHaveBeenCalled();
  });
});

describe("ToolImportRunExecutor: what PagerDuty, Splunk On-Call and Grafana OnCall need besides a key", () => {
  const ENV: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV };
  });

  test("PagerDuty takes a key and one of its two regions", () => {
    expect(
      ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.PagerDuty,
        region: "EU",
        apiKey: ` ${PAGERDUTY_KEY} `,
      }),
    ).toEqual({
      source: ToolImportSource.PagerDuty,
      region: {
        value: "EU",
        title: "EU (api.eu.pagerduty.com)",
        host: "api.eu.pagerduty.com",
      },
      apiKey: PAGERDUTY_KEY,
    });
    expect(() => {
      return ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.PagerDuty,
        region: "APAC",
        apiKey: PAGERDUTY_KEY,
      });
    }).toThrow("Choose one of PagerDuty's regions.");
  });

  test("Splunk On-Call takes its API ID with the key, each on its own", () => {
    expect(
      ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.SplunkOnCall,
        region: "",
        apiKeyId: ` ${SPLUNK_API_ID} `,
        apiKey: SPLUNK_KEY,
      }),
    ).toEqual({
      source: ToolImportSource.SplunkOnCall,
      region: { value: "", title: "Splunk On-Call", host: "api.victorops.com" },
      apiKeyId: SPLUNK_API_ID,
      apiKey: SPLUNK_KEY,
    });

    for (const [apiKeyId, message] of [
      [undefined, "Paste your Splunk On-Call API ID."],
      ["   ", "Paste your Splunk On-Call API ID."],
      [
        "two words",
        "That does not look like your Splunk On-Call API ID. Paste the ID on its own.",
      ],
    ] as Array<[unknown, string]>) {
      expect(() => {
        return ToolImportRunExecutor.validateReadRequest({
          source: ToolImportSource.SplunkOnCall,
          region: "",
          apiKeyId: apiKeyId,
          apiKey: SPLUNK_KEY,
        });
      }).toThrow(message);
    }
  });

  test("Grafana OnCall takes the address of its API, cleaned, and over https on OneUptime Cloud", () => {
    process.env["BILLING_ENABLED"] = "true";

    expect(
      ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.GrafanaOnCall,
        region: "",
        apiUrl: `${GRAFANA_API_URL}/api/v1/`,
        apiKey: GRAFANA_TOKEN,
      }),
    ).toEqual({
      source: ToolImportSource.GrafanaOnCall,
      region: { value: "", title: "Grafana OnCall", host: "" },
      apiUrl: GRAFANA_API_URL,
      apiKey: GRAFANA_TOKEN,
    });

    for (const [apiUrl, message] of [
      [undefined, "Paste your Grafana OnCall API URL."],
      ["", "Paste your Grafana OnCall API URL."],
      [
        "oncall.example.com",
        "That does not look like your Grafana OnCall API URL. Copy it from Grafana OnCall's settings.",
      ],
      [
        "https://user:pass@oncall.example.com",
        "That does not look like your Grafana OnCall API URL. Copy it from Grafana OnCall's settings.",
      ],
      [
        "http://oncall.example.com",
        "The Grafana OnCall API URL must start with https://.",
      ],
    ] as Array<[unknown, string]>) {
      expect(() => {
        return ToolImportRunExecutor.validateReadRequest({
          source: ToolImportSource.GrafanaOnCall,
          region: "",
          apiUrl: apiUrl,
          apiKey: GRAFANA_TOKEN,
        });
      }).toThrow(message);
    }
  });

  test("a self-hosted OneUptime may read a Grafana OnCall on its own network over plain http, unless its operator said not to", () => {
    delete process.env["BILLING_ENABLED"];
    delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];

    expect(ToolImportRunExecutor.allowsPlainHttpAddress()).toBe(true);
    expect(
      ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.GrafanaOnCall,
        region: "",
        apiUrl: "http://oncall-engine:8080",
        apiKey: GRAFANA_TOKEN,
      }).apiUrl,
    ).toBe("http://oncall-engine:8080");

    process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";

    expect(ToolImportRunExecutor.allowsPlainHttpAddress()).toBe(false);
    expect(() => {
      return ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.GrafanaOnCall,
        region: "",
        apiUrl: "http://oncall-engine:8080",
        apiKey: GRAFANA_TOKEN,
      });
    }).toThrow("must start with https://");
  });

  test("a tool that needs no ID or address ignores one sent anyway", () => {
    expect(
      ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.OpsGenie,
        region: "US",
        apiKey: OPSGENIE_KEY,
        apiKeyId: "ignored",
        apiUrl: "https://elsewhere.example",
      }),
    ).toEqual({
      source: ToolImportSource.OpsGenie,
      region: {
        value: "US",
        title: "US (api.opsgenie.com)",
        host: "api.opsgenie.com",
      },
      apiKey: OPSGENIE_KEY,
    });
  });

  test("the run keeps the API ID and address with the key, in the encrypted key column only, and the job carries none of them", async () => {
    const splunkRunId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: ToolImportSource.SplunkOnCall,
      region: "",
      apiKeyId: SPLUNK_API_ID,
      apiKey: SPLUNK_KEY,
    });

    expect(JSON.parse(runs.get(splunkRunId)["apiKey"] as string)).toEqual({
      apiKey: SPLUNK_KEY,
      apiKeyId: SPLUNK_API_ID,
    });
    expect(runs.get(splunkRunId)["region"]).toBeUndefined();

    // The next read waits for the first to end.
    runs.get(splunkRunId)["status"] = ToolImportRunStatus.Failed;

    const grafanaRunId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: ToolImportSource.GrafanaOnCall,
      region: "",
      apiUrl: GRAFANA_API_URL,
      apiKey: GRAFANA_TOKEN,
    });

    expect(JSON.parse(runs.get(grafanaRunId)["apiKey"] as string)).toEqual({
      apiKey: GRAFANA_TOKEN,
      apiUrl: GRAFANA_API_URL,
    });

    const jobs: string = JSON.stringify((Queue.addJob as jest.Mock).mock.calls);

    for (const secret of [SPLUNK_KEY, SPLUNK_API_ID, GRAFANA_TOKEN]) {
      expect(jobs).not.toContain(secret);
    }
  });

  test("a PagerDuty run reads through its fixed hosts, and the key is cleared", async () => {
    const api: FixtureApi = pagerDutyApi();
    let options: unknown = null;

    ToolImportRunExecutor.transportFactory = (
      hosts: Array<string>,
      given?: unknown,
    ) => {
      expect(hosts).toEqual(["api.pagerduty.com", "api.eu.pagerduty.com"]);
      options = given;
      return api.transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.PagerDuty,
      region: "US",
      status: ToolImportRunStatus.Reading,
      apiKey: PAGERDUTY_KEY,
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const row: Record<string, unknown> = runs.get(runId);

    expect(options).toMatchObject({ isAddressGiven: false });
    expect(row["status"]).toBe(ToolImportRunStatus.ReadyToReview);
    expect(row["apiKey"]).toBeNull();
    expect(row["accountName"]).toBe("acme");
    expect((row["snapshot"] as ToolImportSnapshot).schedules).toHaveLength(3);
    expect(JSON.stringify(row["snapshot"])).not.toContain(PAGERDUTY_KEY);
  });

  test("a Splunk On-Call run reads with its API ID and key, and both are cleared", async () => {
    const api: FixtureApi = splunkOnCallApi();

    ToolImportRunExecutor.transportFactory = (hosts: Array<string>) => {
      expect(hosts).toEqual(["api.victorops.com"]);
      return api.transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.SplunkOnCall,
      status: ToolImportRunStatus.Reading,
      apiKey: JSON.stringify({ apiKey: SPLUNK_KEY, apiKeyId: SPLUNK_API_ID }),
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const row: Record<string, unknown> = runs.get(runId);

    expect(row["status"]).toBe(ToolImportRunStatus.ReadyToReview);
    expect(row["apiKey"]).toBeNull();
    expect((row["snapshot"] as ToolImportSnapshot).policies).toHaveLength(2);
    expect(api.requests[0]!.headers["X-VO-Api-Id"]).toBe(SPLUNK_API_ID);
    // The worker's read keeps Splunk On-Call's pace between requests.
    expect(waits.length).toBe(api.requests.length - 1);
    expect(
      waits.every((ms: number): boolean => {
        return ms > 0 && ms <= 600;
      }),
    ).toBe(true);
  });

  test("a refused Splunk On-Call key fails the run without the key or its ID in the error", async () => {
    const api: FixtureApi = splunkOnCallApi().add({
      path: "/api-public/v2/user",
      answers: [json({ message: `bad ${SPLUNK_API_ID} / ${SPLUNK_KEY}` }, 403)],
    });

    ToolImportRunExecutor.transportFactory = () => {
      return api.transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.SplunkOnCall,
      status: ToolImportRunStatus.Reading,
      apiKey: JSON.stringify({ apiKey: SPLUNK_KEY, apiKeyId: SPLUNK_API_ID }),
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const row: Record<string, unknown> = runs.get(runId);

    expect(row["status"]).toBe(ToolImportRunStatus.Failed);
    expect(row["apiKey"]).toBeNull();
    expect(row["error"]).toContain(
      "Splunk On-Call did not accept the API ID and API key.",
    );
    expect(String(row["error"])).not.toContain(SPLUNK_KEY);
    expect(String(row["error"])).not.toContain(SPLUNK_API_ID);
  });

  test("a Grafana OnCall run reads only the host of the address given, through the egress guard", async () => {
    const api: FixtureApi = grafanaOnCallApi();
    let options: unknown = null;

    ToolImportRunExecutor.transportFactory = (
      hosts: Array<string>,
      given?: unknown,
    ) => {
      expect(hosts).toEqual([GRAFANA_HOST]);
      options = given;
      return api.transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.GrafanaOnCall,
      status: ToolImportRunStatus.Reading,
      apiKey: JSON.stringify({
        apiKey: GRAFANA_TOKEN,
        apiUrl: GRAFANA_API_URL,
      }),
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const row: Record<string, unknown> = runs.get(runId);

    expect(options).toMatchObject({
      isAddressGiven: true,
      toolName: "Grafana OnCall",
    });
    expect(row["status"]).toBe(ToolImportRunStatus.ReadyToReview);
    expect(row["apiKey"]).toBeNull();
    expect((row["snapshot"] as ToolImportSnapshot).schedules).toHaveLength(3);
  });

  test("a Grafana OnCall run whose address is gone asks for the tool to be read again", async () => {
    ToolImportRunExecutor.transportFactory = () => {
      return grafanaOnCallApi().transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.GrafanaOnCall,
      status: ToolImportRunStatus.Reading,
      apiKey: JSON.stringify({ apiKey: GRAFANA_TOKEN }),
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Failed,
      apiKey: null,
      error:
        "The Grafana OnCall API URL is no longer here. Read the tool again.",
    });
  });

  test("the transport for an address the person gave is the guarded one; for fixed hosts, the fixed one", async () => {
    const factory: typeof ToolImportRunExecutor.transportFactory =
      PRODUCTION_TRANSPORT_FACTORY;

    // An address the person gave: plain http is refused where it is not allowed.
    await expect(
      factory(["oncall.acme.example"], {
        isAddressGiven: true,
        toolName: "Grafana OnCall",
        allowHttp: false,
      })({
        method: "GET",
        url: "http://oncall.acme.example/api/v1/users/",
        headers: {},
        timeoutInMs: 1000,
      }),
    ).rejects.toThrow("An import only calls Grafana OnCall over https.");

    // A tool's fixed hosts: anything else is refused before anything is sent.
    await expect(
      factory(["api.pagerduty.com"], {
        isAddressGiven: false,
        toolName: "PagerDuty",
        allowHttp: false,
      })({
        method: "GET",
        url: "https://elsewhere.example/users",
        headers: {},
        timeoutInMs: 1000,
      }),
    ).rejects.toThrow("An import only calls the tool's own API.");
  });

  test("a failure's message never carries the key or its ID", () => {
    expect(
      ToolImportRunExecutor.describeFailure(
        new Error("refused key-123456 for id-987654"),
        ["key-123456", "id-987654"],
      ),
    ).toBe("refused [REDACTED] for [REDACTED]");
  });
});

describe("ToolImportRunExecutor: the person starts it", () => {
  const TEAM_ID: string = ObjectID.generate().toString();

  function readyRun(overrides: Record<string, unknown> = {}): string {
    return runs.add({
      source: ToolImportSource.OpsGenie,
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: snapshot({ people: [person("alice")] }),
      ...overrides,
    });
  }

  test("starting stores what was ticked and queues the import", async () => {
    const runId: string = readyRun();

    await ToolImportRunExecutor.startImport({
      runId: new ObjectID(runId),
      projectId: PROJECT_ID,
      props: PROPS,
      selection: { selectedKeys: ["Person:alice"], inviteTeamId: TEAM_ID },
    });

    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Importing,
      selection: { selectedKeys: ["Person:alice"], inviteTeamId: TEAM_ID },
      progress: { done: 0, total: 1 },
      error: null,
    });
    expect(runs.get(runId)["startedAt"]).toBeInstanceOf(Date);
    expect(Queue.addJob).toHaveBeenCalledWith(
      "Worker",
      `${runId}-import`,
      TOOL_IMPORT_RUN_JOB,
      { runId: runId },
      { attempts: 1 },
    );
  });

  test("only the person who read the tool may start its import", async () => {
    const runId: string = readyRun({ createdByUserId: OTHER_USER_ID });

    await expect(
      ToolImportRunExecutor.startImport({
        runId: new ObjectID(runId),
        projectId: PROJECT_ID,
        props: PROPS,
        selection: { selectedKeys: ["Person:alice"] },
      }),
    ).rejects.toThrow("This import was not found.");
    expect(Queue.addJob).not.toHaveBeenCalled();
  });

  test("a run of another project is not found", async () => {
    const runId: string = readyRun({ projectId: ObjectID.generate() });

    await expect(
      ToolImportRunExecutor.startImport({
        runId: new ObjectID(runId),
        projectId: PROJECT_ID,
        props: PROPS,
        selection: { selectedKeys: ["Person:alice"] },
      }),
    ).rejects.toThrow("This import was not found.");
  });

  test("an import that already started cannot start again", async () => {
    const runId: string = readyRun({ status: ToolImportRunStatus.Importing });

    await expect(
      ToolImportRunExecutor.startImport({
        runId: new ObjectID(runId),
        projectId: PROJECT_ID,
        props: PROPS,
        selection: { selectedKeys: ["Person:alice"] },
      }),
    ).rejects.toThrow("already started");
  });

  test("a preview older than a day expires instead of starting", async () => {
    const runId: string = readyRun({
      updatedAt: new Date(
        Date.now() - TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS - 1000,
      ),
    });

    await expect(
      ToolImportRunExecutor.startImport({
        runId: new ObjectID(runId),
        projectId: PROJECT_ID,
        props: PROPS,
        selection: { selectedKeys: ["Person:alice"] },
      }),
    ).rejects.toThrow("more than a day old");
    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Expired,
      snapshot: null,
    });
  });

  test("ticking nothing, or something that is not an item, is refused", async () => {
    const runId: string = readyRun();

    await expect(
      ToolImportRunExecutor.startImport({
        runId: new ObjectID(runId),
        projectId: PROJECT_ID,
        props: PROPS,
        selection: { selectedKeys: [] },
      }),
    ).rejects.toThrow("Tick at least one thing to bring over.");

    await expect(
      ToolImportRunExecutor.startImport({
        runId: new ObjectID(runId),
        projectId: PROJECT_ID,
        props: PROPS,
        selection: { selectedKeys: ["Rocket:1"] },
      }),
    ).rejects.toThrow(BadDataException);

    expect(runs.get(runId)["status"]).toBe(ToolImportRunStatus.ReadyToReview);
  });

  test("a preview can be discarded by the person who read it, which forgets what was read", async () => {
    const runId: string = readyRun();

    await ToolImportRunExecutor.cancel({
      runId: new ObjectID(runId),
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Cancelled,
      snapshot: null,
      apiKey: null,
    });

    await expect(
      ToolImportRunExecutor.cancel({
        runId: new ObjectID(runId),
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    ).rejects.toThrow("Only a preview that was not started can be discarded.");
  });

  test("the preview is worked out for the person looking, from what was read", async () => {
    const plan: ToolImportPlan = {} as ToolImportPlan;
    (ToolImportProjectStateReader.readState as jest.Mock).mockResolvedValue(
      projectState(),
    );
    (ToolImportProjectStateReader.readAccess as jest.Mock).mockResolvedValue(
      fullAccess(),
    );

    const runId: string = readyRun();
    const result: ToolImportPlan = await ToolImportRunExecutor.getPlan({
      run: runs.toModel(runs.get(runId)),
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(plan).toBeDefined();
    expect(
      result.items.map((item: { key: string }): string => {
        return item.key;
      }),
    ).toEqual(["Person:alice"]);
    // What the person may do is asked only for what Opsgenie brings over.
    expect(ToolImportProjectStateReader.readAccess).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: PROPS,
      kinds: getToolImportSourceDefinition(ToolImportSource.OpsGenie).kinds,
    });
    expect(ToolImportProjectStateReader.readState).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      source: ToolImportSource.OpsGenie,
    });
  });
});

describe("ToolImportRunExecutor: the worker imports, as the person", () => {
  const TEAM_ID: string = ObjectID.generate().toString();
  const REPORT: ToolImportReport = {
    items: [
      {
        key: "Person:alice",
        kind: ToolImportResourceKind.Person,
        sourceId: "alice",
        name: "ALICE",
        outcome: ToolImportOutcome.Invited,
        recordIds: [],
        notes: [],
      },
    ],
  };

  function importingRun(inviteTeamId: string): string {
    return runs.add({
      source: ToolImportSource.OpsGenie,
      status: ToolImportRunStatus.Importing,
      snapshot: snapshot({ people: [person("alice")] }),
      selection: { selectedKeys: ["Person:alice"], inviteTeamId: inviteTeamId },
    });
  }

  beforeEach(() => {
    (
      WorkspaceActionAuthorization.getProjectMemberProps as jest.Mock
    ).mockResolvedValue(PROPS);
    (ToolImportProjectStateReader.readState as jest.Mock).mockResolvedValue(
      projectState(),
    );
    (ToolImportProjectStateReader.readAccess as jest.Mock).mockResolvedValue(
      fullAccess({ inviteTeams: [{ id: TEAM_ID, name: "Members" }] }),
    );
    (ToolImportApplier.apply as jest.Mock).mockResolvedValue(REPORT);
  });

  test("the person's props are read again from the database, the plan worked out again, and the report stored", async () => {
    const runId: string = importingRun(TEAM_ID);

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(
      WorkspaceActionAuthorization.getProjectMemberProps,
    ).toHaveBeenCalledWith({
      userId: expect.anything(),
      projectId: expect.anything(),
    });

    const input: Record<string, unknown> = (
      ToolImportApplier.apply as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(input["props"]).toBe(PROPS);
    expect(input["selection"]).toEqual({
      selectedKeys: ["Person:alice"],
      inviteTeamId: TEAM_ID,
    });
    expect((input["plan"] as ToolImportPlan).items[0]!.key).toBe(
      "Person:alice",
    );

    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Completed,
      report: REPORT,
      snapshot: null,
      progress: null,
    });
    expect(runs.get(runId)["completedAt"]).toBeInstanceOf(Date);
  });

  test("a team the person may no longer invite to invites nobody", async () => {
    const runId: string = importingRun(ObjectID.generate().toString());

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const input: Record<string, unknown> = (
      ToolImportApplier.apply as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect((input["selection"] as JSONObject)["inviteTeamId"]).toBeNull();
  });

  test("someone who left the project since is not imported for", async () => {
    (
      WorkspaceActionAuthorization.getProjectMemberProps as jest.Mock
    ).mockRejectedValue(new NotAuthorizedException("not a member"));

    const runId: string = importingRun(TEAM_ID);

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(ToolImportApplier.apply).not.toHaveBeenCalled();
    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Failed,
      error:
        "You are no longer a member of this project, so the import was stopped.",
      snapshot: null,
    });
  });

  test("an import that throws is failed with the reason", async () => {
    (ToolImportApplier.apply as jest.Mock).mockRejectedValue(
      new Error("database went away"),
    );

    const runId: string = importingRun(TEAM_ID);

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(runs.get(runId)).toMatchObject({
      status: ToolImportRunStatus.Failed,
      error: "database went away",
    });
  });
});

describe("ToolImportRunExecutor.sweepStaleRuns", () => {
  test("runs a dead worker left behind are failed, keys cleared; previews nobody started expire", async () => {
    const now: Date = new Date();
    const old: Date = new Date(now.getTime() - TOOL_IMPORT_STALE_RUN_MS - 1000);

    const stuckRead: string = runs.add({
      status: ToolImportRunStatus.Reading,
      apiKey: "a-key",
      updatedAt: old,
    });
    const stuckImport: string = runs.add({
      status: ToolImportRunStatus.Importing,
      updatedAt: old,
    });
    const freshRead: string = runs.add({
      status: ToolImportRunStatus.Reading,
      apiKey: "b-key",
      updatedAt: now,
    });
    const oldPreview: string = runs.add({
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: snapshot(),
      updatedAt: new Date(
        now.getTime() - TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS - 1000,
      ),
    });
    const freshPreview: string = runs.add({
      status: ToolImportRunStatus.ReadyToReview,
      updatedAt: now,
    });

    await ToolImportRunExecutor.sweepStaleRuns(now);

    expect(runs.get(stuckRead)).toMatchObject({
      status: ToolImportRunStatus.Failed,
      apiKey: null,
      error: "The read stopped before it finished. Read the tool again.",
    });
    expect(runs.get(stuckImport)).toMatchObject({
      status: ToolImportRunStatus.Failed,
      error:
        "The import stopped before it finished. What it created is kept: run the import again to bring over the rest.",
    });
    expect(runs.get(freshRead)).toMatchObject({
      status: ToolImportRunStatus.Reading,
      apiKey: "b-key",
    });
    expect(runs.get(oldPreview)).toMatchObject({
      status: ToolImportRunStatus.Expired,
      snapshot: null,
    });
    expect(runs.get(freshPreview)["status"]).toBe(
      ToolImportRunStatus.ReadyToReview,
    );
  });
});

describe("ToolImportRunExecutor: small rules", () => {
  test("a failure's message never carries the key", () => {
    expect(
      ToolImportRunExecutor.describeFailure(
        new Error(`refused abcd-1234-efgh`),
        "abcd-1234-efgh",
      ),
    ).toBe("refused [REDACTED]");
  });

  test("a preview is old after a day", () => {
    const run: ToolImportRun = new ToolImportRun();
    run.updatedAt = new Date(
      Date.now() - TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS + 60_000,
    );
    expect(ToolImportRunExecutor.isReviewExpired(run)).toBe(false);

    run.updatedAt = new Date(
      Date.now() - TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS - 60_000,
    );
    expect(ToolImportRunExecutor.isReviewExpired(run)).toBe(true);
  });

  test("a stored snapshot that is not one reads as nothing", () => {
    const run: ToolImportRun = new ToolImportRun();
    run.snapshot = { people: "x" } as unknown as JSONObject;
    expect(ToolImportRunExecutor.readSnapshot(run)).toBeNull();

    run.snapshot = snapshot() as unknown as JSONObject;
    expect(ToolImportRunExecutor.readSnapshot(run)).not.toBeNull();
  });
});

describe("ToolImportRunExecutor: uptime and status page tools read over their API", () => {
  test("an UptimeRobot run reads only its own host, at its pace; what was read is stored and the key cleared", async () => {
    const api: FixtureApi = uptimeRobotApi();
    ToolImportRunExecutor.transportFactory = (hosts: Array<string>) => {
      expect(hosts).toEqual(["api.uptimerobot.com"]);
      return api.transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.UptimeRobot,
      status: ToolImportRunStatus.Reading,
      apiKey: UPTIMEROBOT_KEY,
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    const row: Record<string, unknown> = runs.get(runId);
    const read: ToolImportSnapshot = row["snapshot"] as ToolImportSnapshot;

    expect(row["status"]).toBe(ToolImportRunStatus.ReadyToReview);
    expect(row["apiKey"]).toBeNull();
    expect(row["accountName"]).toBe("ops@acme.com");
    expect(read.monitors).toHaveLength(12);
    expect(read.statusPages).toHaveLength(3);
    expect(JSON.stringify(read)).not.toContain(UPTIMEROBOT_KEY);
    // UptimeRobot allows ten requests a minute: one every six seconds, less the time each took.
    expect(waits.length).toBeGreaterThan(0);

    for (const wait of waits) {
      expect(wait).toBeGreaterThan(5000);
      expect(wait).toBeLessThanOrEqual(6000);
    }
  });

  test("the read's progress names monitors, then status pages", async () => {
    ToolImportRunExecutor.transportFactory = () => {
      return uptimeRobotApi().transport;
    };

    const runId: string = runs.add({
      source: ToolImportSource.UptimeRobot,
      status: ToolImportRunStatus.Reading,
      apiKey: UPTIMEROBOT_KEY,
    });

    await ToolImportRunExecutor.executeRun(new ObjectID(runId));

    expect(
      runs.updates
        .filter((update: { data: Record<string, unknown> }): boolean => {
          return Boolean(update.data["progress"]);
        })
        .map((update: { data: Record<string, unknown> }): unknown => {
          return (update.data["progress"] as JSONObject)["kind"];
        }),
    ).toEqual([
      ToolImportResourceKind.Monitor,
      ToolImportResourceKind.StatusPage,
    ]);
  });

  test("a tool read from a file is never read with a key", () => {
    expect(() => {
      ToolImportRunExecutor.validateReadRequest({
        source: ToolImportSource.UptimeKuma,
        region: "",
        apiKey: "anything",
      });
    }).toThrow("Uptime Kuma is read from a file. Choose the file to read.");
  });
});

describe("ToolImportRunExecutor.startUpload: a file the person uploads", () => {
  async function upload(
    data: Partial<{
      source: unknown;
      fileName: unknown;
      content: unknown;
    }> = {},
  ): Promise<ObjectID> {
    return await ToolImportRunExecutor.startUpload({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: ToolImportSource.UptimeKuma,
      fileName: "backup.json",
      content: kumaBackupText(),
      ...data,
    });
  }

  async function refusal(
    data: Partial<{ source: unknown; fileName: unknown; content: unknown }>,
  ): Promise<string> {
    try {
      await upload(data);
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return (error as Error).message;
    }

    throw new Error("The upload was taken, not refused.");
  }

  test("a backup is read at once into a preview of the person's, with no key and no job; the file itself is not kept", async () => {
    const runId: ObjectID = await upload();
    const row: Record<string, unknown> = runs.get(runId);
    const read: ToolImportSnapshot = row["snapshot"] as ToolImportSnapshot;

    expect(row).toMatchObject({
      source: ToolImportSource.UptimeKuma,
      status: ToolImportRunStatus.ReadyToReview,
      accountName: "backup.json",
    });
    expect(String(row["createdByUserId"])).toBe(USER_ID.toString());
    expect(row["apiKey"]).toBeUndefined();
    expect(read.monitors!.length).toBeGreaterThan(5);
    expect(Queue.addJob).not.toHaveBeenCalled();

    const stored: string = JSON.stringify(row);

    for (const secret of KUMA_SECRETS) {
      expect(stored).not.toContain(secret);
    }

    expect(stored).not.toContain("notificationList");
    expect(Semaphore.release).toHaveBeenCalled();
  });

  test("a file's name keeps only its name: no folders, nothing unprintable, cut to length", async () => {
    expect(cleanUploadFileName("C:\\Users\\me\\Downloads\\backup.json")).toBe(
      "backup.json",
    );
    expect(cleanUploadFileName("/home/me/kuma\u0000\u0007backup.json")).toBe(
      "kumabackup.json",
    );
    expect(cleanUploadFileName(`${"a".repeat(500)}.json`)).toHaveLength(
      TOOL_IMPORT_MAX_FILE_NAME_LENGTH,
    );
    expect(cleanUploadFileName(42)).toBe("");

    const runId: ObjectID = await upload({
      fileName: "../../etc/backup.json",
    });
    expect(runs.get(runId)["accountName"]).toBe("backup.json");
  });

  test("a tool read with a key, an unknown tool, no file and a file over 10 MB are refused before anything is read", async () => {
    expect(await refusal({ source: ToolImportSource.UptimeRobot })).toBe(
      "This tool is read with its API key, not from a file.",
    );
    expect(await refusal({ source: "Nagios" })).toBe(
      "Choose a tool to import from.",
    );
    expect(await refusal({ content: "   " })).toBe("Choose the file to read.");
    expect(await refusal({ content: { monitorList: [] } })).toBe(
      "Choose the file to read.",
    );
    expect(
      await refusal({
        content: `${kumaBackupText()}${" ".repeat(TOOL_IMPORT_MAX_UPLOAD_BYTES)}`,
      }),
    ).toBe(
      "This file is larger than 10 MB, which is more than an import reads.",
    );
    expect(runs.rows.size).toBe(0);
  });

  test("a file that is not Uptime Kuma's is refused with what to upload, and no run is made", async () => {
    expect(
      await refusal({ content: "name,url\nHome,https://example.com" }),
    ).toBe(
      "This is not an Uptime Kuma backup or metrics file. Upload the JSON file Settings > Backup > Export gives, or the page /metrics shows.",
    );
    expect(runs.rows.size).toBe(0);
    expect(Semaphore.lock).not.toHaveBeenCalled();
  });

  test("only one import of a project at a time: an upload waits for one that is running", async () => {
    runs.add({
      source: ToolImportSource.OpsGenie,
      status: ToolImportRunStatus.Importing,
      createdByUserId: OTHER_USER_ID,
    });

    expect(await refusal({})).toBe(
      "Another import is running in this project. Wait for it to finish, then try again.",
    );
    expect(Semaphore.release).toHaveBeenCalled();
  });

  test("an upload discards the person's earlier previews, not anyone else's", async () => {
    const mine: string = runs.add({
      source: ToolImportSource.UptimeRobot,
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: snapshot(),
    });
    const theirs: string = runs.add({
      source: ToolImportSource.UptimeRobot,
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: snapshot(),
      createdByUserId: OTHER_USER_ID,
    });

    await upload();

    expect(runs.get(mine)).toMatchObject({
      status: ToolImportRunStatus.Cancelled,
      snapshot: null,
    });
    expect(runs.get(theirs)["status"]).toBe(ToolImportRunStatus.ReadyToReview);
  });
});

describe("ToolImportRunExecutor: subscribers need the person's word", () => {
  function readyRun(): string {
    return runs.add({
      source: ToolImportSource.BetterStack,
      status: ToolImportRunStatus.ReadyToReview,
      snapshot: snapshot({ source: ToolImportSource.BetterStack }),
    });
  }

  test("subscribers ticked without it are refused before anything starts", async () => {
    const runId: string = readyRun();

    for (const consent of [undefined, false, "true", 1]) {
      await expect(
        ToolImportRunExecutor.startImport({
          runId: new ObjectID(runId),
          projectId: PROJECT_ID,
          props: PROPS,
          selection: {
            selectedKeys: ["StatusPage:p1", "StatusPageSubscriber:s1"],
            inviteTeamId: null,
            subscribersConsent: consent,
          },
        }),
      ).rejects.toThrow(
        "Confirm that you may move the subscribers you ticked, or untick them.",
      );
    }

    expect(runs.get(runId)["status"]).toBe(ToolImportRunStatus.ReadyToReview);
    expect(Queue.addJob).not.toHaveBeenCalled();
  });

  test("with it, the selection keeps it for the import", async () => {
    const runId: string = readyRun();

    await ToolImportRunExecutor.startImport({
      runId: new ObjectID(runId),
      projectId: PROJECT_ID,
      props: PROPS,
      selection: {
        selectedKeys: ["StatusPageSubscriber:s1"],
        inviteTeamId: null,
        subscribersConsent: true,
      },
    });

    expect(runs.get(runId)["selection"]).toEqual({
      selectedKeys: ["StatusPageSubscriber:s1"],
      inviteTeamId: null,
      subscribersConsent: true,
    });
  });

  test("ticking no subscriber needs no word", async () => {
    const runId: string = readyRun();

    await ToolImportRunExecutor.startImport({
      runId: new ObjectID(runId),
      projectId: PROJECT_ID,
      props: PROPS,
      selection: { selectedKeys: ["StatusPage:p1"], inviteTeamId: null },
    });

    expect(runs.get(runId)["status"]).toBe(ToolImportRunStatus.Importing);
  });
});
