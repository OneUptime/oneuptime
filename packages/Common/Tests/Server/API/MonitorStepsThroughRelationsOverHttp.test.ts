jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * The incident and alert routers pull the native isolated-vm addon through
 * their template renderers; nothing here runs it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import AlertAPI from "../../../Server/API/AlertAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import Select from "../../../Server/Types/Database/Select";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  clearPrivateRecords,
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT EACH ROLE READS OF A MONITOR THROUGH AN INCIDENT OR AN ALERT, OVER
 * HTTP THROUGH THE SERVER'S OWN ROUTES (#10309).
 *
 * A monitor's steps are the whole of what it checks: an API monitor's URL,
 * the headers it sends (a bearer token among them) and its request body; a
 * metric monitor's queries; every step's criteria. Until #10309 they were a
 * label every reader of a record that names a monitor read through it, so
 * an Incident Viewer, an Alert Member or a custom role that reads incidents
 * - none of whom may read the monitor - could send
 *
 *   POST /api/incident/get-list
 *   { "select": { "monitors": { "monitorSteps": true } } }
 *
 * and read every monitor's headers, URLs and bodies through the incidents
 * on it. The Root Cause card did, to chart one metric.
 *
 * Here every request goes over HTTP through Express's body parser, the
 * routes the App serves (IncidentAPI, AlertAPI, MonitorAPI), the permission
 * layer and the error handler, into tables held in memory that join the
 * monitor as Postgres would (DashboardRequestsOverHttp, InMemoryRepository):
 *
 *   - before: with the monitor's steps as 17.1.0 shipped them, every
 *     reader of an incident or an alert reads them - the leak;
 *   - after, through Incident.monitors and Alert.monitor, for each of their
 *     readers: which monitor it is and what kind is answered; its steps are
 *     refused to everyone, Project Owner included, before the table is
 *     read - no relation reads them;
 *   - the monitor's own read, which the Root Cause card and an Affected
 *     Resource's commands now send, answers its steps to who may read the
 *     monitor, and refuses everyone else.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10309000-0000-4000-8000-000000000001",
);
const MONITOR_ID: string = "10309000-0000-4000-8000-0000000000a1";
const INCIDENT_ID: string = "10309000-0000-4000-8000-0000000000b1";
const ALERT_ID: string = "10309000-0000-4000-8000-0000000000c1";

// The token an API monitor sends in a header: what its steps hold.
const TOKEN: string = "Bearer sk_live_10309_billing";

// What the monitor checks, as its steps column holds it.
const MONITOR_STEPS: JSONObject = {
  monitorStepsInstanceArray: [
    {
      id: "step-1",
      monitorDestination: "https://billing.internal.example/api/charge",
      requestType: "POST",
      requestHeaders: { Authorization: TOKEN },
      requestBody: '{"card":"4242424242424242"}',
    },
  ],
};

// The monitor as the incident's and the alert's rows join it.
const JOINED_MONITOR: StoredRow = {
  _id: MONITOR_ID,
  projectId: PROJECT_ID.toString(),
  name: "Billing API",
  monitorType: MonitorType.API,
  isArchived: false,
  monitorSteps: MONITOR_STEPS,
};

// Which monitor it is: what every reader of a relation to it reads.
const LABELS: Array<string> = ["name", "monitorType"];

const COLUMN_NOT_READ: string =
  "Column monitorSteps on Monitor does not support read on relation query.";

interface Reader {
  name: string;
  permissions: Array<Permission>;
  // Whether the reader may read the monitor itself.
  readsMonitors: boolean;
}

// Who reads a monitor's steps on the monitor, and every incident and alert.
const MONITOR_READERS: Array<Reader> = [
  {
    name: "Project Owner",
    permissions: [Permission.ProjectOwner],
    readsMonitors: true,
  },
  {
    name: "Project Admin",
    permissions: [Permission.ProjectAdmin],
    readsMonitors: true,
  },
  {
    name: "Project Member",
    permissions: [Permission.ProjectMember],
    readsMonitors: true,
  },
  { name: "Viewer", permissions: [Permission.Viewer], readsMonitors: true },
];

const INCIDENT_READERS: Array<Reader> = [
  ...MONITOR_READERS,
  {
    name: "Incident Admin",
    permissions: [Permission.IncidentAdmin],
    readsMonitors: false,
  },
  {
    name: "Incident Member",
    permissions: [Permission.IncidentMember],
    readsMonitors: false,
  },
  {
    name: "Incident Viewer",
    permissions: [Permission.IncidentViewer],
    readsMonitors: false,
  },
  {
    name: "a custom role that reads incidents",
    permissions: [Permission.ReadProjectIncident],
    readsMonitors: false,
  },
];

const ALERT_READERS: Array<Reader> = [
  ...MONITOR_READERS,
  {
    name: "Alert Admin",
    permissions: [Permission.AlertAdmin],
    readsMonitors: false,
  },
  {
    name: "Alert Member",
    permissions: [Permission.AlertMember],
    readsMonitors: false,
  },
  {
    name: "Alert Viewer",
    permissions: [Permission.AlertViewer],
    readsMonitors: false,
  },
  {
    name: "a custom role that reads alerts",
    permissions: [Permission.ReadAlert],
    readsMonitors: false,
  },
];

interface Joiner {
  // "Incident.monitors"
  name: string;
  path: string;
  service: DatabaseService<BaseModel>;
  relation: string;
  readers: Array<Reader>;
  // The record's row, joined to the monitor.
  row: StoredRow;
}

const JOINERS: Array<Joiner> = [
  {
    name: "Incident.monitors",
    path: "/api/incident/get-list",
    service: IncidentService as unknown as DatabaseService<BaseModel>,
    relation: "monitors",
    readers: INCIDENT_READERS,
    row: {
      _id: INCIDENT_ID,
      projectId: PROJECT_ID.toString(),
      title: "Billing API is down",
      isPrivate: false,
      labels: [],
      monitors: [{ ...JOINED_MONITOR }],
    },
  },
  {
    name: "Alert.monitor",
    path: "/api/alert/get-list",
    service: AlertService as unknown as DatabaseService<BaseModel>,
    relation: "monitor",
    readers: ALERT_READERS,
    row: {
      _id: ALERT_ID,
      projectId: PROJECT_ID.toString(),
      title: "Billing API is down",
      isPrivate: false,
      labels: [],
      monitorId: MONITOR_ID,
      monitor: { ...JOINED_MONITOR },
    },
  },
];

// Every reader of every relation: one case each.
const CASES: Array<[string, string, Joiner, Reader]> = JOINERS.flatMap(
  (joiner: Joiner): Array<[string, string, Joiner, Reader]> => {
    return joiner.readers.map(
      (reader: Reader): [string, string, Joiner, Reader] => {
        return [joiner.name, reader.name, joiner, reader];
      },
    );
  },
);

// The readers of an incident or an alert who may not read the monitor.
const NARROW_CASES: Array<[string, string, Joiner, Reader]> = CASES.filter(
  (entry: [string, string, Joiner, Reader]): boolean => {
    return !entry[3].readsMonitors;
  },
);

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

// The monitor as the first record of a list's answer joins it.
function monitorOf(sent: SentRequest, relation: string): JSONObject {
  const data: Array<JSONObject> = ((sent.answer as JSONObject)?.["data"] ||
    []) as Array<JSONObject>;
  const joined: unknown = data[0]?.[relation];

  return ((Array.isArray(joined) ? joined[0] : joined) || {}) as JSONObject;
}

// The monitor's columns an answer holds, but its id.
function columnsOf(monitor: JSONObject): Array<string> {
  return Object.keys(monitor)
    .filter((column: string): boolean => {
      return (
        !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
        !column.startsWith("_") &&
        monitor[column] !== undefined &&
        monitor[column] !== null
      );
    })
    .sort();
}

function selectOf(joiner: Joiner, columns: Array<string>): JSONObject {
  const relationSelect: JSONObject = { _id: true };

  for (const column of columns) {
    relationSelect[column] = true;
  }

  return { _id: true, [joiner.relation]: relationSelect };
}

// The status the server refuses a select it cannot answer with (BadDataException).
const BAD_SELECT: number = 400;

// The status the server refuses a read with (NotAuthorizedException).
const REFUSED: number = 422;

const MONITOR_STEPS_METADATA: TableColumnMetadata =
  new Monitor().getTableColumnMetadata("monitorSteps");

/*
 * The monitor's steps as 17.1.0 shipped them: a label every reader of a
 * relation read. The column metadata is the model's own: planted on, and
 * taken off again.
 */
function asShippedIn1710(): () => void {
  MONITOR_STEPS_METADATA.canReadOnRelationQuery = true;

  return (): void => {
    delete MONITOR_STEPS_METADATA.canReadOnRelationQuery;
  };
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let monitors: InMemoryTable;

function useJoiner(joiner: Joiner): InMemoryTable {
  return useInMemoryTable(joiner.service, [{ ...joiner.row }], {
    answersOnlySelectedColumns: true,
  });
}

async function send(
  joiner: Joiner,
  body: JSONObject,
): Promise<{ sent: SentRequest; table: InMemoryTable }> {
  const table: InMemoryTable = useJoiner(joiner);

  const sent: SentRequest = await server.request("POST", joiner.path, {
    query: {},
    limit: 10,
    skip: 0,
    ...body,
  });

  return { sent: sent, table: table };
}

// The read the Root Cause card sends for a monitor's steps: on the monitor.
async function readTheMonitor(): Promise<SentRequest> {
  return await server.request("POST", "/api/monitor/get-list", {
    query: { _id: { _type: "Includes", value: [MONITOR_ID] } },
    select: { _id: true, monitorType: true, monitorSteps: true },
    limit: 1,
    skip: 0,
  });
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new IncidentAPI().getRouter(),
    new AlertAPI().getRouter(),
    new MonitorAPI().getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  stubProjectDirectory({});
  everyServerProductIsOn();
  clearPrivateRecords();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  monitors = useInMemoryTable(
    MonitorService as unknown as DatabaseService<BaseModel>,
    [{ ...JOINED_MONITOR, labels: [] }],
    { answersOnlySelectedColumns: true },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor's columns a relation reads", () => {
  test("are which monitor it is and how it is doing; its steps are not one of them", () => {
    expect(Boolean(MONITOR_STEPS_METADATA.canReadOnRelationQuery)).toBe(false);
    expect(MONITOR_STEPS_METADATA.relationReaders).toBeUndefined();
    expect(Boolean(MONITOR_STEPS_METADATA.title)).toBe(true);
  });
});

describe("before #10309: every reader of an incident or an alert read the monitor's steps through it", () => {
  test.each(NARROW_CASES)(
    "%s: %s",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      const takeOff: () => void = asShippedIn1710();

      try {
        caller = callerWith(reader.permissions);

        const { sent } = await send(joiner, {
          select: selectOf(joiner, ["name", "monitorSteps"]),
        });

        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: 200,
          refusal: "",
        });
        // The header's token, the URL and the body, read through the record.
        expect(JSON.stringify(monitorOf(sent, joiner.relation))).toContain(
          TOKEN,
        );
        expect(JSON.stringify(monitorOf(sent, joiner.relation))).toContain(
          "billing.internal.example",
        );
      } finally {
        takeOff();
      }
    },
  );
});

describe("after: through each relation, each reader reads which monitor it is and what kind", () => {
  test.each(CASES)(
    "%s: %s",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      caller = callerWith(reader.permissions);

      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, LABELS),
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(table.repository.find).toHaveBeenCalled();
      // Which monitor it is, and nothing else of it.
      expect(columnsOf(monitorOf(sent, joiner.relation))).toEqual(
        [...LABELS].sort(),
      );
      expect(monitorOf(sent, joiner.relation)).toEqual(
        expect.objectContaining({
          name: "Billing API",
          monitorType: MonitorType.API,
        }),
      );
      expect(JSON.stringify(sent.answer)).not.toContain(TOKEN);
    },
  );
});

describe("after: no reader reads a monitor's steps through a relation, Project Owner included", () => {
  test.each(CASES)(
    "%s: %s",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      caller = callerWith(reader.permissions);

      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, ["name", "monitorSteps"]),
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: BAD_SELECT,
        refusal: COLUMN_NOT_READ,
      });
      // Refused before the table is read.
      expect(table.repository.find).not.toHaveBeenCalled();
      expect(JSON.stringify(sent.answer)).not.toContain(TOKEN);
    },
  );

  test.each(JOINERS)(
    "the steps alone, through $name, are refused too",
    async (joiner: Joiner) => {
      caller = callerWith([Permission.ProjectOwner]);

      const { sent, table } = await send(joiner, {
        select: { _id: true, [joiner.relation]: { monitorSteps: true } },
      });

      expect(sent.status).toBe(BAD_SELECT);
      expect(refusalOf(sent)).toBe(COLUMN_NOT_READ);
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );
});

describe("the monitor's own read answers its steps to who may read the monitor, and refuses everyone else", () => {
  const READERS: Array<Reader> = [
    ...INCIDENT_READERS,
    ...ALERT_READERS.filter((reader: Reader): boolean => {
      return !MONITOR_READERS.includes(reader);
    }),
    {
      name: "Monitor Viewer",
      permissions: [Permission.MonitorViewer],
      readsMonitors: true,
    },
    {
      name: "a custom role that reads monitors",
      permissions: [Permission.ReadProjectMonitor],
      readsMonitors: true,
    },
  ];

  test.each(
    READERS.map((reader: Reader): [string, Reader] => {
      return [reader.name, reader];
    }),
  )("%s", async (_who: string, reader: Reader) => {
    caller = callerWith(reader.permissions);

    const sent: SentRequest = await readTheMonitor();

    if (!reader.readsMonitors) {
      expect(sent.status).toBe(REFUSED);
      expect(refusalOf(sent)).toContain("You do not have permissions");
      expect(JSON.stringify(sent.answer)).not.toContain(TOKEN);
      expect(monitors.repository.find).not.toHaveBeenCalled();
      return;
    }

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });

    const data: Array<JSONObject> = ((sent.answer as JSONObject)["data"] ||
      []) as Array<JSONObject>;

    expect(data).toHaveLength(1);
    expect(JSON.stringify(data[0]!["monitorSteps"])).toContain(TOKEN);
  });
});

/*
 * Every relation that reaches a monitor, not only the incident's and the
 * alert's: the permission layer's own check of a select through it, for a
 * Project Owner, who reads everything else of the record and the monitor.
 */
describe("no relation to a monitor reads its steps, for anyone", () => {
  type ModelType = { new (): BaseModel };

  const RELATIONS: Array<[string, ModelType, string]> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const column of Object.keys(columns)) {
      const metadata: TableColumnMetadata = columns[column]!;

      if (
        (metadata.type === TableColumnType.Entity ||
          metadata.type === TableColumnType.EntityArray) &&
        metadata.modelType &&
        new metadata.modelType().tableName === "Monitor"
      ) {
        RELATIONS.push([`${model.tableName}.${column}`, modelType, column]);
      }
    }
  }

  test("the sweep finds the relations that reach a monitor", () => {
    // 44 of them read it wider than its own read in 17.1.0.
    expect(RELATIONS.length).toBeGreaterThanOrEqual(44);
    expect(
      RELATIONS.map((relation: [string, ModelType, string]): string => {
        return relation[0];
      }),
    ).toEqual(
      expect.arrayContaining([
        "Incident.monitors",
        "Alert.monitor",
        "ScheduledMaintenance.monitors",
        "StatusPageResource.monitor",
        "MonitorProbe.monitor",
      ]),
    );
  });

  test.each(RELATIONS)(
    "%s",
    (_relation: string, modelType: ModelType, column: string) => {
      expect(() => {
        QueryPermission.checkRelationQueryPermission(
          modelType,
          {},
          { _id: true, [column]: { monitorSteps: true } } as Select<BaseModel>,
          callerWith([Permission.ProjectOwner]),
        );
      }).toThrow(COLUMN_NOT_READ);

      // Which monitor it is stays every reader's.
      expect(() => {
        QueryPermission.checkRelationQueryPermission(
          modelType,
          {},
          {
            _id: true,
            [column]: { name: true, monitorType: true },
          } as Select<BaseModel>,
          callerWith([Permission.ProjectOwner]),
        );
      }).not.toThrow();
    },
  );
});
