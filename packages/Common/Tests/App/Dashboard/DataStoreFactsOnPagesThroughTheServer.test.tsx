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
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";

/*
 * WHAT EACH ROLE IS SHOWN OF A DATA STORE ON THE PAGES THAT NAME IT,
 * ANSWERED BY THE SERVER ITSELF (#10281).
 *
 * A relation reads a data store's security facts - its sensitivity,
 * exposure, region, keys - only for who may read the store: Project Owner,
 * Project Admin, the Security tiers. Before, it read them for every reader
 * of the record that names the store. The pages that showed them through a
 * relation now ask for them only for the readers who may read them
 * (PermissionGate.getSelectReadableThroughRelations), and show everyone
 * else the rest, in one read, rather than being refused all of it:
 *
 *   - a data security issue's page, for each of its readers: the issue and
 *     which store it is on for everyone; the store's sensitivity and
 *     exposure for who may read the store, and never "Public" in place of a
 *     sensitivity it did not read;
 *   - an identity's reach (What It Can Reach), for each reader of accesses:
 *     the stores, and their sensitivity for who may read stores;
 *   - a data alert's lineage, for each of Data Observability's readers: the
 *     read it sends names its store by its name alone, which every one of
 *     them reads.
 *
 * Everything on the Dashboard's side is real but the socket: its API client
 * sends each request over HTTP to the server's own routes, the permission
 * layer and the error handler (DashboardRequestsOverHttp), with tables held
 * in memory that join the store as Postgres does.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

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

import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import IdentityReachList, {
  IDENTITY_REACH_LIST_ID,
  IDENTITY_REACH_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IdentityReachList";
import { DATA_ALERT_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataAlertLineage";
import DataSecurityIssueViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/Layout";
import { DATA_SECURITY_ISSUE_VIEW_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/IssueViewContext";
import DataSecurityIssueOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import DataAlertService from "../../../Server/Services/DataAlertService";
import DataSecurityCustomDataTypeService from "../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../Server/Services/DataStoreAccessService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: ObjectID = new ObjectID(
  "10281000-0000-4000-8000-000000000002",
);
const ISSUE_ID: string = "10281000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10281000-0000-4000-8000-0000000000b1";
const ACCESS_ID: string = "10281000-0000-4000-8000-0000000000d1";
const ALERT_ID: string = "10281000-0000-4000-8000-0000000000e1";
const PRINCIPAL: string = "arn:aws:iam::123456789012:role/exporter";

const ISSUE_PATH: string = `/api/data-security-issue/${ISSUE_ID}/get-item`;
const TITLE: string = "Anyone on the internet can read it";

const FLOW_TIMEOUT_IN_MS: number = 60000;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW] as Route,
  currentProject: null,
  hasPaymentMethod: true,
};

// The store as a record's row joins it: every column a relation reads.
const JOINED_STORE: StoredRow = {
  _id: STORE_ID,
  projectId: PROJECT_ID.toString(),
  name: "customer-exports",
  kind: "AWS S3 Bucket",
  environment: "Production",
  isArchived: false,
  region: "eu-west-1",
  sensitivity: "Restricted",
  exposure: "Public",
  riskScore: 92,
  serviceId: null,
  storeKey: "aws:s3:customer-exports",
};

interface Reader {
  name: string;
  permissions: Array<Permission>;
  // Whether the reader may read the store itself.
  readsStore: boolean;
}

function readersOf(customRole: Permission): Array<Reader> {
  return [
    {
      name: "a project owner",
      permissions: [Permission.ProjectOwner],
      readsStore: true,
    },
    {
      name: "a project admin",
      permissions: [Permission.ProjectAdmin],
      readsStore: true,
    },
    {
      name: "a security admin",
      permissions: [Permission.SecurityAdmin],
      readsStore: true,
    },
    {
      name: "a security member",
      permissions: [Permission.SecurityMember],
      readsStore: true,
    },
    {
      name: "a security viewer",
      permissions: [Permission.SecurityViewer],
      readsStore: true,
    },
    {
      name: `a custom role that holds ${customRole} and not Read Data Store`,
      permissions: [customRole],
      readsStore: false,
    },
  ];
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function setCaller(permissions: Array<Permission>): void {
  caller = {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

function selectSent(sent: SentRequest): JSONObject {
  return (sent.body as JSONObject)["select"] as JSONObject;
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<DataSecurityIssue, DatabaseService<BaseModel>>(
      DataSecurityIssue,
      DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new DataSecurityAPI().getRouter(),
    new BaseAPI<DataSecurityCustomDataType, DatabaseService<BaseModel>>(
      DataSecurityCustomDataType,
      DataSecurityCustomDataTypeService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataStoreAccess, DatabaseService<BaseModel>>(
      DataStoreAccess,
      DataStoreAccessService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataAlert, DatabaseService<BaseModel>>(
      DataAlert,
      DataAlertService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;

  const project: Project = new Project();
  project.id = PROJECT_ID;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest
    .spyOn(DataSecurityApi, "getResponseActions")
    .mockResolvedValue({ actions: [] } as never);

  useInMemoryTable(
    DataSecurityIssueService,
    [
      {
        _id: ISSUE_ID,
        projectId: PROJECT_ID.toString(),
        title: TITLE,
        checkId: "public-read",
        checkGroup: "Exposure",
        evidence: "The bucket policy grants s3:GetObject to Principal *.",
        severity: "Critical",
        status: "Open",
        riskScore: 92,
        dataTypeIds: ["credit-card-number"],
        dataStoreId: STORE_ID,
        dataStore: { ...JOINED_STORE },
        firstDetectedAt: new Date("2026-11-19T08:00:00.000Z"),
        lastDetectedAt: new Date("2026-11-20T08:00:00.000Z"),
      },
    ],
    { answersOnlySelectedColumns: true },
  );
  useInMemoryTable(DataStoreService, [{ ...JOINED_STORE }], {
    answersOnlySelectedColumns: true,
  });
  useInMemoryTable(DataSecurityCustomDataTypeService, []);
  useInMemoryTable(
    DataStoreAccessService,
    [
      {
        _id: ACCESS_ID,
        projectId: PROJECT_ID.toString(),
        principal: PRINCIPAL,
        dataStoreId: STORE_ID,
        accessLevel: "Read",
        grantedVia: "Bucket policy",
        dataStore: { ...JOINED_STORE },
        createdAt: new Date("2026-11-19T08:00:00.000Z"),
      },
    ],
    { answersOnlySelectedColumns: true },
  );

  setCaller([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderIssuePage(): Promise<void> {
  const path: string = `/dashboard/${PROJECT_ID.toString()}/data-security/issues/${ISSUE_ID}`;

  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "issue",
  });

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <RouterRoute
            path="/dashboard/:projectId/data-security/issues/:id"
            element={<DataSecurityIssueViewLayout {...PAGE_PROPS} />}
          >
            <RouterRoute
              index
              element={<DataSecurityIssueOverviewPage {...PAGE_PROPS} />}
            />
          </RouterRoute>
        </Routes>
      </MemoryRouter>,
    );
  });
}

describe("a data security issue's page, for each reader of issues", () => {
  test.each(
    readersOf(Permission.ReadDataSecurityIssue).map(
      (reader: Reader): [string, Reader] => {
        return [reader.name, reader];
      },
    ),
  )(
    "%s",
    async (_who: string, reader: Reader) => {
      setCaller(reader.permissions);

      await renderIssuePage();

      await waitFor(() => {
        expect(
          screen.getByTestId("data-security-issue-what-is-wrong"),
        ).toBeInTheDocument();
      });

      // The issue, and which store it is on, in one read the server answered.
      expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
      expect(screen.getByText("On customer-exports")).toBeInTheDocument();

      const reads: Array<SentRequest> = server.sentTo("POST", ISSUE_PATH);

      expect(
        reads.map((sent: SentRequest): number => {
          return sent.status;
        }),
      ).toEqual([200]);
      expect(
        screen.queryByTestId("data-security-issue-parts-not-loaded"),
      ).not.toBeInTheDocument();

      const storeAsked: JSONObject = selectSent(reads[0]!)[
        "dataStore"
      ] as JSONObject;
      const holds: HTMLElement = screen.getByTestId(
        "data-security-issue-store-holds",
      );

      if (reader.readsStore) {
        expect(storeAsked).toEqual(
          (DATA_SECURITY_ISSUE_VIEW_SELECT as JSONObject)["dataStore"],
        );
        expect(within(holds).getByText("Restricted")).toBeInTheDocument();
        expect(screen.getByText("Public")).toBeInTheDocument();
        return;
      }

      // Which store it is; nothing the store's own read keeps to its readers.
      expect(Object.keys(storeAsked).sort()).toEqual(
        ["_id", "environment", "kind", "name"].sort(),
      );
      expect(within(holds).queryByText("Restricted")).not.toBeInTheDocument();
      expect(within(holds).queryByText("Public")).not.toBeInTheDocument();
    },
    FLOW_TIMEOUT_IN_MS,
  );
});

describe("an identity's reach, for each reader of accesses", () => {
  test.each(
    readersOf(Permission.ReadDataStoreAccess).map(
      (reader: Reader): [string, Reader] => {
        return [reader.name, reader];
      },
    ),
  )(
    "%s",
    async (_who: string, reader: Reader) => {
      setCaller(reader.permissions);

      await act(async () => {
        render(
          <MemoryRouter>
            <IdentityReachList principal={PRINCIPAL} />
          </MemoryRouter>,
        );
      });

      await waitFor(() => {
        expect(screen.getByText("customer-exports")).toBeInTheDocument();
      });

      const reads: Array<SentRequest> = server.sentTo(
        "POST",
        "/api/data-store-access/get-list",
      );

      expect(
        reads.map((sent: SentRequest): number => {
          return sent.status;
        }),
      ).toEqual([200]);

      const list: HTMLElement = screen.getByTestId(IDENTITY_REACH_LIST_ID);

      if (reader.readsStore) {
        expect(selectSent(reads[0]!)).toEqual(IDENTITY_REACH_SELECT);
        expect(within(list).getByText("Sensitivity")).toBeInTheDocument();
        expect(within(list).getByText("Restricted")).toBeInTheDocument();
        return;
      }

      expect(selectSent(reads[0]!)["dataStore"]).toEqual({
        name: true,
        kind: true,
      });
      expect(within(list).queryByText("Sensitivity")).not.toBeInTheDocument();
      expect(within(list).queryByText("Restricted")).not.toBeInTheDocument();
      expect(within(list).queryByText("Public")).not.toBeInTheDocument();
    },
    FLOW_TIMEOUT_IN_MS,
  );
});

describe("a data alert's lineage, for each of Data Observability's readers", () => {
  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["a telemetry admin", [Permission.TelemetryAdmin]],
    ["a telemetry member", [Permission.TelemetryMember]],
    ["a telemetry viewer", [Permission.TelemetryViewer]],
    ["a custom role that reads data assets", [Permission.ReadDataAsset]],
  ] as Array<[string, Array<Permission>]>)(
    "%s: its read names the store by its name alone, and the server takes it",
    async (_who: string, permissions: Array<Permission>) => {
      setCaller(permissions);

      const alerts: InMemoryTable = useInMemoryTable(DataAlertService, [
        {
          _id: "10281000-0000-4000-8000-0000000000e2",
          projectId: PROJECT_ID.toString(),
          alertId: ALERT_ID,
          dataStoreId: STORE_ID,
          dataStore: { ...JOINED_STORE },
        },
      ]);

      expect(DATA_ALERT_SELECT.dataStore).toEqual({ name: true });

      try {
        await ModelAPI.getList<DataAlert>({
          modelType: DataAlert,
          query: { alertId: new ObjectID(ALERT_ID) },
          select: DATA_ALERT_SELECT as never,
          limit: 1,
          skip: 0,
          sort: {},
        });
      } catch {
        /*
         * A data alert's read also asks which alerts are private, which the
         * tables held in memory do not answer (#10268): what is under test
         * is that the permission layer let it through to the table.
         */
      }

      const sent: Array<SentRequest> = server.sentTo(
        "POST",
        "/api/data-alert/get-list",
      );

      expect(sent).toHaveLength(1);
      expect(
        String((sent[0]!.answer as JSONObject)?.["error"] || ""),
      ).not.toContain("You do not have permissions");
      expect(alerts.repository.find).toHaveBeenCalled();
    },
    FLOW_TIMEOUT_IN_MS,
  );
});
