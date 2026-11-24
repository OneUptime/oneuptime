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

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityCaseAiActionService from "../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCaseAiAction from "../../../Models/DatabaseModels/SecurityCaseAiAction";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiMode,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
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
 * WHAT ONEUPTIME AI DID ON A CASE, READ BY THE CASE'S READERS OVER THE
 * ROUTE THE APP SERVES (#10352).
 *
 * #10683 added OneUptime AI's log of a case it works (SecurityCaseAiAction)
 * with a @CrudApiEndpoint and documentation, so the API Reference and the
 * OpenAPI spec offered POST /api/security-case-ai-action/get-list - and
 * BaseAPI/Index.ts never mounted a router for it, so the route answered 404
 * (CrudApiEndpointRouteMountGuard). The case's own AI card reads the log
 * through the case's routes; this is the API's read. The App mounts it now,
 * built as here, as it mounts the case's step checks.
 *
 * Every request goes over HTTP through Express's body parser, the route,
 * the permission layer and the error handler into a table held in memory
 * (DashboardRequestsOverHttp, InMemoryRepository):
 *
 *   - whoever reads the case reads what OneUptime AI did on it: Project
 *     Owner, Project Admin, the three Security levels, and a custom role
 *     that reads both cases and the log;
 *   - a role that reads no case reads no action - Project Member and
 *     Viewer, which Security Events leaves out, a custom role with the
 *     log's permission alone - and neither does one that reads cases but
 *     not the log;
 *   - nobody creates, changes or deletes an action over the API, a Project
 *     Owner included: only OneUptime AI writes them, and a person approves,
 *     declines or undoes one through the case's routes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10352000-0000-4000-8000-000000000001",
);
const CASE_ID: string = "10352000-0000-4000-8000-0000000000a1";
const ACTION_ID: string = "10352000-0000-4000-8000-0000000000b1";
const AT: Date = new Date("2026-11-22T08:00:00.000Z");
const PATH: string = "/api/security-case-ai-action";

const ACTION: StoredRow = {
  _id: ACTION_ID,
  projectId: PROJECT_ID.toString(),
  securityCaseId: CASE_ID,
  kind: SecurityCaseAiActionKind.BlockAddress,
  area: SecurityCaseAiArea.Edge,
  mode: SecurityCaseAiMode.OnItsOwn,
  status: SecurityCaseAiActionStatus.Done,
  stepKey: "block-address:203.0.113.47",
  target: "203.0.113.47",
  doneAt: AT,
};

const CASE: StoredRow = {
  _id: CASE_ID,
  projectId: PROJECT_ID.toString(),
  caseNumber: 152,
  caseNumberWithPrefix: "CASE-152",
  title: "Scanner probing /wp-login.php",
};

// What a reader of the log asks for: what was done, how, and on which step.
const ACTION_SELECT: JSONObject = {
  _id: true,
  kind: true,
  area: true,
  mode: true,
  status: true,
  stepKey: true,
  target: true,
  doneAt: true,
};

interface Reader {
  name: string;
  permissions: Array<Permission>;
}

const CASE_READERS: Array<Reader> = [
  { name: "Project Owner", permissions: [Permission.ProjectOwner] },
  { name: "Project Admin", permissions: [Permission.ProjectAdmin] },
  { name: "Security Admin", permissions: [Permission.SecurityAdmin] },
  { name: "Security Member", permissions: [Permission.SecurityMember] },
  { name: "Security Viewer", permissions: [Permission.SecurityViewer] },
  {
    name: "a custom role that reads cases and what OneUptime AI did on them",
    permissions: [
      Permission.ReadSecurityCase,
      Permission.ReadSecurityCaseAiAction,
    ],
  },
];

const NOT_READERS: Array<Reader> = [
  { name: "Project Member", permissions: [Permission.ProjectMember] },
  { name: "Viewer", permissions: [Permission.Viewer] },
  {
    name: "a custom role that reads the log but no case",
    permissions: [Permission.ReadSecurityCaseAiAction],
  },
  {
    name: "a custom role that reads cases but not the log",
    permissions: [Permission.ReadSecurityCase],
  },
];

// The status the server refuses with (NotAuthorizedException).
const REFUSED: number = 422;

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let actions: InMemoryTable;

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function rowsOf(sent: SentRequest): Array<JSONObject> {
  return ((sent.answer as JSONObject)?.["data"] || []) as Array<JSONObject>;
}

// A reader's read of what OneUptime AI did on the case.
async function readTheCasesActions(): Promise<SentRequest> {
  return server.request("POST", `${PATH}/get-list`, {
    query: { securityCaseId: CASE_ID },
    select: ACTION_SELECT,
    sort: { createdAt: SortOrder.Ascending },
    limit: 100,
    skip: 0,
  });
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  // As packages/App/FeatureSet/BaseAPI/Index.ts mounts it.
  await server.start([
    new BaseAPI<SecurityCaseAiAction, DatabaseService<BaseModel>>(
      SecurityCaseAiAction,
      SecurityCaseAiActionService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  actions = useInMemoryTable(
    SecurityCaseAiActionService as unknown as DatabaseService<BaseModel>,
    [{ ...ACTION }],
    { answersOnlySelectedColumns: true },
  );
  useInMemoryTable(
    SecurityCaseService as unknown as DatabaseService<BaseModel>,
    [{ ...CASE }],
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what OneUptime AI did on a case, over POST /api/security-case-ai-action/get-list", () => {
  test.each(CASE_READERS)(
    "$name reads what OneUptime AI did on the case",
    async (reader: Reader) => {
      caller = callerWith(reader.permissions);

      const sent: SentRequest = await readTheCasesActions();

      expect({ reader: reader.name, status: sent.status }).toEqual({
        reader: reader.name,
        status: 200,
      });

      const rows: Array<JSONObject> = rowsOf(sent);

      expect(rows).toHaveLength(1);
      expect(rows[0]!["_id"]).toBe(ACTION_ID);
      expect(rows[0]!["kind"]).toBe(SecurityCaseAiActionKind.BlockAddress);
      expect(rows[0]!["status"]).toBe(SecurityCaseAiActionStatus.Done);
      expect(rows[0]!["stepKey"]).toBe(ACTION["stepKey"]);
      expect(rows[0]!["target"]).toBe(ACTION["target"]);
    },
  );

  test.each(NOT_READERS)(
    "$name is refused, before the table is read",
    async (reader: Reader) => {
      caller = callerWith(reader.permissions);

      const sent: SentRequest = await readTheCasesActions();

      expect({ reader: reader.name, status: sent.status }).toEqual({
        reader: reader.name,
        status: REFUSED,
      });
      expect(rowsOf(sent)).toEqual([]);
    },
  );

  test("the route is served: no case reader's read answers 404 (CrudApiEndpointRouteMountGuard)", async () => {
    for (const reader of CASE_READERS) {
      caller = callerWith(reader.permissions);

      const sent: SentRequest = await readTheCasesActions();

      expect(sent.status).not.toBe(404);
    }
  });
});

describe("nobody writes what OneUptime AI did over the API", () => {
  test("a Project Owner cannot create an action", async () => {
    const sent: SentRequest = await server.request("POST", PATH, {
      data: {
        projectId: PROJECT_ID.toString(),
        securityCaseId: CASE_ID,
        kind: SecurityCaseAiActionKind.BlockAddress,
        status: SecurityCaseAiActionStatus.Done,
        stepKey: "block-address:198.51.100.7",
      },
    });

    expect(sent.status).toBe(REFUSED);
    expect(actions.inserts).toEqual([]);
  });

  test("a Project Owner cannot change one: what OneUptime AI did stays as it was recorded", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `${PATH}/${ACTION_ID}`,
      { data: { status: SecurityCaseAiActionStatus.Undone } },
    );

    expect(sent.status).toBe(REFUSED);
    expect(actions.updates).toEqual([]);
    expect(actions.get(ACTION_ID)!["status"]).toBe(
      SecurityCaseAiActionStatus.Done,
    );
  });

  test("a Project Owner cannot delete one", async () => {
    const sent: SentRequest = await server.request(
      "DELETE",
      `${PATH}/${ACTION_ID}`,
    );

    expect(sent.status).toBe(REFUSED);
    expect(actions.deletes).toEqual([]);
    expect(actions.get(ACTION_ID)).toBeDefined();
  });
});
