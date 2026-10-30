let mockBillingEnabled: boolean = true;

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * Only the billing flag is swapped, as an accessor, so one file covers a
 * Cloud install (billing on) and a self-hosted one (off) whatever
 * BILLING_ENABLED the suite runs with.
 */
jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ProjectService from "../../../../Server/Services/ProjectService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import PlanDowngradeOwnerNotice from "../../../../Server/Utils/Billing/PlanDowngradeOwnerNotice";
import Encryption from "../../../../Server/Utils/Encryption";
import HuntressConnectionsToWorkflows, {
  BACKFILL_REPORT_ID_SQL,
  DEFAULT_WORKFLOW_NAME,
  HUNTRESS_WORKFLOW_PLAN,
  HuntressMoveSummary,
  LEGACY_CONNECTIONS_SQL,
  LEGACY_LABELS_SQL,
  LEGACY_POLICIES_SQL,
  LEGACY_REPORTS_SQL,
  LEGACY_TABLE_SQL,
  LegacyHuntressConnectionRow,
  LegacyHuntressReportRow,
  LegacyQuery,
  MOVED_WORKFLOW_DESCRIPTION,
  PROJECT_WORKFLOW_NAMES_SQL,
  getFreeWorkflowName,
  getPlanNoticeHtml,
  getPlanNoticeSubject,
  getWorkflowOptions,
  readLegacySigningSecret,
} from "../../../../Server/Utils/Huntress/HuntressConnectionsToWorkflows";
import {
  HUNTRESS_DELIVERY_CACHE_NAMESPACE,
  HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS,
} from "../../../../Server/Utils/Huntress/HuntressWebhookHandler";
import URL from "../../../../Types/API/URL";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import HuntressSeverity from "../../../../Types/Huntress/HuntressSeverity";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import { ConditionOperator } from "../../../../Types/Workflow/Components/Condition";
import { PAGE_ARGUMENT_IDS } from "../../../../Types/Workflow/Components/OnCallPageSettings";
import { HuntressTriggerSetting } from "../../../../Types/Workflow/HuntressTrigger";
import { HUNTRESS_REPORT_ID_CUSTOM_FIELD } from "../../../../Types/Workflow/Templates";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { drawHuntressSigningSecret } from "../../../Types/Huntress/HuntressWebhookFixtures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Each Huntress connection becomes the workflow that does what it did, so
 * nobody stops being paged when Huntress moves to workflows: same id (its
 * old page forwards there), same address (the workflow's key is the
 * connection's id), same signing secret, on, with the connection's
 * settings in the Huntress template's graph. Its incidents get their
 * report's number, which later events find them by, and the deliveries it
 * applied in the last week are remembered so a retry starts nothing twice.
 *
 * The legacy tables are a fake that answers the move's own statements;
 * WorkflowService, ProjectService and GlobalCache are spied on. The same
 * move runs against a migrated Postgres in HuntressPostgres.test.ts.
 */

const PROJECT_A: string = "10000000-0000-4000-8000-000000000001";
const PROJECT_B: string = "10000000-0000-4000-8000-000000000002";
const CONNECTION_1: string = "20000000-0000-4000-8000-000000000001";
const CONNECTION_2: string = "20000000-0000-4000-8000-000000000002";
const CONNECTION_3: string = "20000000-0000-4000-8000-000000000003";
const POLICY_1: string = "30000000-0000-4000-8000-000000000001";
const POLICY_2: string = "30000000-0000-4000-8000-000000000002";
const LABEL_1: string = "40000000-0000-4000-8000-000000000001";
const SEVERITY_CRITICAL: string = "50000000-0000-4000-8000-000000000001";
const SEVERITY_LOW: string = "50000000-0000-4000-8000-000000000003";
const INCIDENT_1: string = "60000000-0000-4000-8000-000000000001";
const INCIDENT_2: string = "60000000-0000-4000-8000-000000000002";
const USER_1: string = "70000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-15T12:00:00.000Z");

const random: SeededRandom = seededRandom(4116);

function svixSecret(): string {
  return drawHuntressSigningSecret(random);
}

function connectionRow(
  overrides: Partial<LegacyHuntressConnectionRow> = {},
): LegacyHuntressConnectionRow {
  return {
    _id: CONNECTION_1,
    projectId: PROJECT_A,
    name: "Acme MSP",
    signingSecret: null,
    pageOnCallFor: HuntressSeverity.High,
    criticalIncidentSeverityId: null,
    highIncidentSeverityId: null,
    lowIncidentSeverityId: null,
    watchedOrganizations: null,
    resolveIncidentWhenReportCloses: true,
    lastEventReceivedAt: null,
    lastError: null,
    lastErrorAt: null,
    createdByUserId: null,
    ...overrides,
  };
}

// The legacy tables, and the Workflow and Incident rows the move reads and writes.
interface FakeDatabase {
  hasConnectionTable: boolean;
  hasReportTable: boolean;
  connections: Array<LegacyHuntressConnectionRow>;
  policies: Record<string, Array<string>>;
  labels: Record<string, Array<string>>;
  reports: Record<string, Array<LegacyHuntressReportRow>>;
  workflowNames: Record<string, Array<string>>;
  incidents: Map<string, { projectId: string; customFields: JSONObject }>;
  statements: Array<string>;
}

let database: FakeDatabase;

function fakeQuery(): LegacyQuery {
  return async (sql: string, parameters: Array<unknown> = []) => {
    database.statements.push(sql);

    switch (sql) {
      case LEGACY_TABLE_SQL:
        return [
          {
            hasConnectionTable: database.hasConnectionTable,
            hasReportTable: database.hasReportTable,
          },
        ];
      case LEGACY_CONNECTIONS_SQL:
        return database.connections;
      case LEGACY_POLICIES_SQL:
        return (database.policies[String(parameters[0])] || []).map(
          (id: string) => {
            return { onCallDutyPolicyId: id };
          },
        );
      case LEGACY_LABELS_SQL:
        return (database.labels[String(parameters[0])] || []).map(
          (id: string) => {
            return { labelId: id };
          },
        );
      case PROJECT_WORKFLOW_NAMES_SQL:
        return (database.workflowNames[String(parameters[0])] || []).map(
          (name: string) => {
            return { name };
          },
        );
      case LEGACY_REPORTS_SQL:
        return database.reports[String(parameters[0])] || [];
      case BACKFILL_REPORT_ID_SQL: {
        const [reportId, incidentId, projectId] = parameters as Array<string>;
        const incident:
          | { projectId: string; customFields: JSONObject }
          | undefined = database.incidents.get(incidentId!);

        if (
          !incident ||
          incident.projectId !== projectId ||
          HUNTRESS_REPORT_ID_CUSTOM_FIELD in incident.customFields
        ) {
          return [[], 0];
        }

        incident.customFields[HUNTRESS_REPORT_ID_CUSTOM_FIELD] = reportId!;
        return [[], 1];
      }
      default:
        throw new Error(`Unexpected statement: ${sql}`);
    }
  };
}

let existingWorkflows: Set<string>;
let created: Array<Workflow>;
let createFailures: Map<string, Error>;
let columnUpdates: Array<{ id: string; data: JSONObject }>;
let remembered: Array<{ key: string; value: string; seconds: number }>;
let plans: Map<string, PlanType | null>;
let owners: Map<string, Array<User>>;
let projectNames: Map<string, string | Error>;
let billingLinks: boolean;
let emails: Array<{ projectId: string; subject: string; message: string }>;

// Where the owners' email links to: the project's Billing page.
function billingLinkOf(projectId: string): string {
  return `https://oneuptime.example/dashboard/${projectId}/settings/billing`;
}

function owner(email: string): User {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = email as never;
  return user;
}

async function moveAll(): Promise<HuntressMoveSummary> {
  return await HuntressConnectionsToWorkflows.moveAll(fakeQuery());
}

// A node of a created workflow's graph, by its component id.
function node(workflow: Workflow, componentId: string): JSONObject | undefined {
  const nodes: Array<JSONObject> = (workflow.graph?.["nodes"] ||
    []) as Array<JSONObject>;

  return nodes.find((candidate: JSONObject): boolean => {
    return (candidate["data"] as JSONObject)["id"] === componentId;
  });
}

function argumentsOf(workflow: Workflow, componentId: string): JSONObject {
  return ((node(workflow, componentId)?.["data"] as JSONObject | undefined)?.[
    "arguments"
  ] || {}) as JSONObject;
}

// The labels the step that opens the incident gives it: the organization's, then the connection's.
function incidentLabels(workflow: Workflow): Array<string> {
  return String(
    argumentsOf(workflow, "incident-from-another-tool-1")["labels"],
  ).split(", ");
}

beforeEach(() => {
  mockBillingEnabled = true;

  database = {
    hasConnectionTable: true,
    hasReportTable: true,
    connections: [],
    policies: {},
    labels: {},
    reports: {},
    workflowNames: {},
    incidents: new Map(),
    statements: [],
  };

  existingWorkflows = new Set();
  created = [];
  createFailures = new Map();
  columnUpdates = [];
  remembered = [];
  plans = new Map();
  owners = new Map();
  projectNames = new Map([
    [PROJECT_A, "Acme"],
    [PROJECT_B, "Globex"],
  ]);
  billingLinks = true;
  emails = [];

  jest
    .spyOn(WorkflowService, "findOneById")
    .mockImplementation((async (findBy: {
      id: ObjectID;
      props: JSONObject;
    }): Promise<Workflow | null> => {
      expect(findBy.props).toEqual({ isRoot: true });

      if (!existingWorkflows.has(findBy.id.toString())) {
        return null;
      }

      const workflow: Workflow = new Workflow();
      workflow._id = findBy.id.toString();
      workflow.name = "Moved before";
      return workflow;
    }) as never);

  jest.spyOn(WorkflowService, "create").mockImplementation((async (createBy: {
    data: Workflow;
    props: JSONObject;
  }): Promise<Workflow> => {
    expect(createBy.props).toEqual({ isRoot: true });

    const failure: Error | undefined = createFailures.get(
      createBy.data.id!.toString(),
    );

    if (failure) {
      throw failure;
    }

    created.push(createBy.data);
    return createBy.data;
  }) as never);

  jest
    .spyOn(WorkflowService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (updateBy: {
      id: ObjectID;
      data: JSONObject;
      skipUpdateDateColumn?: boolean;
    }): Promise<void> => {
      expect(updateBy.skipUpdateDateColumn).toBe(true);
      columnUpdates.push({ id: updateBy.id.toString(), data: updateBy.data });
    }) as never);

  jest.spyOn(GlobalCache, "setStringIfNotExists").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
    options?: { expiresInSeconds?: number },
  ): Promise<boolean> => {
    remembered.push({
      key: `${namespace}-${key}`,
      value,
      seconds: options?.expiresInSeconds || 0,
    });
    return true;
  }) as never);

  jest.spyOn(ProjectService, "getCurrentPlan").mockImplementation((async (
    projectId: ObjectID,
  ) => {
    return {
      plan: plans.has(projectId.toString())
        ? plans.get(projectId.toString())
        : PlanType.Growth,
      isSubscriptionUnpaid: false,
    };
  }) as never);

  jest.spyOn(ProjectService, "getOwners").mockImplementation((async (
    projectId: ObjectID,
  ): Promise<Array<User>> => {
    return owners.get(projectId.toString()) || [owner("owner@acme.example")];
  }) as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async (findBy: {
    id: ObjectID;
    select: JSONObject;
    props: JSONObject;
  }): Promise<Project | null> => {
    expect(findBy.select).toEqual({ name: true });
    expect(findBy.props).toEqual({ isRoot: true });

    const name: string | Error | undefined = projectNames.get(
      findBy.id.toString(),
    );

    if (name instanceof Error) {
      throw name;
    }

    if (name === undefined) {
      return null;
    }

    const project: Project = new Project();
    project._id = findBy.id.toString();
    project.name = name;
    return project;
  }) as never);

  // The dashboard's address is the server's; the link is built from it.
  jest
    .spyOn(PlanDowngradeOwnerNotice, "getSettingsLink")
    .mockImplementation((projectId: ObjectID): URL | null => {
      return billingLinks
        ? URL.fromString(billingLinkOf(projectId.toString()))
        : null;
    });

  jest
    .spyOn(ProjectService, "sendEmailToOwnersAndWait")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      owners: Array<User>;
      subject: string;
      message: string;
    }): Promise<number> => {
      emails.push({
        projectId: data.projectId.toString(),
        subject: data.subject,
        message: data.message,
      });
      return data.owners.length;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an install without Huntress connections", () => {
  test("never had the tables: nothing is read or written", async () => {
    database.hasConnectionTable = false;

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary).toEqual({
      moved: 0,
      alreadyMoved: 0,
      failed: 0,
      incidentsLinked: 0,
      ownersTold: 0,
    });
    expect(database.statements).toEqual([LEGACY_TABLE_SQL]);
    expect(created).toHaveLength(0);
  });

  test("has the tables but no connection: nothing is written", async () => {
    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.moved).toBe(0);
    expect(created).toHaveLength(0);
  });

  test("reads only connections that are not deleted, oldest id first", () => {
    expect(LEGACY_CONNECTIONS_SQL).toContain('WHERE "deletedAt" IS NULL');
    expect(LEGACY_CONNECTIONS_SQL).toContain('ORDER BY "_id"');
    expect(LEGACY_REPORTS_SQL).toContain('"deletedAt" IS NULL');
  });
});

describe("a connection becomes the workflow that does what it did", () => {
  test("same id, same address, same secret, on, named as it was", async () => {
    const secret: string = svixSecret();

    database.connections = [
      connectionRow({
        signingSecret: await Encryption.encrypt(secret),
        createdByUserId: USER_1,
      }),
    ];
    database.policies[CONNECTION_1] = [POLICY_1, POLICY_2];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.moved).toBe(1);
    expect(created).toHaveLength(1);

    const workflow: Workflow = created[0]!;

    expect(workflow.id?.toString()).toBe(CONNECTION_1);
    expect(workflow.projectId?.toString()).toBe(PROJECT_A);
    expect(workflow.name).toBe("Acme MSP");
    expect(workflow.description).toBe(MOVED_WORKFLOW_DESCRIPTION);
    expect(workflow.isEnabled).toBe(true);
    expect(workflow.webhookSecretKey).toBe(CONNECTION_1);
    expect(workflow.webhookSigningSecret).toBe(secret);
    expect(workflow.createdByUserId?.toString()).toBe(USER_1);
  });

  test("its graph is the Huntress template's: the trigger, the step that keeps the incident, the policies it paged", async () => {
    database.connections = [connectionRow()];
    database.policies[CONNECTION_1] = [POLICY_1, POLICY_2];

    await moveAll();

    const workflow: Workflow = created[0]!;
    const trigger: JSONObject | undefined = node(workflow, "huntress-1");

    expect((trigger?.["data"] as JSONObject)["metadataId"]).toBe(
      ComponentID.HuntressIncidentReport,
    );
    expect(
      (node(workflow, "incident-from-another-tool-1")?.["data"] as JSONObject)[
        "metadataId"
      ],
    ).toBe(ComponentID.IncidentFromAnotherTool);
    expect(
      argumentsOf(workflow, "page-on-call-policy-1")[
        PAGE_ARGUMENT_IDS.onCallPolicies
      ],
    ).toEqual([POLICY_1, POLICY_2]);
    // Its trigger has no settings of its own: every organization, ranked severities.
    expect(argumentsOf(workflow, "huntress-1")).toEqual({});
  });

  test.each([
    [
      HuntressSeverity.Critical,
      ConditionOperator.EqualTo,
      HuntressSeverity.Critical,
    ],
    [HuntressSeverity.High, ConditionOperator.NotEqualTo, HuntressSeverity.Low],
  ])(
    "a connection that paged for %s reports and up pages for the same ones",
    async (
      pageOnCallFor: HuntressSeverity,
      operator: ConditionOperator,
      value: string,
    ) => {
      database.connections = [connectionRow({ pageOnCallFor })];
      database.policies[CONNECTION_1] = [POLICY_1];

      await moveAll();

      const condition: JSONObject = argumentsOf(created[0]!, "if-page-1");

      expect(condition["operator"]).toBe(operator);
      expect(condition["input-2"]).toBe(value);
    },
  );

  test("a connection that paged for every report pages with no condition", async () => {
    database.connections = [connectionRow({ pageOnCallFor: "low" })];
    database.policies[CONNECTION_1] = [POLICY_1];

    await moveAll();

    expect(node(created[0]!, "if-page-1")).toBeUndefined();
    expect(node(created[0]!, "page-on-call-policy-1")).toBeDefined();
  });

  test("a connection that paged nobody opens incidents without a Page step", async () => {
    database.connections = [connectionRow()];

    await moveAll();

    expect(node(created[0]!, "page-on-call-policy-1")).toBeUndefined();
    expect(node(created[0]!, "if-page-1")).toBeUndefined();
    expect(node(created[0]!, "incident-from-another-tool-1")).toBeDefined();
  });

  test("its labels go on every incident, beside the organization's", async () => {
    database.connections = [connectionRow()];
    database.labels[CONNECTION_1] = [LABEL_1];

    await moveAll();

    const labels: Array<string> = incidentLabels(created[0]!);

    expect(labels).toHaveLength(2);
    expect(labels[0]).toBe(
      "{{local.components.huntress-1.returnValues.organization-label-id}}",
    );
    expect(labels[1]).toBe(LABEL_1);
  });

  test("its organizations and the incident severities it opened at become the trigger's settings", async () => {
    database.connections = [
      connectionRow({
        watchedOrganizations: "Acme Corp\n4",
        criticalIncidentSeverityId: SEVERITY_CRITICAL,
        lowIncidentSeverityId: SEVERITY_LOW,
      }),
    ];

    await moveAll();

    expect(argumentsOf(created[0]!, "huntress-1")).toEqual({
      [HuntressTriggerSetting.Organizations]: "Acme Corp\n4",
      [HuntressTriggerSetting.CriticalIncidentSeverity]: SEVERITY_CRITICAL,
      [HuntressTriggerSetting.LowIncidentSeverity]: SEVERITY_LOW,
    });
  });

  test("a connection that only noted a close notes it, and does not resolve", async () => {
    database.connections = [
      connectionRow({ resolveIncidentWhenReportCloses: false }),
    ];

    await moveAll();

    expect(
      argumentsOf(created[0]!, "incident-from-another-tool-1")[
        "note-instead-of-resolving"
      ],
    ).toBe(true);
  });

  test("when Huntress last reached it, and why it last refused, carry over", async () => {
    database.connections = [
      connectionRow({
        lastEventReceivedAt: "2026-10-14T08:00:00.000Z",
        lastError: "The request's signature does not match the signing secret.",
        lastErrorAt: new Date("2026-10-14T09:00:00.000Z"),
      }),
    ];

    await moveAll();

    expect(columnUpdates).toEqual([
      {
        id: CONNECTION_1,
        data: {
          lastWebhookRequestAt: new Date("2026-10-14T08:00:00.000Z"),
          lastWebhookError:
            "The request's signature does not match the signing secret.",
          lastWebhookErrorAt: new Date("2026-10-14T09:00:00.000Z"),
        },
      },
    ]);
  });

  test("a connection Huntress never reached writes nothing more", async () => {
    database.connections = [connectionRow()];

    await moveAll();

    expect(columnUpdates).toHaveLength(0);
  });

  test("a name another workflow of the project has gets a number; another project's does not count", async () => {
    database.connections = [connectionRow({ name: "Huntress" })];
    database.workflowNames[PROJECT_A] = ["huntress", "Huntress (2)"];
    database.workflowNames[PROJECT_B] = ["Huntress (3)"];

    await moveAll();

    expect(created[0]!.name).toBe("Huntress (3)");
  });
});

describe("what the move cannot do, it leaves as it was", () => {
  test("a connection moved before is not copied again, and its reports are still carried over", async () => {
    existingWorkflows.add(CONNECTION_1);
    database.connections = [connectionRow()];
    database.reports[CONNECTION_1] = [
      {
        huntressIncidentReportId: "1234",
        incidentId: INCIDENT_1,
        appliedMessageIds: [],
        updatedAt: null,
      },
    ];
    database.incidents.set(INCIDENT_1, {
      projectId: PROJECT_A,
      customFields: {},
    });

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary).toEqual(
      expect.objectContaining({
        moved: 0,
        alreadyMoved: 1,
        incidentsLinked: 1,
      }),
    );
    expect(created).toHaveLength(0);
    // Nobody is told twice about a move done before.
    expect(emails).toHaveLength(0);
  });

  test("a workflow made first by a concurrent run counts as moved before", async () => {
    database.connections = [connectionRow()];
    createFailures.set(
      CONNECTION_1,
      Object.assign(new Error("duplicate key value"), {
        postgresErrorCode: "23505",
      }),
    );

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.alreadyMoved).toBe(1);
    expect(summary.failed).toBe(0);
  });

  test("a connection that cannot be moved is logged, and the others are", async () => {
    database.connections = [
      connectionRow({ _id: CONNECTION_1 }),
      connectionRow({ _id: CONNECTION_2, name: "Second" }),
    ];
    createFailures.set(CONNECTION_1, new Error("the database is busy"));

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary).toEqual(expect.objectContaining({ moved: 1, failed: 1 }));
    expect(
      created.map((workflow: Workflow): string => {
        return workflow.id!.toString();
      }),
    ).toEqual([CONNECTION_2]);
  });

  test("a policy or label id that is not one is left out", async () => {
    database.connections = [connectionRow()];
    database.policies[CONNECTION_1] = [POLICY_1, "not-an-id"];
    database.labels[CONNECTION_1] = ["", LABEL_1];

    await moveAll();

    expect(
      argumentsOf(created[0]!, "page-on-call-policy-1")[
        PAGE_ARGUMENT_IDS.onCallPolicies
      ],
    ).toEqual([POLICY_1]);
    expect(incidentLabels(created[0]!)).toEqual([
      "{{local.components.huntress-1.returnValues.organization-label-id}}",
      LABEL_1,
    ]);
  });
});

describe("the signing secret", () => {
  test("is decrypted, and saved as Huntress issued it", async () => {
    const secret: string = svixSecret();

    expect(
      await readLegacySigningSecret(await Encryption.encrypt(secret)),
    ).toBe(secret);
  });

  test("written before the column was encrypted, is read as it is", async () => {
    const secret: string = svixSecret();

    expect(await readLegacySigningSecret(secret)).toBe(secret);
  });

  test("that Huntress could not have issued is left unsaved: the workflow asks for one", async () => {
    expect(await readLegacySigningSecret("hello")).toBeNull();
    expect(await readLegacySigningSecret(null)).toBeNull();
    expect(await readLegacySigningSecret("")).toBeNull();

    database.connections = [connectionRow({ signingSecret: "hello" })];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.moved).toBe(1);
    expect(created[0]!.webhookSigningSecret).toBeUndefined();
  });
});

describe("the connection's reports", () => {
  test("each incident it opened gets its report's number, once, in its own project", async () => {
    database.connections = [connectionRow()];
    database.reports[CONNECTION_1] = [
      {
        huntressIncidentReportId: "1234",
        incidentId: INCIDENT_1,
        appliedMessageIds: [],
        updatedAt: null,
      },
      // Set by hand before: kept.
      {
        huntressIncidentReportId: "5678",
        incidentId: INCIDENT_2,
        appliedMessageIds: [],
        updatedAt: null,
      },
      // Skipped: it opened no incident.
      {
        huntressIncidentReportId: "9999",
        incidentId: null,
        appliedMessageIds: [],
        updatedAt: null,
      },
    ];
    database.incidents.set(INCIDENT_1, {
      projectId: PROJECT_A,
      customFields: { region: "eu" },
    });
    database.incidents.set(INCIDENT_2, {
      projectId: PROJECT_A,
      customFields: { [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: "typed" },
    });

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.incidentsLinked).toBe(1);
    expect(database.incidents.get(INCIDENT_1)!.customFields).toEqual({
      region: "eu",
      [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: "1234",
    });
    expect(
      database.incidents.get(INCIDENT_2)!.customFields[
        HUNTRESS_REPORT_ID_CUSTOM_FIELD
      ],
    ).toBe("typed");
  });

  test("the backfill only fills a report number in, and only in the connection's project", () => {
    expect(BACKFILL_REPORT_ID_SQL).toContain(
      `NOT (COALESCE("customFields", '{}'::jsonb) ? '${HUNTRESS_REPORT_ID_CUSTOM_FIELD}')`,
    );
    expect(BACKFILL_REPORT_ID_SQL).toContain('"projectId" = $3');
  });

  test("the deliveries it applied in the last week are remembered for the workflow", async () => {
    const recently: Date = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const longAgo: Date = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);

    const count: number = await HuntressConnectionsToWorkflows.carryOverReports(
      {
        connection: connectionRow(),
        query: (async (sql: string): Promise<unknown> => {
          if (sql === LEGACY_REPORTS_SQL) {
            return [
              {
                huntressIncidentReportId: "1234",
                incidentId: null,
                appliedMessageIds: ["msg_1", "msg_2", "", 7],
                updatedAt: recently,
              },
              {
                huntressIncidentReportId: "5678",
                incidentId: null,
                // As the driver may hand a json column back: text.
                appliedMessageIds: JSON.stringify(["msg_3"]),
                updatedAt: recently.toISOString(),
              },
              {
                huntressIncidentReportId: "9999",
                incidentId: null,
                appliedMessageIds: ["msg_old"],
                updatedAt: longAgo,
              },
            ];
          }

          throw new Error(`Unexpected statement: ${sql}`);
        }) as LegacyQuery,
        now: NOW,
      },
    );

    expect(count).toBe(0);
    expect(remembered).toEqual(
      ["msg_1", "msg_2", "msg_3"].map((messageId: string) => {
        return {
          key: `${HUNTRESS_DELIVERY_CACHE_NAMESPACE}-${CONNECTION_1}:${messageId}`,
          value: recently.toISOString(),
          seconds: HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS,
        };
      }),
    );
  });

  test("a delivery that cannot be remembered does not stop the move", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    database.connections = [connectionRow()];
    database.reports[CONNECTION_1] = [
      {
        huntressIncidentReportId: "1234",
        incidentId: null,
        appliedMessageIds: ["msg_1"],
        updatedAt: new Date(),
      },
    ];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.moved).toBe(1);
  });

  test("an install without the reports table moves its connections all the same", async () => {
    database.hasReportTable = false;
    database.connections = [connectionRow()];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.moved).toBe(1);
    expect(database.statements).not.toContain(LEGACY_REPORTS_SQL);
  });
});

describe("a project whose plan runs no workflows", () => {
  test("on OneUptime Cloud, its owners are told once, by email, what to change", async () => {
    plans.set(PROJECT_A, PlanType.Free);
    database.connections = [
      connectionRow({ _id: CONNECTION_1, name: "First" }),
      connectionRow({ _id: CONNECTION_2, name: "Second" }),
      connectionRow({ _id: CONNECTION_3, projectId: PROJECT_B, name: "Other" }),
    ];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.moved).toBe(3);
    expect(summary.ownersTold).toBe(1);
    expect(emails).toEqual([
      {
        projectId: PROJECT_A,
        subject: getPlanNoticeSubject("Acme"),
        message: getPlanNoticeHtml({
          projectId: new ObjectID(PROJECT_A),
          projectName: "Acme",
          plan: PlanType.Free,
          workflowName: "First",
        }),
      },
    ]);
  });

  /*
   * Read as the owner who gets it: what stopped, in which project, comes
   * first - in the subject and the first paragraph - then where to upgrade,
   * with the link and the whole path to the page (folded section included),
   * then that nothing changes in Huntress. Paragraphs are HTML breaks: the
   * email's body is HTML, where a blank line is no break at all.
   */
  test("the email says what stopped and where first, then where to upgrade, then that Huntress needs nothing", async () => {
    plans.set(PROJECT_A, PlanType.Free);
    database.connections = [connectionRow({ name: "Acme SOC" })];

    await moveAll();

    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toBe(
      "Huntress reports stopped opening incidents in Acme",
    );

    const paragraphs: Array<string> = emails[0]!.message.split(" <br/> <br/> ");

    expect(paragraphs).toEqual([
      `Huntress incident reports no longer open incidents or page anyone in Acme. Huntress is now set up with a workflow, and workflows need the ${HUNTRESS_WORKFLOW_PLAN} plan or above, but Acme is on the Free plan.`,
      `Upgrade the project in Project Settings &gt; Billing and Invoices &gt; Billing, and its Huntress reports open incidents again. <br/> <a href="${billingLinkOf(PROJECT_A)}">${billingLinkOf(PROJECT_A)}</a>`,
      "There is nothing to change in Huntress: your Huntress connection became the workflow &quot;Acme SOC&quot;, which receives Huntress&#39;s reports at the same address, signed with the same secret, and does what the connection did.",
      "Project owners get this email once.",
    ]);
    expect(emails[0]!.message).not.toContain("\n");
    expect(HUNTRESS_WORKFLOW_PLAN).toBe(PlanType.Growth);
  });

  // The email's body is HTML, written as it is: the names in it are text.
  test("a connection's name and the project's are text in the email, never markup", async () => {
    plans.set(PROJECT_A, PlanType.Free);
    projectNames.set(PROJECT_A, "<i>Acme</i>");
    database.connections = [
      connectionRow({ name: '<a href="https://evil.example">Reset</a> & co' }),
    ];

    await moveAll();

    const message: string = emails[0]!.message;

    expect(message).not.toContain('<a href="https://evil.example">');
    expect(message).not.toContain("<i>");
    expect(message).toContain(
      "&lt;a href=&quot;https://evil.example&quot;&gt;Reset&lt;/a&gt; &amp; co",
    );
    expect(message).toContain("&lt;i&gt;Acme&lt;/i&gt;");
    // Only the link this code builds is a link.
    expect(message.split("<a ")).toHaveLength(2);
    // The subject is sent as text, as it is.
    expect(emails[0]!.subject).toBe(
      "Huntress reports stopped opening incidents in <i>Acme</i>",
    );
  });

  test("without the dashboard's address, the email names the page and links nowhere", async () => {
    plans.set(PROJECT_A, PlanType.Free);
    billingLinks = false;
    database.connections = [connectionRow()];

    await moveAll();

    const message: string = emails[0]!.message;

    expect(message).toContain(
      "Upgrade the project in Project Settings &gt; Billing and Invoices &gt; Billing, and its Huntress reports open incidents again. <br/> <br/> ",
    );
    expect(message).not.toContain("<a ");
  });

  test("a project whose name cannot be read is your project, and its owners are still told", async () => {
    plans.set(PROJECT_A, PlanType.Free);
    projectNames.set(PROJECT_A, new Error("Database not connected"));
    database.connections = [connectionRow()];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.ownersTold).toBe(1);
    expect(emails[0]!.subject).toBe(
      "Huntress reports stopped opening incidents in your project",
    );
    expect(emails[0]!.message).toContain(
      "or page anyone in your project. Huntress is now set up with a workflow, and workflows need the Growth plan or above, but your project is on the Free plan.",
    );
  });

  test("on a plan that runs workflows, nobody is emailed", async () => {
    plans.set(PROJECT_A, PlanType.Growth);
    database.connections = [connectionRow()];

    await moveAll();

    expect(emails).toHaveLength(0);
  });

  test("with no owner to tell, nobody is counted as told", async () => {
    plans.set(PROJECT_A, PlanType.Free);
    owners.set(PROJECT_A, []);
    database.connections = [connectionRow()];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.ownersTold).toBe(0);
  });

  test("on a self-hosted install, which has no plans, nobody is emailed and no plan is read", async () => {
    mockBillingEnabled = false;
    plans.set(PROJECT_A, PlanType.Free);
    database.connections = [connectionRow()];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary.moved).toBe(1);
    expect(emails).toHaveLength(0);
    expect(ProjectService.getCurrentPlan).not.toHaveBeenCalled();
  });

  test("a notice that cannot be sent does not stop the move", async () => {
    plans.set(PROJECT_A, PlanType.Free);
    jest
      .spyOn(ProjectService, "sendEmailToOwnersAndWait")
      .mockRejectedValue(new Error("SMTP is down") as never);
    database.connections = [connectionRow()];

    const summary: HuntressMoveSummary = await moveAll();

    expect(summary).toEqual(
      expect.objectContaining({ moved: 1, ownersTold: 0, failed: 0 }),
    );
  });
});

describe("the pieces", () => {
  test("getFreeWorkflowName: the connection's name, or Huntress, numbered past the taken ones", () => {
    expect(getFreeWorkflowName({ name: "  Acme  ", takenNames: [] })).toBe(
      "Acme",
    );
    expect(getFreeWorkflowName({ name: null, takenNames: [] })).toBe(
      DEFAULT_WORKFLOW_NAME,
    );
    expect(getFreeWorkflowName({ name: " ", takenNames: ["Other"] })).toBe(
      "Huntress",
    );
    expect(
      getFreeWorkflowName({ name: "Acme", takenNames: ["ACME", "acme (2)"] }),
    ).toBe("Acme (3)");
  });

  test("getWorkflowOptions: an odd threshold pages for high and critical, and resolving is on unless switched off", () => {
    const options: ReturnType<typeof getWorkflowOptions> = getWorkflowOptions({
      connection: connectionRow({
        pageOnCallFor: "urgent",
        resolveIncidentWhenReportCloses: null,
        watchedOrganizations: " \n ",
        highIncidentSeverityId: "not-an-id",
      }),
      onCallPolicyIds: [],
      labelIds: [],
    });

    expect(options).toEqual({
      triggerSettings: {},
      pages: false,
      onCallPolicyIds: [],
      pageOnCallFor: HuntressSeverity.High,
      labelIds: [],
      resolveWhenClosed: true,
    });
  });
});
