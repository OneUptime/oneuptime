import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import { MAX_SEARCH_CANDIDATES } from "../../../../../Server/Utils/AI/MeaningSearch";
import {
  SEARCHED_ALERT_COLUMNS,
  SearchAlertsTool,
} from "../../../../../Server/Utils/AI/Toolbox/AlertTools";
import {
  SEARCHED_INCIDENT_COLUMNS,
  SearchIncidentsTool,
} from "../../../../../Server/Utils/AI/Toolbox/IncidentTools";
import { getToolProducts } from "../../../../../Server/Utils/AI/Toolbox/ToolProducts";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import { AIChatWidgetType } from "../../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import ProductKey from "../../../../../Types/Product/ProductKey";
import {
  keptForAudience,
  readAudienceOf,
  readAudienceProps,
} from "../../../../Helpers/ReadAudienceFixtures";

/*
 * search_incidents AND search_alerts MATCH BY MEANING (#7673).
 *
 * search_incidents matched one substring of the whole question, so "too
 * many connections" never found the incident whose root cause said
 * "connection pool exhausted". Both tools now ask for the candidates that
 * say what the question says (MeaningSearch's condition, whose SQL and
 * pattern its own suite pins), rank them by meaning and return the closest,
 * each with what it matched on. Pinned here, with the database stubbed:
 *
 *   - the retrieval query: the window, the condition naming every searched
 *     column, the newest first, at most MAX_SEARCH_CANDIDATES, read with
 *     the caller's own props;
 *   - the ranking: the paraphrase is found and comes first, each row says
 *     what it matched on, and a record about something else is left out;
 *   - permissions: the read is the caller's, so a private record or one
 *     set apart from an investigation's readers never reaches the answer
 *     (ToolboxReadsForItsCaller holds every tool to ctx.props);
 *   - the alert search is a tool of the Alerts product, offered beside
 *     query_alerts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POOL_INCIDENT: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const CERT_INCIDENT: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const PRIVATE_INCIDENT: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const SET_APART_INCIDENT: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004";
const DISK_ALERT: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const LATENCY_ALERT: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const SET_APART_ALERT: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003";

const PERSON: ToolContext = {
  projectId: PROJECT_ID,
  props: {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps,
};

function incident(data: {
  id: string;
  number: number;
  title: string;
  rootCause?: string;
  description?: string;
}): Incident {
  const row: Incident = new Incident(new ObjectID(data.id));
  row.incidentNumber = data.number;
  row.title = data.title;
  row.rootCause = data.rootCause;
  row.description = data.description;
  row.remediationNotes = "Recycled the pool.";
  row.createdAt = new Date("2026-11-01T10:00:00.000Z");

  const state: IncidentState = new IncidentState();
  state.name = "Resolved";
  row.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  row.incidentSeverity = severity;

  return row;
}

function alert(data: {
  id: string;
  number: number;
  title: string;
  rootCause?: string;
}): Alert {
  const row: Alert = new Alert(new ObjectID(data.id));
  row.alertNumber = data.number;
  row.title = data.title;
  row.rootCause = data.rootCause;
  row.createdAt = new Date("2026-11-01T10:00:00.000Z");

  const state: AlertState = new AlertState();
  state.name = "Resolved";
  row.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";
  row.alertSeverity = severity;

  const monitor: Monitor = new Monitor();
  monitor.name = "db-1 disk";
  row.monitor = monitor;

  return row;
}

const INCIDENTS: Array<Incident> = [
  incident({
    id: CERT_INCIDENT,
    number: 7,
    title: "Edge returns TLS errors",
    rootCause: "The certificate expired on the load balancer.",
  }),
  incident({
    id: POOL_INCIDENT,
    number: 3,
    title: "Checkout is down",
    rootCause: "The connection pool was exhausted on the payments database.",
  }),
  incident({
    id: PRIVATE_INCIDENT,
    number: 9,
    title: "HR payroll export: too many connections",
    rootCause: "HR only.",
  }),
  incident({
    id: SET_APART_INCIDENT,
    number: 11,
    title: "Ledger: connection pool exhausted (finance only)",
    rootCause: "Finance only.",
  }),
];

const ALERTS: Array<Alert> = [
  alert({
    id: LATENCY_ALERT,
    number: 21,
    title: "Checkout p95 latency is high",
  }),
  alert({
    id: DISK_ALERT,
    number: 20,
    title: "db-1 volume alert",
    rootCause: "No space left on device: the WAL filled the volume.",
  }),
  alert({
    id: SET_APART_ALERT,
    number: 22,
    title: "Payroll host: no space left on device (HR only)",
  }),
];

interface FindByCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
  props: DatabaseCommonInteractionProps;
}

let incidentReads: Array<FindByCall>;
let alertReads: Array<FindByCall>;

/*
 * The database, as the permission layer leaves it for each read: a private
 * incident for a person who does not own it, and records set apart from an
 * investigation's readers, never come back.
 */
beforeEach(() => {
  incidentReads = [];
  alertReads = [];

  jest.spyOn(IncidentService, "findBy").mockImplementation((async (
    findBy: FindByCall,
  ): Promise<Array<Incident>> => {
    incidentReads.push(findBy);

    return keptForAudience({
      modelType: Incident,
      rows: INCIDENTS.filter((row: Incident): boolean => {
        return (
          Boolean(findBy.props.readAudience) ||
          row.id?.toString() !== PRIVATE_INCIDENT
        );
      }),
      props: findBy.props,
      privateIds: [PRIVATE_INCIDENT],
      setApartIds: [SET_APART_INCIDENT],
    });
  }) as never);

  jest.spyOn(AlertService, "findBy").mockImplementation((async (
    findBy: FindByCall,
  ): Promise<Array<Alert>> => {
    alertReads.push(findBy);

    return keptForAudience({
      modelType: Alert,
      rows: ALERTS,
      props: findBy.props,
      setApartIds: [SET_APART_ALERT],
    });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sqlOf(condition: unknown): string {
  return (condition as FindOperator<unknown>).getSql!("Incident.title");
}

describe("search_incidents, by meaning", () => {
  test("too many connections finds the incident whose root cause says connection pool exhausted", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      { searchText: "too many connections" },
      PERSON,
    );

    expect(result.dataForLlm).toContain("Checkout is down");
    expect(result.dataForLlm).toContain("connection pool exhausted");
    expect(result.dataForLlm).not.toContain("certificate expired");
    // The person may read the ledger's too; it says the same thing.
    expect(result.rowCount).toBe(2);
  });

  test("the retrieval query: the window, every searched column by meaning, the newest first, at most a hundred, as the caller", async () => {
    await SearchIncidentsTool.execute(
      { searchText: "too many connections", createdWithinHours: 48 },
      PERSON,
    );

    expect(incidentReads).toHaveLength(1);

    const read: FindByCall = incidentReads[0]!;
    const sql: string = sqlOf(read.query["title"]);

    expect(read.query["createdAt"]).toBeDefined();
    for (const column of SEARCHED_INCIDENT_COLUMNS) {
      expect(sql).toContain(`CAST(Incident.${column} AS TEXT) ~* :`);
      expect(sql).toContain(`CAST(Incident.${column} AS TEXT) ILIKE :`);
    }
    expect(read.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(read.limit).toBe(MAX_SEARCH_CANDIDATES);
    expect(read.skip).toBe(0);
    expect(read.props).toBe(PERSON.props);
    // What is ranked is read with the candidates.
    for (const column of SEARCHED_INCIDENT_COLUMNS) {
      expect(read.select[column]).toBe(true);
    }
  });

  test("the closest come first, each saying what it matched on and how closely", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      { searchText: "connection pool exhausted on the payments database" },
      PERSON,
    );
    const lines: Array<string> = result.dataForLlm.split("\n");

    expect(lines[0]).toContain("Checkout is down");
    expect(result.dataForLlm).toContain("matchedOn");
    expect(result.dataForLlm).toContain("similarity");
    expect(result.dataForLlm).toContain("remediationNotes");
    expect(result.dataForLlm).not.toContain("Edge returns TLS errors");
  });

  test("a private incident the person does not own is never read, so never named", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      { searchText: "too many connections" },
      PERSON,
    );

    expect(result.dataForLlm).not.toContain("payroll");
    expect(result.dataForLlm).not.toContain(PRIVATE_INCIDENT);
  });

  test("an investigation's search names nothing private or set apart from its readers", async () => {
    const readers: ReadAudience = readAudienceOf({
      projectId: PROJECT_ID,
      labelledPermissions: [Permission.ProjectMember],
    });
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      { searchText: "too many connections" },
      { projectId: PROJECT_ID, props: readAudienceProps(readers) },
    );

    expect(incidentReads[0]!.props).toEqual(readAudienceProps(readers));
    expect(result.dataForLlm).toContain("Checkout is down");
    expect(result.dataForLlm).not.toContain("payroll");
    expect(result.dataForLlm).not.toContain("finance only");
    expect(result.rowCount).toBe(1);
  });

  test("where the readers are narrowed by nobody, what nobody set apart is found, but never a private incident", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      { searchText: "too many connections" },
      {
        projectId: PROJECT_ID,
        props: readAudienceProps(readAudienceOf({ projectId: PROJECT_ID })),
      },
    );

    expect(result.dataForLlm).toContain("finance only");
    expect(result.dataForLlm).not.toContain("payroll");
  });

  test("at most `limit`", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      {
        searchText: "too many connections",
        limit: 1,
      },
      {
        projectId: PROJECT_ID,
        props: readAudienceProps(readAudienceOf({ projectId: PROJECT_ID })),
      },
    );

    expect(result.rowCount).toBe(1);
  });

  test("nothing that matches says so, with what to try next", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      { searchText: "kafka consumer rebalancing storm" },
      PERSON,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("No past incident");
    expect(result.widget).toBeUndefined();
  });

  test("the list under the answer names the search", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      { searchText: "too many connections" },
      PERSON,
    );

    expect(result.widget?.type).toBe(AIChatWidgetType.IncidentList);
    expect(result.citationLabel).toContain("too many connections");
  });

  test("no searchText is an error the model can correct, read nothing", async () => {
    const result: ToolExecutionResult = await SearchIncidentsTool.execute(
      {},
      PERSON,
    );

    expect(result.dataForLlm).toContain("searchText is required");
    expect(incidentReads).toHaveLength(0);
  });
});

describe("search_alerts, by meaning", () => {
  test("disk full finds the alert that says no space left on device", async () => {
    const result: ToolExecutionResult = await SearchAlertsTool.execute(
      { searchText: "disk full" },
      PERSON,
    );

    expect(result.dataForLlm).toContain("db-1 volume alert");
    expect(result.dataForLlm).toContain("disk full");
    expect(result.dataForLlm).toContain("db-1 disk");
    expect(result.dataForLlm).not.toContain("latency");
  });

  test("the retrieval query: every searched column by meaning, the newest first, at most a hundred, as the caller", async () => {
    await SearchAlertsTool.execute({ searchText: "disk full" }, PERSON);

    const read: FindByCall = alertReads[0]!;
    const sql: string = (read.query["title"] as FindOperator<unknown>).getSql!(
      "Alert.title",
    );

    for (const column of SEARCHED_ALERT_COLUMNS) {
      expect(sql).toContain(`CAST(Alert.${column} AS TEXT) ~* :`);
    }
    expect(read.query["createdAt"]).toBeDefined();
    expect(read.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(read.limit).toBe(MAX_SEARCH_CANDIDATES);
    expect(read.props).toBe(PERSON.props);
  });

  test("an investigation's search names no alert set apart from its readers", async () => {
    const readers: ReadAudience = readAudienceOf({
      projectId: PROJECT_ID,
      labelledPermissions: [Permission.ProjectMember],
    });
    const result: ToolExecutionResult = await SearchAlertsTool.execute(
      { searchText: "no space left on device" },
      { projectId: PROJECT_ID, props: readAudienceProps(readers) },
    );

    expect(alertReads[0]!.props).toEqual(readAudienceProps(readers));
    expect(result.dataForLlm).toContain("db-1 volume alert");
    expect(result.dataForLlm).not.toContain("Payroll");
  });

  test("the list under the answer is an alert list that names the search", async () => {
    const result: ToolExecutionResult = await SearchAlertsTool.execute(
      { searchText: "disk full" },
      PERSON,
    );

    expect(result.widget?.type).toBe(AIChatWidgetType.AlertList);
    expect(result.citationLabel).toContain("disk full");
  });

  test("no searchText is an error the model can correct, read nothing", async () => {
    const result: ToolExecutionResult = await SearchAlertsTool.execute(
      {},
      PERSON,
    );

    expect(result.dataForLlm).toContain("searchText is required");
    expect(alertReads).toHaveLength(0);
  });

  test("is a tool of the Alerts product, offered beside query_alerts, read with the alerts' read permissions", () => {
    expect(getToolProducts("search_alerts")).toEqual([ProductKey.Alerts]);
    expect(AIToolbox.getToolByName("search_alerts")).toBe(SearchAlertsTool);
    expect(AIToolbox.getToolByName("search_incidents")).toBe(
      SearchIncidentsTool,
    );
    expect(AIToolbox.isMutationTool("search_alerts")).toBe(false);
    expect(SearchAlertsTool.requiredPermissions).toEqual(
      new Alert().getReadPermissions(),
    );
  });
});
