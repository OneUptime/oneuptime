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

import { DATA_SECURITY_ISSUE_VIEW_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/IssueViewContext";
import {
  STORE_DATA_TYPES_SELECT,
  readStoreDataTypes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreDataTypes";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import DataAlertService from "../../../Server/Services/DataAlertService";
import DataAssetService from "../../../Server/Services/DataAssetService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DataWarehouseJobService from "../../../Server/Services/DataWarehouseJobService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataWarehouseJob from "../../../Models/DatabaseModels/DataWarehouseJob";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Select from "../../../Types/BaseDatabase/Select";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
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
 * A DATA SECURITY ISSUE'S PAGE, READ THROUGH THE SERVER'S OWN ROUTES OVER
 * HTTP (#10238).
 *
 * Clicking a data security alert opened its issue, and the page said only
 * "Column dataTypeIds on Data Store does not support read on relation
 * query." The issue's layout reads the issue with its store in one select
 * (DATA_SECURITY_ISSUE_VIEW_SELECT), and from 14.0.99 that select named the
 * store's data types through the relation: a column the Data Store keeps off
 * relation reads, so the server refused the whole read, for everyone, and
 * the layout put its sentence in place of the page.
 *
 * Here the Dashboard's own requests - ModelAPI, as the page sends them - go
 * over HTTP through Express's body parser, BaseAPI, the permission layer
 * (QueryPermission.checkRelationQueryPermission, where the sentence comes
 * from) and the error handler, into tables held in memory
 * (DashboardRequestsOverHttp):
 *
 *   - the read the page sent until now is refused with the customer's very
 *     sentence, before the table is read;
 *   - the read it sends now is answered, for everyone who reads issues;
 *   - the store's data types are read from the store, by the store's own
 *     read permissions (StoreDataTypes.ts);
 *   - and no relation reads them: a Data Asset, a Data Alert and a Data
 *     Warehouse Job join their store for every viewer and member, and
 *     17.0.0 made the column readable through every relation to make the
 *     page load - which let each of them read which kinds of data every
 *     store holds.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10238000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10238000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10238000-0000-4000-8000-0000000000b1";
const ASSET_ID: string = "10238000-0000-4000-8000-0000000000c1";
const ALERT_ID: string = "10238000-0000-4000-8000-0000000000c2";
const JOB_ID: string = "10238000-0000-4000-8000-0000000000c3";

// The sentence the customer's page showed in place of the issue.
const CUSTOMERS_SENTENCE: string =
  "Column dataTypeIds on Data Store does not support read on relation query.";

const STORE_DATA_TYPES: Array<string> = ["credit-card-number", "email-address"];

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

// Everyone who reads data security issues, by the issue's read permissions.
const ISSUE_READERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a security admin", [Permission.SecurityAdmin]],
  ["a security member", [Permission.SecurityMember]],
  ["a security viewer", [Permission.SecurityViewer]],
  ["a custom role that reads issues", [Permission.ReadDataSecurityIssue]],
];

// The store as the issue's row joins it: what a relation read answers.
function joinedStore(): StoredRow {
  return {
    _id: STORE_ID,
    name: "customer-exports",
    kind: "AWS S3 Bucket",
    region: "eu-west-1",
    environment: "Production",
    sensitivity: "Restricted",
    exposure: "Public",
    storeKey: "aws:s3:customer-exports",
  };
}

function storedIssue(): StoredRow {
  return {
    _id: ISSUE_ID,
    projectId: PROJECT_ID.toString(),
    title: "Anyone on the internet can read it",
    checkId: "public-read",
    checkGroup: "Exposure",
    evidence: "The bucket policy grants s3:GetObject to Principal *.",
    severity: "Critical",
    status: "Open",
    riskScore: 92,
    dataTypeIds: ["credit-card-number"],
    dataStoreId: STORE_ID,
    dataStore: joinedStore(),
    firstDetectedAt: new Date("2026-11-19T08:00:00.000Z"),
    lastDetectedAt: new Date("2026-11-20T08:00:00.000Z"),
  };
}

function storedStore(): StoredRow {
  return {
    ...joinedStore(),
    projectId: PROJECT_ID.toString(),
    dataTypeIds: STORE_DATA_TYPES,
  };
}

/*
 * The select the page sent from 14.0.99 to 17.0.0: today's, with the
 * store's data types read through the relation.
 */
const SELECT_UNTIL_NOW: Select<DataSecurityIssue> = {
  ...DATA_SECURITY_ISSUE_VIEW_SELECT,
  dataStore: {
    ...(DATA_SECURITY_ISSUE_VIEW_SELECT.dataStore as JSONObject),
    dataTypeIds: true,
  },
} as Select<DataSecurityIssue>;

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

let server: DashboardRequestsOverHttp;
let issues: InMemoryTable;
let stores: InMemoryTable;
let caller: DatabaseCommonInteractionProps;

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<DataSecurityIssue, DatabaseService<BaseModel>>(
      DataSecurityIssue,
      DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    // The App serves the store's routes with Data Security's own.
    new DataSecurityAPI().getRouter(),
    new BaseAPI<DataAsset, DatabaseService<BaseModel>>(
      DataAsset,
      DataAssetService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataAlert, DatabaseService<BaseModel>>(
      DataAlert,
      DataAlertService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataWarehouseJob, DatabaseService<BaseModel>>(
      DataWarehouseJob,
      DataWarehouseJobService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  issues = useInMemoryTable(DataSecurityIssueService, [storedIssue()], {
    answersOnlySelectedColumns: true,
  });
  stores = useInMemoryTable(DataStoreService, [storedStore()], {
    answersOnlySelectedColumns: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the issue page's read, through the server", () => {
  test("the read the page sent until now is refused with the very sentence the customer saw, before the table is read", async () => {
    let message: string = "";

    try {
      await ModelAPI.getItem<DataSecurityIssue>({
        modelType: DataSecurityIssue,
        id: new ObjectID(ISSUE_ID),
        select: SELECT_UNTIL_NOW,
      });
    } catch (err) {
      message = API.getFriendlyMessage(err as Error);
    }

    expect(message).toBe(CUSTOMERS_SENTENCE);

    const sent: Array<SentRequest> = server.sentTo(
      "POST",
      `/api/data-security-issue/${ISSUE_ID}/get-item`,
    );

    expect(sent).toHaveLength(1);
    expect({ status: sent[0]!.status, refusal: refusalOf(sent[0]!) }).toEqual({
      status: 400,
      refusal: CUSTOMERS_SENTENCE,
    });
    // As the Dashboard sent it: the store's data types through the relation.
    expect(
      ((sent[0]!.body as JSONObject)["select"] as JSONObject)["dataStore"],
    ).toEqual(expect.objectContaining({ dataTypeIds: true }));
    expect(issues.repository.find).not.toHaveBeenCalled();
  });

  test.each(ISSUE_READERS)(
    "the read the page sends now is answered for %s: the issue, and the store it is on",
    async (_who: string, permissions: Array<Permission>) => {
      caller = callerWith(permissions);
      // The page's own select for this reader (the layout's, #10281).
      PermissionGate.clearPermissionPropsCache();
      jest
        .spyOn(PermissionUtil, "getAllPermissions")
        .mockReturnValue(permissions);

      const issue: DataSecurityIssue | null =
        await ModelAPI.getItem<DataSecurityIssue>({
          modelType: DataSecurityIssue,
          id: new ObjectID(ISSUE_ID),
          select: PermissionGate.getSelectReadableThroughRelations(
            DataSecurityIssue,
            DATA_SECURITY_ISSUE_VIEW_SELECT,
          ),
        });

      const sent: Array<SentRequest> = server.sentTo(
        "POST",
        `/api/data-security-issue/${ISSUE_ID}/get-item`,
      );

      expect({ status: sent[0]!.status, refusal: refusalOf(sent[0]!) }).toEqual(
        { status: 200, refusal: "" },
      );
      expect(issue?.title).toBe("Anyone on the internet can read it");
      expect(issue?.dataTypeIds).toEqual(["credit-card-number"]);
      expect(issue?.dataStore?.name).toBe("customer-exports");

      /*
       * The store's sensitivity and exposure: read through the issue only by
       * who may read the store (#10281). A custom role that reads issues and
       * not stores sends the read without them.
       */
      const readsStores: boolean = !permissions.includes(
        Permission.ReadDataSecurityIssue,
      );

      expect({
        sensitivity: issue?.dataStore?.sensitivity,
        exposure: issue?.dataStore?.exposure,
      }).toEqual(
        readsStores
          ? { sensitivity: "Restricted", exposure: "Public" }
          : { sensitivity: undefined, exposure: undefined },
      );
    },
  );

  test("the page's select reads nothing through the store's relation that the store keeps off relation reads", () => {
    const relatedStore: DataStore = new DataStore();
    const storeSelect: JSONObject =
      DATA_SECURITY_ISSUE_VIEW_SELECT.dataStore as JSONObject;

    expect(Object.keys(storeSelect)).not.toContain("dataTypeIds");

    for (const column of Object.keys(storeSelect)) {
      const metadata: TableColumnMetadata =
        relatedStore.getTableColumnMetadata(column);

      expect({
        column: column,
        isReadable:
          column === "_id" || Boolean(metadata.canReadOnRelationQuery),
      }).toEqual({ column: column, isReadable: true });
    }
  });
});

describe("the store's data types, read from the store", () => {
  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a security viewer", [Permission.SecurityViewer]],
    ["a custom role that reads stores", [Permission.ReadDataStore]],
  ] as Array<[string, Array<Permission>]>)(
    "%s reads them, by the store's own read",
    async (_who: string, permissions: Array<Permission>) => {
      caller = callerWith(permissions);

      expect(await readStoreDataTypes(new ObjectID(STORE_ID))).toEqual(
        STORE_DATA_TYPES,
      );

      const sent: Array<SentRequest> = server.sentTo(
        "POST",
        `/api/data-store/${STORE_ID}/get-item`,
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]!.status).toBe(200);
      expect((sent[0]!.body as JSONObject)["select"]).toEqual(
        STORE_DATA_TYPES_SELECT,
      );
      expect(stores.repository.find).toHaveBeenCalled();
    },
  );

  test("someone who may read issues but not stores is refused them, and says who may", async () => {
    caller = callerWith([Permission.ReadDataSecurityIssue]);

    let message: string = "";

    try {
      await readStoreDataTypes(new ObjectID(STORE_ID));
    } catch (err) {
      message = API.getFriendlyMessage(err as Error);
    }

    const sent: Array<SentRequest> = server.sentTo(
      "POST",
      `/api/data-store/${STORE_ID}/get-item`,
    );

    expect(sent[0]!.status).toBeGreaterThanOrEqual(400);
    expect(sent[0]!.status).toBeLessThan(500);
    expect(message).toContain("Data Store");
  });

  test("a store that is not there has none", async () => {
    stores.rows.length = 0;

    expect(await readStoreDataTypes(new ObjectID(STORE_ID))).toEqual([]);
  });
});

describe("no relation reads a store's data types", () => {
  interface Joiner {
    name: string;
    path: string;
    service: DatabaseService<BaseModel>;
    row: StoredRow;
  }

  // Every model a viewer, a member or a Telemetry role reads that joins its store.
  const JOINERS: Array<Joiner> = [
    {
      name: "a data asset",
      path: "/api/data-asset/get-list",
      service: DataAssetService as unknown as DatabaseService<BaseModel>,
      row: { _id: ASSET_ID, dataStoreId: STORE_ID },
    },
    {
      name: "a data alert",
      path: "/api/data-alert/get-list",
      service: DataAlertService as unknown as DatabaseService<BaseModel>,
      row: { _id: ALERT_ID, dataStoreId: STORE_ID },
    },
    {
      name: "a data warehouse job",
      path: "/api/data-warehouse-job/get-list",
      service: DataWarehouseJobService as unknown as DatabaseService<BaseModel>,
      row: { _id: JOB_ID, dataStoreId: STORE_ID },
    },
  ];

  function useJoiner(joiner: Joiner): InMemoryTable {
    return useInMemoryTable(joiner.service, [
      {
        ...joiner.row,
        projectId: PROJECT_ID.toString(),
        dataStore: { ...joinedStore(), dataTypeIds: STORE_DATA_TYPES },
      },
    ]);
  }

  test.each(JOINERS)(
    "a viewer reading $name with its store's data types is refused, before the table is read",
    async (joiner: Joiner) => {
      const table: InMemoryTable = useJoiner(joiner);
      caller = callerWith([Permission.Viewer]);

      const refused: SentRequest = await server.request("POST", joiner.path, {
        query: {},
        select: { _id: true, dataStore: { name: true, dataTypeIds: true } },
        limit: 10,
        skip: 0,
      });

      expect({ status: refused.status, refusal: refusalOf(refused) }).toEqual({
        status: 400,
        refusal: CUSTOMERS_SENTENCE,
      });
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );

  /*
   * The relation itself is a viewer's to read: it is the data types that
   * are not. (A data alert's read also asks which alerts are private, a
   * condition the tables held in memory do not answer: its refusal above is
   * what this file is about.)
   */
  test.each(
    JOINERS.filter((joiner: Joiner): boolean => {
      return joiner.name !== "a data alert";
    }),
  )(
    "a viewer reading $name with its store's name is answered",
    async (joiner: Joiner) => {
      const table: InMemoryTable = useJoiner(joiner);
      caller = callerWith([Permission.Viewer]);

      const answered: SentRequest = await server.request("POST", joiner.path, {
        query: {},
        select: { _id: true, dataStore: { name: true } },
        limit: 10,
        skip: 0,
      });

      expect({ status: answered.status, refusal: refusalOf(answered) }).toEqual(
        { status: 200, refusal: "" },
      );
      expect(table.repository.find).toHaveBeenCalled();
    },
  );

  test("the Data Store keeps its data types off relation reads, as it does their categories and countries", () => {
    const store: DataStore = new DataStore();

    for (const column of [
      "dataTypeIds",
      "dataCategories",
      "subjectCountries",
    ]) {
      expect({
        column: column,
        canReadOnRelationQuery: Boolean(
          store.getTableColumnMetadata(column).canReadOnRelationQuery,
        ),
      }).toEqual({ column: column, canReadOnRelationQuery: false });
    }
  });
});
