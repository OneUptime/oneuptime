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
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityCaseStepCheckService from "../../../Server/Services/SecurityCaseStepCheckService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCaseStepCheck from "../../../Models/DatabaseModels/SecurityCaseStepCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { RESPONSE_STEP_CHECK_SELECT } from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanInputs";
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
 * WHAT ONEUPTIME FOUND OF A CASE'S RESPONSE PLAN, READ BY THE CASE'S
 * READERS OVER THE ROUTE THE APP SERVES (#10340).
 *
 * A case's Response Plan card reads the case's step checks
 * (SecurityCaseStepCheck) with POST /api/security-case-step-check/get-list,
 * and nothing served that route: #10480 added the model with its
 * @CrudApiEndpoint, and BaseAPI/Index.ts never mounted a router for it, so
 * the card's read answered 404 and no step ever showed what OneUptime found
 * of it (CrudApiEndpointRouteMountGuard). The App mounts it now, built as
 * here.
 *
 * Every request goes over HTTP through Express's body parser, the route,
 * the permission layer and the error handler into a table held in memory
 * (DashboardRequestsOverHttp, InMemoryRepository):
 *
 *   - whoever reads the case reads what OneUptime found of it, with the
 *     columns the card asks for: Project Owner, Project Admin, the three
 *     Security levels, and a custom role that reads both cases and checks;
 *   - a role that reads no case reads no check - Project Member and Viewer,
 *     which Security Events leaves out, a custom role with the checks'
 *     permission alone - and neither does one that reads cases but not
 *     checks;
 *   - nobody creates, changes or deletes a check over the API, a Project
 *     Owner included: only OneUptime's step checks write them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10340000-0000-4000-8000-000000000001",
);
const CASE_ID: string = "10340000-0000-4000-8000-0000000000a1";
const CHECK_ID: string = "10340000-0000-4000-8000-0000000000b1";
const AT: Date = new Date("2026-11-20T08:00:00.000Z");
const PATH: string = "/api/security-case-step-check";

const CHECK: StoredRow = {
  _id: CHECK_ID,
  projectId: PROJECT_ID.toString(),
  securityCaseId: CASE_ID,
  stepKey: "block-address:203.0.113.47",
  state: SecurityCaseStepCheckState.Verified,
  evidence: {
    sentence: { template: "No request from the address since {{since}}." },
  },
  checkedAt: AT,
  stateSince: AT,
  nextCheckAt: AT,
};

const CASE: StoredRow = {
  _id: CASE_ID,
  projectId: PROJECT_ID.toString(),
  caseNumber: 142,
  caseNumberWithPrefix: "CASE-142",
  title: "Password spray against Okta",
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
    name: "a custom role that reads cases and their checks",
    permissions: [
      Permission.ReadSecurityCase,
      Permission.ReadSecurityCaseStepCheck,
    ],
  },
];

const NOT_READERS: Array<Reader> = [
  { name: "Project Member", permissions: [Permission.ProjectMember] },
  { name: "Viewer", permissions: [Permission.Viewer] },
  {
    name: "a custom role that reads checks but no case",
    permissions: [Permission.ReadSecurityCaseStepCheck],
  },
  {
    name: "a custom role that reads cases but not their checks",
    permissions: [Permission.ReadSecurityCase],
  },
];

// The status the server refuses with (NotAuthorizedException).
const REFUSED: number = 422;

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let checks: InMemoryTable;

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

// The card's own read of a case's checks.
async function readTheCasesChecks(): Promise<SentRequest> {
  return server.request("POST", `${PATH}/get-list`, {
    query: { securityCaseId: CASE_ID },
    select: RESPONSE_STEP_CHECK_SELECT,
    sort: { createdAt: SortOrder.Ascending },
    limit: 100,
    skip: 0,
  });
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  // As packages/App/FeatureSet/BaseAPI/Index.ts mounts it.
  await server.start([
    new BaseAPI<SecurityCaseStepCheck, DatabaseService<BaseModel>>(
      SecurityCaseStepCheck,
      SecurityCaseStepCheckService as unknown as DatabaseService<BaseModel>,
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

  checks = useInMemoryTable(
    SecurityCaseStepCheckService as unknown as DatabaseService<BaseModel>,
    [{ ...CHECK }],
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

describe("a case's step checks over POST /api/security-case-step-check/get-list", () => {
  test.each(CASE_READERS)(
    "$name reads what OneUptime found of the case's steps, as the card asks for it",
    async (reader: Reader) => {
      caller = callerWith(reader.permissions);

      const sent: SentRequest = await readTheCasesChecks();

      expect({ reader: reader.name, status: sent.status }).toEqual({
        reader: reader.name,
        status: 200,
      });

      const rows: Array<JSONObject> = rowsOf(sent);

      expect(rows).toHaveLength(1);
      expect(rows[0]!["_id"]).toBe(CHECK_ID);
      expect(rows[0]!["stepKey"]).toBe(CHECK["stepKey"]);
      expect(rows[0]!["state"]).toBe(SecurityCaseStepCheckState.Verified);
      expect(rows[0]!["evidence"]).toEqual(CHECK["evidence"]);
    },
  );

  test.each(NOT_READERS)(
    "$name is refused, before the table is read",
    async (reader: Reader) => {
      caller = callerWith(reader.permissions);

      const sent: SentRequest = await readTheCasesChecks();

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

      const sent: SentRequest = await readTheCasesChecks();

      expect(sent.status).not.toBe(404);
    }
  });
});

describe("nobody writes a step check over the API", () => {
  test("a Project Owner cannot create one", async () => {
    const sent: SentRequest = await server.request("POST", PATH, {
      data: {
        projectId: PROJECT_ID.toString(),
        securityCaseId: CASE_ID,
        stepKey: "reset-password:maya@acme-commerce.example",
        state: SecurityCaseStepCheckState.Verified,
      },
    });

    expect(sent.status).toBe(REFUSED);
    expect(checks.inserts).toEqual([]);
  });

  test("a Project Owner cannot change one: OneUptime's finding stays as it found it", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `${PATH}/${CHECK_ID}`,
      { data: { state: SecurityCaseStepCheckState.NotDone } },
    );

    expect(sent.status).toBe(REFUSED);
    expect(checks.updates).toEqual([]);
    expect(checks.get(CHECK_ID)!["state"]).toBe(
      SecurityCaseStepCheckState.Verified,
    );
  });

  test("a Project Owner cannot delete one", async () => {
    const sent: SentRequest = await server.request(
      "DELETE",
      `${PATH}/${CHECK_ID}`,
    );

    expect(sent.status).toBe(REFUSED);
    expect(checks.deletes).toEqual([]);
    expect(checks.get(CHECK_ID)).toBeDefined();
  });
});
