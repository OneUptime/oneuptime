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
import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import DataAlertService from "../../../Server/Services/DataAlertService";
import DataAssetService from "../../../Server/Services/DataAssetService";
import DataSecurityFlowService from "../../../Server/Services/DataSecurityFlowService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataSecurityScanService from "../../../Server/Services/DataSecurityScanService";
import DataStoreAccessService from "../../../Server/Services/DataStoreAccessService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DataWarehouseJobService from "../../../Server/Services/DataWarehouseJobService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataSecurityFlow from "../../../Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityScan from "../../../Models/DatabaseModels/DataSecurityScan";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DataWarehouseJob from "../../../Models/DatabaseModels/DataWarehouseJob";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Select from "../../../Server/Types/Database/Select";
import RelationReaders from "../../../Types/Database/RelationReaders";
import RelationReadersUtil from "../../../Types/Database/RelationReadersUtil";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
 * WHAT EACH ROLE READS OF A DATA STORE THROUGH EACH RELATION, OVER HTTP
 * THROUGH THE SERVER'S OWN ROUTES (#10281).
 *
 * A data asset, a data alert and a data warehouse job name their store, and
 * Data Observability's readers read them: Viewer, Project Member, the
 * Telemetry tiers and a custom role that reads data assets. Until #10281 the
 * store's every column a relation reads was a label every reader of the
 * relation read, so any of them could send
 *
 *   POST /api/data-asset/get-list
 *   { "select": { "dataStore": { "sensitivity": true, "riskScore": true } } }
 *
 * and read every store's sensitivity, exposure, risk score, open issues and
 * cloud account - what the Data Store keeps to the Security tiers. Data
 * Security's own records name their store too - its issues, findings,
 * accesses, flows and scans - for the Security tiers and for a custom role
 * given one of them.
 *
 * Here every request goes over HTTP through Express's body parser, the
 * routes the App serves (DataObservabilityAPI for data assets, BaseAPI for
 * the rest), the permission layer and the error handler, into tables held
 * in memory that join the store as Postgres would (DashboardRequestsOverHttp,
 * InMemoryRepository):
 *
 *   - before: with the Data Store as 17.1.0 shipped it, every reader of a
 *     data asset reads the store's security facts - the leak;
 *   - after, through each of the nine relations, for each of its readers:
 *     which store it is (its name, kind, environment, whether it is
 *     archived) is answered; the store's security facts are answered for who
 *     may read the store (Project Owner, Project Admin, the Security tiers)
 *     and refused for everyone else, saying who may, before the table is
 *     read - and so is a filter or an order by one of them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10281000-0000-4000-8000-000000000001",
);
const STORE_ID: string = "10281000-0000-4000-8000-0000000000b1";

// The store as each record's row joins it: every column a relation reads.
const JOINED_STORE: StoredRow = {
  _id: STORE_ID,
  projectId: PROJECT_ID.toString(),
  name: "customer-exports",
  kind: "AWS S3 Bucket",
  environment: "Production",
  isArchived: false,
  description: "Nightly exports of every customer's orders.",
  storeKey: "aws:s3:customer-exports",
  provider: "aws",
  family: "Object Storage",
  discoveredFrom: "Cloud Inventory",
  providerResourceId: "arn:aws:s3:::customer-exports",
  cloudAccountNumber: "123456789012",
  region: "eu-west-1",
  sensitivity: "Restricted",
  sensitivityOverride: "Restricted",
  exposure: "Public",
  estimatedRecords: 120000,
  findingCount: 7,
  openIssueCount: 3,
  highestIssueSeverity: "Critical",
  riskScore: 92,
  isPublicByDesign: false,
  isAiData: true,
  probeConnectionVariable: "EXPORTS_DATABASE_URL",
  purpose: "Order fulfilment",
  retention: "7 years",
  contentScanStatus: "Scanned",
};

// Which store it is: what every reader of a relation to it reads.
const IDENTITY: Array<string> = ["name", "kind", "environment", "isArchived"];

const STORE_COLUMNS: Dictionary<TableColumnMetadata> = getTableColumns(
  new DataStore(),
);

// Every other column a relation reads: read only by who may read the store.
const SECURITY_FACTS: Array<string> = Object.keys(STORE_COLUMNS).filter(
  (column: string): boolean => {
    return RelationReadersUtil.isHeldToItsOwnRead(STORE_COLUMNS[column]);
  },
);

// The facts #10281 names, each selected alone below.
const NAMED_FACTS: Array<string> = [
  "sensitivity",
  "sensitivityOverride",
  "exposure",
  "riskScore",
  "openIssueCount",
  "highestIssueSeverity",
  "findingCount",
  "isPublicByDesign",
  "isAiData",
  "cloudAccountNumber",
  "providerResourceId",
  "probeConnectionVariable",
  "contentScanStatus",
  "estimatedRecords",
];

interface Reader {
  name: string;
  permissions: Array<Permission>;
  // Whether the reader may read the store itself.
  readsStore: boolean;
}

const OWNER: Reader = {
  name: "Project Owner",
  permissions: [Permission.ProjectOwner],
  readsStore: true,
};
const ADMIN: Reader = {
  name: "Project Admin",
  permissions: [Permission.ProjectAdmin],
  readsStore: true,
};

// Data Observability's readers: they read data assets, alerts and jobs.
const DATA_OBSERVABILITY_READERS: Array<Reader> = [
  OWNER,
  ADMIN,
  {
    name: "Project Member",
    permissions: [Permission.ProjectMember],
    readsStore: false,
  },
  { name: "Viewer", permissions: [Permission.Viewer], readsStore: false },
  {
    name: "Telemetry Admin",
    permissions: [Permission.TelemetryAdmin],
    readsStore: false,
  },
  {
    name: "Telemetry Member",
    permissions: [Permission.TelemetryMember],
    readsStore: false,
  },
  {
    name: "Telemetry Viewer",
    permissions: [Permission.TelemetryViewer],
    readsStore: false,
  },
  {
    name: "a custom role that reads data assets",
    permissions: [Permission.ReadDataAsset],
    readsStore: false,
  },
];

// Data Security's readers of a record: the Security tiers, and a custom role of the record's own.
function securityReaders(customRole: Permission): Array<Reader> {
  return [
    OWNER,
    ADMIN,
    {
      name: "Security Admin",
      permissions: [Permission.SecurityAdmin],
      readsStore: true,
    },
    {
      name: "Security Member",
      permissions: [Permission.SecurityMember],
      readsStore: true,
    },
    {
      name: "Security Viewer",
      permissions: [Permission.SecurityViewer],
      readsStore: true,
    },
    {
      name: `a custom role that holds ${customRole} alone`,
      permissions: [customRole],
      readsStore: false,
    },
  ];
}

interface Joiner {
  // "DataAsset.dataStore"
  name: string;
  path: string;
  service: DatabaseService<BaseModel>;
  relation: string;
  readers: Array<Reader>;
  /*
   * Whether a list read is answered by the tables held in memory: a data
   * alert's also asks which alerts are private, which they do not answer
   * (#10268). Its refusals come before the table is read.
   */
  isAnsweredInMemory: boolean;
}

const JOINERS: Array<Joiner> = [
  {
    name: "DataAsset.dataStore",
    path: "/api/data-asset/get-list",
    service: DataAssetService as unknown as DatabaseService<BaseModel>,
    relation: "dataStore",
    readers: DATA_OBSERVABILITY_READERS,
    isAnsweredInMemory: true,
  },
  {
    name: "DataAlert.dataStore",
    path: "/api/data-alert/get-list",
    service: DataAlertService as unknown as DatabaseService<BaseModel>,
    relation: "dataStore",
    readers: DATA_OBSERVABILITY_READERS,
    isAnsweredInMemory: false,
  },
  {
    name: "DataWarehouseJob.dataStore",
    path: "/api/data-warehouse-job/get-list",
    service: DataWarehouseJobService as unknown as DatabaseService<BaseModel>,
    relation: "dataStore",
    readers: DATA_OBSERVABILITY_READERS,
    isAnsweredInMemory: true,
  },
  {
    name: "DataSecurityIssue.dataStore",
    path: "/api/data-security-issue/get-list",
    service: DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    relation: "dataStore",
    readers: securityReaders(Permission.ReadDataSecurityIssue),
    isAnsweredInMemory: true,
  },
  {
    name: "DataStoreAccess.dataStore",
    path: "/api/data-store-access/get-list",
    service: DataStoreAccessService as unknown as DatabaseService<BaseModel>,
    relation: "dataStore",
    readers: securityReaders(Permission.ReadDataStoreAccess),
    isAnsweredInMemory: true,
  },
  {
    name: "DataStoreFinding.dataStore",
    path: "/api/data-store-finding/get-list",
    service: DataStoreFindingService as unknown as DatabaseService<BaseModel>,
    relation: "dataStore",
    readers: securityReaders(Permission.ReadDataStoreFinding),
    isAnsweredInMemory: true,
  },
  {
    name: "DataSecurityScan.dataStore",
    path: "/api/data-security-scan/get-list",
    service: DataSecurityScanService as unknown as DatabaseService<BaseModel>,
    relation: "dataStore",
    readers: securityReaders(Permission.ReadDataSecurityScan),
    isAnsweredInMemory: true,
  },
  {
    name: "DataSecurityFlow.sourceDataStore",
    path: "/api/data-security-flow/get-list",
    service: DataSecurityFlowService as unknown as DatabaseService<BaseModel>,
    relation: "sourceDataStore",
    readers: securityReaders(Permission.ReadDataSecurityFlow),
    isAnsweredInMemory: true,
  },
  {
    name: "DataSecurityFlow.destinationDataStore",
    path: "/api/data-security-flow/get-list",
    service: DataSecurityFlowService as unknown as DatabaseService<BaseModel>,
    relation: "destinationDataStore",
    readers: securityReaders(Permission.ReadDataSecurityFlow),
    isAnsweredInMemory: true,
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

// The store as the first record of a list's answer joins it.
function storeOf(sent: SentRequest, relation: string): JSONObject {
  const data: Array<JSONObject> = ((sent.answer as JSONObject)?.["data"] ||
    []) as Array<JSONObject>;

  return (data[0]?.[relation] || {}) as JSONObject;
}

// The store's columns an answer holds, but its id.
function columnsOf(store: JSONObject): Array<string> {
  return Object.keys(store)
    .filter((column: string): boolean => {
      return (
        !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
        !column.startsWith("_") &&
        store[column] !== undefined &&
        store[column] !== null
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

// The status the server refuses a read with (NotAuthorizedException).
const REFUSED: number = 422;

// Who may read the store, as a refusal names them.
const STORE_READERS_SENTENCE: string =
  "You need one of these permissions: Project Owner, Project Admin, Security Admin, Security Member, Security Viewer, Read Data Store.";

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function useJoiner(joiner: Joiner): InMemoryTable {
  return useInMemoryTable(
    joiner.service,
    [
      {
        _id: "10281000-0000-4000-8000-0000000000c1",
        projectId: PROJECT_ID.toString(),
        dataStoreId: STORE_ID,
        sourceDataStoreId: STORE_ID,
        destinationDataStoreId: STORE_ID,
        [joiner.relation]: { ...JOINED_STORE },
      },
    ],
    { answersOnlySelectedColumns: true },
  );
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

/*
 * The Data Store as 17.1.0 shipped it: every column a relation reads read
 * by every reader of the relation. The metadata is the model's own: planted
 * off, and put back.
 */
function asShippedIn1710(): () => void {
  const held: Array<TableColumnMetadata> = SECURITY_FACTS.map(
    (column: string): TableColumnMetadata => {
      return STORE_COLUMNS[column]!;
    },
  );

  for (const metadata of held) {
    delete metadata.relationReaders;
  }

  return (): void => {
    for (const metadata of held) {
      metadata.relationReaders = RelationReaders.ColumnReaders;
    }
  };
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    // The App serves data assets with Data Observability's own routes.
    new DataObservabilityAPI().getRouter(),
    new BaseAPI<DataAlert, DatabaseService<BaseModel>>(
      DataAlert,
      DataAlertService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataWarehouseJob, DatabaseService<BaseModel>>(
      DataWarehouseJob,
      DataWarehouseJobService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataSecurityIssue, DatabaseService<BaseModel>>(
      DataSecurityIssue,
      DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataStoreAccess, DatabaseService<BaseModel>>(
      DataStoreAccess,
      DataStoreAccessService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataStoreFinding, DatabaseService<BaseModel>>(
      DataStoreFinding,
      DataStoreFindingService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataSecurityScan, DatabaseService<BaseModel>>(
      DataSecurityScan,
      DataSecurityScanService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataSecurityFlow, DatabaseService<BaseModel>>(
      DataSecurityFlow,
      DataSecurityFlowService as unknown as DatabaseService<BaseModel>,
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the store's columns a relation reads", () => {
  test("are which store it is, read by every reader of the relation, and its security facts, read only by who may read the store", () => {
    const labels: Array<string> = Object.keys(STORE_COLUMNS).filter(
      (column: string): boolean => {
        return (
          !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
          column !== "projectId" &&
          RelationReadersUtil.isReadByEveryReaderOfTheRelation(
            STORE_COLUMNS[column],
          )
        );
      },
    );

    expect(labels.sort()).toEqual([...IDENTITY].sort());
    expect(SECURITY_FACTS).toHaveLength(42);
    expect(SECURITY_FACTS).toEqual(expect.arrayContaining(NAMED_FACTS));
  });
});

describe("before #10281: every reader of a data asset read the store's security facts", () => {
  const LEAKED: Array<string> = [
    "sensitivity",
    "exposure",
    "riskScore",
    "openIssueCount",
    "highestIssueSeverity",
    "cloudAccountNumber",
  ];

  test.each(
    DATA_OBSERVABILITY_READERS.filter((reader: Reader): boolean => {
      return !reader.readsStore;
    }).flatMap((reader: Reader): Array<[string, string, Joiner, Reader]> => {
      return JOINERS.filter((joiner: Joiner): boolean => {
        return (
          joiner.isAnsweredInMemory &&
          joiner.readers === DATA_OBSERVABILITY_READERS
        );
      }).map((joiner: Joiner): [string, string, Joiner, Reader] => {
        return [reader.name, joiner.name, joiner, reader];
      });
    }),
  )(
    "%s read them through %s",
    async (_who: string, _through: string, joiner: Joiner, reader: Reader) => {
      const putBack: () => void = asShippedIn1710();

      try {
        caller = callerWith(reader.permissions);

        const { sent } = await send(joiner, {
          select: selectOf(joiner, ["name", ...LEAKED]),
        });

        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: 200,
          refusal: "",
        });
        expect(storeOf(sent, joiner.relation)).toEqual(
          expect.objectContaining({
            name: "customer-exports",
            sensitivity: "Restricted",
            exposure: "Public",
            riskScore: 92,
            openIssueCount: 3,
            highestIssueSeverity: "Critical",
            cloudAccountNumber: "123456789012",
          }),
        );
      } finally {
        putBack();
      }
    },
  );
});

describe("through each relation, each reader reads which store it is", () => {
  test.each(CASES)(
    "%s: %s",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      caller = callerWith(reader.permissions);

      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, IDENTITY),
      });

      if (!joiner.isAnsweredInMemory) {
        // Past the permission checks, into the table (see isAnsweredInMemory).
        expect(table.repository.find).toHaveBeenCalled();
        return;
      }

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      // Which store it is, and nothing else of it.
      expect(columnsOf(storeOf(sent, joiner.relation))).toEqual(
        [...IDENTITY].sort(),
      );
      expect(storeOf(sent, joiner.relation)).toEqual(
        expect.objectContaining({
          name: "customer-exports",
          kind: "AWS S3 Bucket",
          environment: "Production",
          isArchived: false,
        }),
      );
    },
  );
});

describe("through each relation, the store's security facts are read only by who may read the store", () => {
  test.each(CASES)(
    "%s: %s",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      caller = callerWith(reader.permissions);

      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, ["name", ...SECURITY_FACTS]),
      });

      if (!reader.readsStore) {
        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: REFUSED,
          refusal: `You do not have permissions to read ${SECURITY_FACTS[0]} of Data Store through ${joiner.relation} on ${new (joiner.service.modelType as { new (): BaseModel })().singularName}. ${STORE_READERS_SENTENCE}`,
        });
        // Refused before the table is read.
        expect(table.repository.find).not.toHaveBeenCalled();
        return;
      }

      if (!joiner.isAnsweredInMemory) {
        expect(table.repository.find).toHaveBeenCalled();
        return;
      }

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(storeOf(sent, joiner.relation)).toEqual(
        expect.objectContaining({
          name: "customer-exports",
          sensitivity: "Restricted",
          exposure: "Public",
          riskScore: 92,
          openIssueCount: 3,
          cloudAccountNumber: "123456789012",
          providerResourceId: "arn:aws:s3:::customer-exports",
        }),
      );
    },
  );

  test.each(
    NAMED_FACTS.flatMap((fact: string): Array<[string, string, Joiner]> => {
      return JOINERS.filter((joiner: Joiner): boolean => {
        return joiner.readers === DATA_OBSERVABILITY_READERS;
      }).map((joiner: Joiner): [string, string, Joiner] => {
        return [fact, joiner.name, joiner];
      });
    }),
  )(
    "a Viewer selecting the store's %s alone through %s is refused, saying who may",
    async (fact: string, _through: string, joiner: Joiner) => {
      caller = callerWith([Permission.Viewer]);

      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, ["name", fact]),
      });

      expect(sent.status).toBe(REFUSED);
      expect(refusalOf(sent)).toContain(
        `You do not have permissions to read ${fact} of Data Store through dataStore`,
      );
      expect(refusalOf(sent)).toContain(STORE_READERS_SENTENCE);
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );
});

describe("a filter or an order by a store's security fact reads it, and is held to the store's read", () => {
  test.each(
    JOINERS.filter((joiner: Joiner): boolean => {
      return joiner.readers === DATA_OBSERVABILITY_READERS;
    }),
  )(
    "a Viewer filtering $name by the store's sensitivity is refused",
    async (joiner: Joiner) => {
      caller = callerWith([Permission.Viewer]);

      const { sent, table } = await send(joiner, {
        query: { [joiner.relation]: { sensitivity: "Restricted" } },
        select: { _id: true },
      });

      expect(sent.status).toBe(REFUSED);
      expect(refusalOf(sent)).toContain(
        "You do not have permissions to query on - sensitivity of Data Store through dataStore.",
      );
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );

  test.each(
    JOINERS.filter((joiner: Joiner): boolean => {
      return joiner.readers === DATA_OBSERVABILITY_READERS;
    }),
  )(
    "a Viewer ordering $name by the store's risk score is refused",
    async (joiner: Joiner) => {
      caller = callerWith([Permission.Viewer]);

      const { sent, table } = await send(joiner, {
        select: { _id: true },
        sort: { [joiner.relation]: { riskScore: "DESC" } },
      });

      expect(sent.status).toBe(REFUSED);
      expect(refusalOf(sent)).toContain(
        "You do not have permissions to sort on - riskScore of Data Store through dataStore.",
      );
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );

  test("before #10281, the Viewer's filter by the store's sensitivity was answered: a yes or no on each store", async () => {
    const putBack: () => void = asShippedIn1710();

    try {
      caller = callerWith([Permission.Viewer]);

      const { sent } = await send(JOINERS[0]!, {
        query: { dataStore: { sensitivity: "Restricted" } },
        select: { _id: true },
      });

      expect(refusalOf(sent)).not.toContain("You do not have permissions");
    } finally {
      putBack();
    }
  });
});

describe("the select a read on a reader's behalf sends: what they may read of the store", () => {
  const ASKED: Select<DataAsset> = {
    _id: true,
    name: true,
    dataStore: { name: true, kind: true, sensitivity: true, riskScore: true },
  } as Select<DataAsset>;

  test.each([
    ["a Viewer", [Permission.Viewer], { name: true, kind: true }],
    [
      "a Telemetry Viewer",
      [Permission.TelemetryViewer],
      { name: true, kind: true },
    ],
    [
      "a Project Owner",
      [Permission.ProjectOwner],
      { name: true, kind: true, sensitivity: true, riskScore: true },
    ],
  ] as Array<[string, Array<Permission>, JSONObject]>)(
    "%s",
    (_who: string, permissions: Array<Permission>, store: JSONObject) => {
      expect(
        QueryPermission.getSelectReadableThroughRelations({
          modelType: DataAsset,
          select: ASKED,
          props: callerWith(permissions),
        }),
      ).toEqual({ _id: true, name: true, dataStore: store });
    },
  );

  test("OneUptime itself reads everything, and the select handed in is never changed", () => {
    const asked: JSONObject = JSON.parse(JSON.stringify(ASKED));

    expect(
      QueryPermission.getSelectReadableThroughRelations({
        modelType: DataAsset,
        select: ASKED,
        props: { isRoot: true },
      }),
    ).toEqual(ASKED);

    QueryPermission.getSelectReadableThroughRelations({
      modelType: DataAsset,
      select: ASKED,
      props: callerWith([Permission.Viewer]),
    });

    expect(ASKED).toEqual(asked);
  });

  test("a relation all of whose columns are left out keeps its id", () => {
    expect(
      QueryPermission.getSelectReadableThroughRelations({
        modelType: DataAsset,
        select: {
          _id: true,
          dataStore: { sensitivity: true },
        } as Select<DataAsset>,
        props: callerWith([Permission.Viewer]),
      }),
    ).toEqual({ _id: true, dataStore: { _id: true } });
  });
});
