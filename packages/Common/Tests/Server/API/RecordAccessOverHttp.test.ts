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
 * The monitor's incident path pulls the native isolated-vm addon through
 * its template renderer; nothing here runs it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentPostmortemActionItemService from "../../../Server/Services/IncidentPostmortemActionItemService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import IncidentVideoCallService from "../../../Server/Services/IncidentVideoCallService";
import LabelService from "../../../Server/Services/LabelService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RecordAccess, {
  RECORD_ACCESS_TABLES,
  RecordAccessKind,
  RecordAccessOperation,
  RecordAccessRefusalReason,
  RecordAccessResult,
  RecordAccessVerdict,
} from "../../../Types/RecordAccess/RecordAccess";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { fetchRecordAccess } from "../../../../App/FeatureSet/Dashboard/src/Components/RecordAccess/RecordAccessApi";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  clearPrivateRecords,
  InMemoryTable,
  setPrivateRecords,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
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
 * WHAT THE READER MAY DO ON AN INCIDENT, THROUGH THE SERVER'S OWN ROUTE
 * OVER HTTP (#10272).
 *
 * An incident's page asks once, as it opens, what the reader may do on it
 * and on its parts (GET /incident/record-access/:id), and every lock on the
 * page reads the answer. Here the Dashboard's own request
 * (fetchRecordAccess) goes through Express's JSON handling, the real route,
 * RecordAccessBuilder and the permission layer, into tables held in memory,
 * for each kind of reader: who may change everything, who may change
 * nothing, #10191's customer - who may hand a role on but take nobody off
 * one - and someone a private incident's owners do not let in. What a
 * grant limited to labels or to owned records, and a team's block on some
 * labels, do to the answer needs the database's joins, and is asked of it
 * in RecordAccessPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10272000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: string = "10272000-0000-4000-8000-0000000000a1";
const MISSING_INCIDENT_ID: string = "10272000-0000-4000-8000-0000000000a9";

const MAYA_ID: string = "10272000-0000-4000-8000-0000000000b1";
const ANA_ID: string = "10272000-0000-4000-8000-0000000000b4";

const COMMANDER_ROLE_ID: string = "10272000-0000-4000-8000-0000000000c1";
const COMMANDER_ROW_ID: string = "10272000-0000-4000-8000-0000000000d1";
const NOTE_ID: string = "10272000-0000-4000-8000-0000000000e1";
const TIMELINE_ID: string = "10272000-0000-4000-8000-0000000000f1";
const STATE_ID: string = "10272000-0000-4000-8000-0000000000f9";

const INCIDENT_TABLES: ReadonlyArray<string> =
  RECORD_ACCESS_TABLES[RecordAccessKind.Incident];

const asService: (service: unknown) => DatabaseService<BaseModel> = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

/*
 * A teammate holding exactly `permissions` in the project (Ana, who holds
 * no role here, unless another person is named). Whoever opens an
 * incident's page reads incidents.
 */
const teammate: (
  permissions: Array<Permission>,
  userId?: string,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
  userId?: string,
): DatabaseCommonInteractionProps => {
  return {
    ...customDomainCaller({
      permissions: [Permission.ReadProjectIncident, ...permissions],
      projectId: PROJECT_ID,
    }),
    userId: new ObjectID(userId || ANA_ID),
    ...ON_HIGHEST_PLAN,
  };
};

const PROJECT_OWNER: DatabaseCommonInteractionProps = teammate([
  Permission.ProjectOwner,
]);
const PROJECT_ADMIN: DatabaseCommonInteractionProps = teammate([
  Permission.ProjectAdmin,
]);
const PROJECT_MEMBER: DatabaseCommonInteractionProps = teammate([
  Permission.ProjectMember,
]);
const VIEWER: DatabaseCommonInteractionProps = teammate([Permission.Viewer]);

// #10191's customer: may give a role and hand one on, may take nobody off one.
const ROLE_EDITOR: DatabaseCommonInteractionProps = teammate([
  Permission.ReadIncidentMember,
  Permission.CreateIncidentMember,
  Permission.EditIncidentMember,
]);

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let incidents: InMemoryTable;
let members: InMemoryTable;
let internalNotes: InMemoryTable;
let timelines: InMemoryTable;

beforeAll(async () => {
  // The session guards, as a signed-in member passes them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);

  server = new DashboardRequestsOverHttp();
  await server.start([new IncidentAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
  jest.restoreAllMocks();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = ROLE_EDITOR;

  stubProjectDirectory({});
  everyServerProductIsOn();
  clearPrivateRecords();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID.toString(),
  });

  incidents = useInMemoryTable(asService(IncidentService), [
    {
      _id: INCIDENT_ID,
      projectId: PROJECT_ID.toString(),
      title: "Checkout is slow",
      isPrivate: false,
      labels: [],
    },
  ]);
  members = useInMemoryTable(asService(IncidentMemberService), [
    {
      _id: COMMANDER_ROW_ID,
      projectId: PROJECT_ID.toString(),
      incidentId: INCIDENT_ID,
      userId: MAYA_ID,
      incidentRoleId: COMMANDER_ROLE_ID,
    },
  ]);
  internalNotes = useInMemoryTable(asService(IncidentInternalNoteService), [
    {
      _id: NOTE_ID,
      projectId: PROJECT_ID.toString(),
      incidentId: INCIDENT_ID,
      note: "Rolled back the deploy.",
    },
  ]);
  timelines = useInMemoryTable(asService(IncidentStateTimelineService), [
    {
      _id: TIMELINE_ID,
      projectId: PROJECT_ID.toString(),
      incidentId: INCIDENT_ID,
      incidentStateId: STATE_ID,
    },
  ]);

  /*
   * The incident a new part goes under, read by OneUptime from the
   * incident's own table (CreatePermission's parent read).
   */
  getJestSpyOn(DatabaseService, "getParentReader").mockImplementation(
    ((modelType: { new (): BaseModel }) => {
      expect(new modelType().tableName).toBe("Incident");
      return IncidentService;
    }) as never,
  );

  // The parts the incident has no row of yet.
  for (const service of [
    IncidentPublicNoteService,
    IncidentOwnerUserService,
    IncidentOwnerTeamService,
    IncidentPostmortemActionItemService,
    IncidentVideoCallService,
    LabelService,
  ]) {
    useInMemoryTable(asService(service), []);
  }
});

afterEach(() => {
  jest.restoreAllMocks();

  // The session guards stay as the routers were built with them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
});

// The answer for the incident, as the Dashboard asks it and reads it.
const askAsDashboard: (
  incidentId?: string,
) => Promise<RecordAccessResult> = async (
  incidentId?: string,
): Promise<RecordAccessResult> => {
  return await fetchRecordAccess({
    kind: RecordAccessKind.Incident,
    recordId: new ObjectID(incidentId || INCIDENT_ID),
  });
};

const verdictOf: (
  result: RecordAccessResult,
  table: string,
  operation: RecordAccessOperation,
) => RecordAccessVerdict | null = (
  result: RecordAccessResult,
  table: string,
  operation: RecordAccessOperation,
): RecordAccessVerdict | null => {
  return RecordAccess.getVerdict(result, table, operation);
};

// Each verdict as "Table operation: allowed" or "...: <reason>".
const summaryOf: (result: RecordAccessResult) => Array<string> = (
  result: RecordAccessResult,
): Array<string> => {
  const lines: Array<string> = [];

  for (const table of INCIDENT_TABLES) {
    for (const operation of Object.values(RecordAccessOperation)) {
      const verdict: RecordAccessVerdict | null = verdictOf(
        result,
        table,
        operation,
      );

      if (verdict) {
        lines.push(
          `${table} ${operation}: ${
            verdict.isAllowed ? "allowed" : verdict.refusal?.reason
          }`,
        );
      }
    }
  }

  return lines;
};

// What the server answered a refusal with, as the Dashboard reads it.
const refusalOf: (sent: SentRequest) => string = (
  sent: SentRequest,
): string => {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
};

const writesTo: (table: InMemoryTable) => number = (
  table: InMemoryTable,
): number => {
  return table.updates.length + table.inserts.length + table.deletes.length;
};

describe("GET /api/incident/record-access/:id, as the Dashboard sends it", () => {
  test("is one request, a GET of the incident's own route, and writes nothing", async () => {
    caller = PROJECT_OWNER;

    await askAsDashboard();

    expect(
      server.requests.map((request: SentRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([`GET /api/incident/record-access/${INCIDENT_ID}`]);
    expect(server.requests[0]!.status).toBe(200);
    expect(server.requests[0]!.headers["cache-control"]).toMatch(
      /no-cache|no-store/,
    );

    for (const table of [incidents, members, internalNotes, timelines]) {
      expect(writesTo(table)).toBe(0);
    }
  });

  test("answers for the incident and every part of it, by table", async () => {
    caller = PROJECT_OWNER;

    const result: RecordAccessResult = await askAsDashboard();

    expect(result.kind).toBe(RecordAccessKind.Incident);
    expect(result.recordId.toLowerCase()).toBe(INCIDENT_ID);
    expect(Object.keys(result.tables).sort()).toEqual(
      [...INCIDENT_TABLES].sort(),
    );
  });
});

describe("a Project Owner and a Project Admin may do everything on it", () => {
  test.each([
    ["Project Owner", PROJECT_OWNER],
    ["Project Admin", PROJECT_ADMIN],
    ["Project Member", PROJECT_MEMBER],
  ])("%s", async (_name: string, props: DatabaseCommonInteractionProps) => {
    caller = props;

    const result: RecordAccessResult = await askAsDashboard();

    expect(summaryOf(result)).toEqual([
      "Incident update: allowed",
      "Incident delete: allowed",
      "IncidentStateTimeline create: allowed",
      "IncidentStateTimeline update: allowed",
      "IncidentStateTimeline delete: allowed",
      "IncidentInternalNote create: allowed",
      "IncidentInternalNote update: allowed",
      "IncidentInternalNote delete: allowed",
      "IncidentPublicNote create: allowed",
      "IncidentMember create: allowed",
      "IncidentMember update: allowed",
      "IncidentMember delete: allowed",
      "IncidentOwnerUser create: allowed",
      "IncidentOwnerTeam create: allowed",
      "IncidentPostmortemActionItem create: allowed",
      "IncidentVideoCall create: allowed",
    ]);
  });

  test("a part the incident has no row of is answered for its new rows only: a change or a removal waits for a row", async () => {
    caller = PROJECT_OWNER;

    const result: RecordAccessResult = await askAsDashboard();

    expect(result.tables["IncidentPublicNote"]).toEqual({
      create: RecordAccess.allowed(),
    });
    expect(result.tables["IncidentOwnerTeam"]).toEqual({
      create: RecordAccess.allowed(),
    });
  });
});

describe("what the reader's own permissions refuse is refused on every incident", () => {
  test("a viewer may change nothing of it, and is told so as their permissions say it", async () => {
    caller = VIEWER;

    const result: RecordAccessResult = await askAsDashboard();

    for (const line of summaryOf(result)) {
      expect(line).toMatch(/: Permission$/);
    }

    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Update),
    ).toEqual(RecordAccess.refused(RecordAccessRefusalReason.Permission));
  });

  test("#10191's customer may give a role and hand one on, and may take nobody off one", async () => {
    caller = ROLE_EDITOR;

    const result: RecordAccessResult = await askAsDashboard();

    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Create),
    ).toEqual(RecordAccess.allowed());
    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Update),
    ).toEqual(RecordAccess.allowed());
    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Delete),
    ).toEqual(RecordAccess.refused(RecordAccessRefusalReason.Permission));

    // Nothing else of the incident is theirs to change.
    expect(verdictOf(result, "Incident", RecordAccessOperation.Update)).toEqual(
      RecordAccess.refused(RecordAccessRefusalReason.Permission),
    );
  });

  test("a team's block with no labels takes it away on every incident, whatever the role around it allows", async () => {
    caller = {
      ...customDomainCaller({
        permissions: [Permission.ProjectMember],
        blocks: [Permission.EditIncidentMember],
        projectId: PROJECT_ID,
      }),
      userId: new ObjectID(ANA_ID),
      ...ON_HIGHEST_PLAN,
    };

    const result: RecordAccessResult = await askAsDashboard();

    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Update),
    ).toEqual(RecordAccess.refused(RecordAccessRefusalReason.Permission));
    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Create),
    ).toEqual(RecordAccess.allowed());
  });
});

describe("a private incident is changed only through its owners", () => {
  beforeEach(() => {
    incidents.rows[0]!["isPrivate"] = true;
    setPrivateRecords({
      table: "Incident",
      records: [{ id: INCIDENT_ID, seenBy: [MAYA_ID, ANA_ID] }],
    });
  });

  /*
   * Seen through a team of theirs that owns it but may only view, and
   * changed through another team, a private incident's changes are refused
   * with the private reason: that takes the teams' own rows, and is asked of
   * the database in RecordAccessPostgres.
   */
  test("someone it is not owned by, who does not see it, is answered as missing, as its own page answers it", async () => {
    setPrivateRecords({
      table: "Incident",
      records: [{ id: INCIDENT_ID, seenBy: [MAYA_ID] }],
    });
    caller = PROJECT_MEMBER;

    await expect(askAsDashboard()).rejects.toBeTruthy();

    expect(server.requests[0]!.status).toBe(404);
    expect(refusalOf(server.requests[0]!)).toMatch(/Incident not found/);
  });

  test("its owner may change it", async () => {
    caller = teammate([Permission.ProjectMember], MAYA_ID);

    const result: RecordAccessResult = await askAsDashboard();

    expect(verdictOf(result, "Incident", RecordAccessOperation.Update)).toEqual(
      RecordAccess.allowed(),
    );
    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Update),
    ).toEqual(RecordAccess.allowed());
  });

  test("a Project Admin may change it, as they may every private incident", async () => {
    caller = PROJECT_ADMIN;

    const result: RecordAccessResult = await askAsDashboard();

    expect(
      summaryOf(result).every((line: string): boolean => {
        return line.endsWith(": allowed");
      }),
    ).toBe(true);
  });
});

describe("an incident the reader may not read is answered as missing", () => {
  test("one that is not there", async () => {
    caller = PROJECT_OWNER;

    await expect(askAsDashboard(MISSING_INCIDENT_ID)).rejects.toBeTruthy();

    const sent: SentRequest = server.requests[0]!;
    expect(sent.status).toBe(404);
    expect(refusalOf(sent)).toMatch(/Incident not found/);
  });

  test("one of another project", async () => {
    caller = PROJECT_OWNER;
    incidents.rows[0]!["projectId"] = ObjectID.generate().toString();

    await expect(askAsDashboard()).rejects.toBeTruthy();
    expect(server.requests[0]!.status).toBe(404);
  });

  test("no ID in the path is refused in words that say so", async () => {
    caller = PROJECT_OWNER;

    const sent: SentRequest = await server.request(
      "GET",
      "/api/incident/record-access/INC-18",
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(
      "The record to ask about is not named by an ID. Ask again with the ID of the record.",
    );
  });
});

describe("the answer is the rows' own: no row a reader may not reach is offered", () => {
  test("a role row's change is answered for the row the incident has, and every row of it reads the same", async () => {
    caller = ROLE_EDITOR;

    const result: RecordAccessResult = await askAsDashboard();

    expect(StoredRowIds(members)).toEqual([COMMANDER_ROW_ID]);
    expect(
      verdictOf(result, "IncidentMember", RecordAccessOperation.Update)
        ?.isAllowed,
    ).toBe(true);
  });
});

// The ids a table holds, in order.
function StoredRowIds(table: InMemoryTable): Array<string> {
  return table.rows.map((row: StoredRow): string => {
    return String(row["_id"]).toLowerCase();
  });
}
