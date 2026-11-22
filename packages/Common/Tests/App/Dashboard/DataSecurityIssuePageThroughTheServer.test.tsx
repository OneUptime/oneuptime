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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";

/*
 * A DATA SECURITY ISSUE'S PAGE, ANSWERED BY THE SERVER ITSELF (#10238).
 *
 * "I just started using OneUptime and received a data security alert. When
 * clicking on it to drill into it I'm getting below page": the page said
 * only "Column dataTypeIds on Data Store does not support read on relation
 * query." The issue's layout read the issue with its store's data types
 * through the relation, which the server refuses, and put the refusal in
 * place of the whole page.
 *
 * Here the issue's own layout and Overview are drawn against the server.
 * Nothing on the Dashboard's side is replaced but the socket: its API client
 * sends every request over HTTP to the server's own routes - BaseAPI for
 * the issue and Data Security's API for its store, Express's body parser,
 * the permission layer and the error handler (DashboardRequestsOverHttp) -
 * with the tables held in memory. Only the store's response actions, which
 * read its cloud, are stood in for.
 *
 *   - The page opens on the issue: what is wrong, the store it is on, and
 *     the data types the issue was assessed with - in one read.
 *   - An issue with none of its own shows its store's, read from the store
 *     by the store's own read permissions; someone who may read issues and
 *     not stores is told they could not be loaded, and sees the rest.
 *   - A record the issue names that the server will not read never takes
 *     the issue away: the page shows the issue with everything else, says
 *     what it could not load and why, and Try again loads it.
 *   - An issue the reader may not read, or that is not there, is said in
 *     place of the page, as before.
 *   - OneUptime AI's analysis (#10369) is at the top of the issue, read from
 *     the server's analysis route - never by asking OneUptime AI - for each
 *     role as they may read what it rests on: a reader who may not read who
 *     can reach the store reads that its lines on it are hidden, and none of
 *     the grants. A verdict a person acts on offers the action, its reason
 *     drafted, and nothing changes until they choose.
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
import {
  ISSUE_PART_NOT_LOADED,
  ISSUE_STORE_NOT_LOADED,
  IssuePartNotLoadedSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssuePartsNotLoaded";
import { STORE_DATA_TYPES_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreDataTypes";
import DataSecurityIssueViewLayout, {
  ISSUE_NOT_FOUND,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/Layout";
import { DATA_SECURITY_ISSUE_VIEW_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/IssueViewContext";
import DataSecurityIssueOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/IssueView/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DataSecurityAiProposalService from "../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityFlowService from "../../../Server/Services/DataSecurityFlowService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../Server/Services/DataStoreAccessService";
import DataStoreOwnerTeamService from "../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import DataSecurityAiInput, {
  AiIssueDossier,
} from "../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import {
  DataSecurityAiVerdict,
  DataSecurityAnalysisAnswer,
  DataSecurityIssueAnalysisRecord,
  holdAnalysisToFacts,
  toDataSecurityIssueAnalysisJson,
} from "../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "../../../Types/DataSecurity/DataStoreAccess";
import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import Route from "../../../Types/API/Route";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
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
  "10238000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10238000-0000-4000-8000-0000000000a1";
const MISSING_ISSUE_ID: string = "10238000-0000-4000-8000-0000000000a9";
const STORE_ID: string = "10238000-0000-4000-8000-0000000000b1";

const ISSUE_PATH: string = `/api/data-security-issue/${ISSUE_ID}/get-item`;
const STORE_PATH: string = `/api/data-store/${STORE_ID}/get-item`;
const ANALYSIS_PATH: string = `/api/data-security-issue/${ISSUE_ID}/analysis`;
const EXPLAIN_PATH: string = `/api/data-security-issue/${ISSUE_ID}/explain`;
const ACCESS_ID: string = "10238000-0000-4000-8000-0000000000c1";

// The issue's title, as the catalog's check words it.
const TITLE: string = "Anyone on the internet can read it";
const EVIDENCE: string =
  "The bucket policy grants s3:GetObject to Principal *.";

// The refusal a store's column off relation reads gets (the plant below).
const NAME_REFUSAL: string =
  "Column name on Data Store does not support read on relation query.";

const FLOW_TIMEOUT_IN_MS: number = 60000;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW] as Route,
  currentProject: null,
  hasPaymentMethod: true,
};

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function storedIssue(overrides: StoredRow = {}): StoredRow {
  return {
    _id: ISSUE_ID,
    projectId: PROJECT_ID.toString(),
    title: TITLE,
    checkId: "public-read",
    checkGroup: "Exposure",
    evidence: EVIDENCE,
    severity: "Critical",
    status: "Open",
    riskScore: 92,
    dataTypeIds: ["credit-card-number"],
    dataStoreId: STORE_ID,
    // The store as the issue's row joins it.
    dataStore: {
      _id: STORE_ID,
      name: "customer-exports",
      kind: "AWS S3 Bucket",
      region: "eu-west-1",
      environment: "Production",
      sensitivity: "Restricted",
      exposure: "Public",
      storeKey: "aws:s3:customer-exports",
    },
    firstDetectedAt: new Date("2026-11-19T08:00:00.000Z"),
    lastDetectedAt: new Date("2026-11-20T08:00:00.000Z"),
    ...overrides,
  };
}

function storedStore(): StoredRow {
  return {
    _id: STORE_ID,
    projectId: PROJECT_ID.toString(),
    name: "customer-exports",
    kind: "AWS S3 Bucket",
    sensitivity: "Restricted",
    dataTypeIds: ["credit-card-number", "email-address"],
  };
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let issues: InMemoryTable;

function setCaller(permissions: Array<Permission>): void {
  caller = callerWith(permissions);
  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

// Everyone may read the bucket, through its policy.
function storedGrant(): StoredRow {
  return {
    _id: ACCESS_ID,
    projectId: PROJECT_ID.toString(),
    dataStoreId: STORE_ID,
    principal: "*",
    principalName: "Everyone",
    principalType: "Public",
    accessLevel: "Read",
    grantedVia: "Bucket policy",
    isPublic: true,
    isExternal: true,
    isSeenInTraces: false,
  };
}

function useTables(issue: StoredRow): void {
  issues = useInMemoryTable(DataSecurityIssueService, [issue], {
    answersOnlySelectedColumns: true,
  });
  useInMemoryTable(DataStoreService, [storedStore()], {
    answersOnlySelectedColumns: true,
  });
  useInMemoryTable(DataSecurityCustomDataTypeService, []);
  // What OneUptime AI's analysis rests on, read as each reader may (#10369).
  useInMemoryTable(DataStoreAccessService, [storedGrant()], {
    answersOnlySelectedColumns: true,
  });
  useInMemoryTable(DataSecurityFlowService, []);
  useInMemoryTable(DataSecurityAiProposalService, []);
  useInMemoryTable(DataStoreOwnerUserService, []);
  useInMemoryTable(DataStoreOwnerTeamService, []);
}

const ANALYZED_AT: Date = new Date("2026-11-20T09:00:00.000Z");

/*
 * OneUptime AI's analysis as the issue keeps it (#10369): its facts made
 * by the input builder from what the tables hold, and the answer held to
 * them, as the analysis writes it.
 */
function keptAnalysis(
  answer: DataSecurityAnalysisAnswer,
  store: AiIssueDossier["store"] = {
    _id: STORE_ID,
    name: "customer-exports",
    kind: DataStoreKind.AwsS3Bucket,
    sensitivity: DataSensitivity.Restricted,
    dataTypeIds: ["credit-card-number"],
    exposure: DataStoreExposure.Public,
  },
): StoredRow {
  const facts: AiIssueDossier = {
    issue: {
      _id: ISSUE_ID,
      checkId: "public-read",
      title: TITLE,
      severity: SecuritySeverity.Critical,
      evidence: EVIDENCE,
      dataTypeIds: [...(store.dataTypeIds || [])],
    },
    store,
    places: [],
    access: [
      {
        _id: ACCESS_ID,
        principal: "*",
        principalName: "Everyone",
        principalType: DataStorePrincipalType.Public,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "Bucket policy",
        isPublic: true,
        isExternal: true,
      },
    ],
    copies: [],
    securityCaseIds: [],
    responses: [],
    proposals: [],
    declaredCode: null,
    owners: { recordIds: [], names: [], count: 0 },
    now: ANALYZED_AT,
  };
  const record: DataSecurityIssueAnalysisRecord = holdAnalysisToFacts({
    answer,
    facts: DataSecurityAiInput.analysisFacts({ dossier: facts }).facts,
    language: "en",
  })!;

  return {
    aiVerdict: record.verdict,
    aiAnalysis: toDataSecurityIssueAnalysisJson(record),
    aiAnalyzedAt: ANALYZED_AT,
    aiAnalysisInputHash: "a".repeat(64),
  };
}

const AI_REASON: string =
  "Anyone on the internet can read the card numbers in customer-exports.";
const AI_RISK: string =
  "Card numbers, for anyone: Everyone can read them through the bucket policy.";
const AI_BREAKS: string =
  "Nothing OneUptime can see uses the bucket, so blocking public access breaks nothing.";

const REAL: DataSecurityAnalysisAnswer = {
  verdict: DataSecurityAiVerdict.Real,
  lines: {
    reason: { text: AI_REASON, facts: ["S2", "S1"] },
    risk: { text: AI_RISK, facts: ["S1", "R0", "R1"] },
    breaks: { text: AI_BREAKS, facts: ["N1"] },
    path: { text: "Block public access for the bucket.", facts: ["S2"] },
  },
};

// The project's AI, on the Dashboard and on the server.
function turnAi(enableAi: boolean): void {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.enableAi = enableAi;
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return { id: PROJECT_ID, enableAi } as unknown as Project;
  }) as never);
}

async function analysisShown(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(
      screen.getByTestId("data-security-issue-ai-analysis-verdict"),
    ).toBeInTheDocument();
  });

  return screen.getByTestId("data-security-issue-ai-analysis");
}

async function renderIssuePage(issueId: string = ISSUE_ID): Promise<void> {
  const path: string = `/dashboard/${PROJECT_ID.toString()}/data-security/issues/${issueId}`;

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

async function issueShown(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByTestId("data-security-issue-what-is-wrong"),
    ).toBeInTheDocument();
  });
}

function storeHolds(): HTMLElement {
  return screen.getByTestId("data-security-issue-store-holds");
}

/*
 * A column of the Data Store the server will not read through a relation,
 * as dataTypeIds was until 17.0.0: the store's name.
 */
function keepStoreNameOffRelations(): void {
  const original: (column: string) => TableColumnMetadata =
    DataStore.prototype.getTableColumnMetadata;

  jest
    .spyOn(DataStore.prototype, "getTableColumnMetadata")
    .mockImplementation(function (
      this: DataStore,
      column: string,
    ): TableColumnMetadata {
      const metadata: TableColumnMetadata = original.call(this, column);

      return column === "name"
        ? { ...metadata, canReadOnRelationQuery: false }
        : metadata;
    });
}

/*
 * Data Security's own routes ask for a signed-in member before anything
 * else: the session guards pass, as a signed-in member's request passes
 * them, and the props are the caller's (CommonAPI, below).
 */
function passSessionGuards(): void {
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
}

beforeAll(async () => {
  passSessionGuards();
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<DataSecurityIssue, DatabaseService<BaseModel>>(
      DataSecurityIssue,
      DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    // The App serves the store's routes with Data Security's own.
    new DataSecurityAPI().getRouter(),
    new BaseAPI<DataSecurityCustomDataType, DatabaseService<BaseModel>>(
      DataSecurityCustomDataType,
      DataSecurityCustomDataTypeService as unknown as DatabaseService<BaseModel>,
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
  // What the store's cloud would let OneUptime do about it: not under test.
  jest
    .spyOn(DataSecurityApi, "getResponseActions")
    .mockResolvedValue({ actions: [] } as never);

  setCaller([Permission.ProjectOwner]);
  useTables(storedIssue());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  // The session guards stay as the routers were built with them.
  passSessionGuards();
});

describe("a data security issue's page, through the server", () => {
  test(
    "opens on the issue: what is wrong, the store it is on, and the data types it was assessed with, in one read",
    async () => {
      await renderIssuePage();
      await issueShown();

      expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
      expect(
        screen.getByTestId("data-security-issue-evidence"),
      ).toHaveTextContent(EVIDENCE);
      expect(screen.getByText("On customer-exports")).toBeInTheDocument();
      expect(within(storeHolds()).getByText("Card number")).toBeInTheDocument();
      expect(within(storeHolds()).getByText("Restricted")).toBeInTheDocument();

      // Never the customer's sentence, and nothing it could not load.
      expect(
        screen.queryByText(/does not support read on relation query/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("data-security-issue-parts-not-loaded"),
      ).not.toBeInTheDocument();

      // One read of the issue, answered; the store was not read again.
      expect(
        server.sentTo("POST", ISSUE_PATH).map((sent: SentRequest) => {
          return sent.status;
        }),
      ).toEqual([200]);
      expect(server.sentTo("POST", STORE_PATH)).toEqual([]);
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "an issue with no data types of its own shows its store's, read from the store",
    async () => {
      useTables(storedIssue({ dataTypeIds: [] }));
      setCaller([Permission.SecurityViewer]);

      await renderIssuePage();
      await issueShown();

      await waitFor(() => {
        expect(
          within(storeHolds()).getByText("Email address"),
        ).toBeInTheDocument();
      });
      expect(within(storeHolds()).getByText("Card number")).toBeInTheDocument();

      const storeReads: Array<SentRequest> = server.sentTo("POST", STORE_PATH);

      expect(storeReads).toHaveLength(1);
      expect(storeReads[0]!.status).toBe(200);
      expect((storeReads[0]!.body as JSONObject)["select"]).toEqual(
        STORE_DATA_TYPES_SELECT,
      );
      // The issue's read named nothing of the store it may not.
      expect(
        (
          (server.sentTo("POST", ISSUE_PATH)[0]!.body as JSONObject)[
            "select"
          ] as JSONObject
        )["dataStore"],
      ).not.toHaveProperty("dataTypeIds");
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "someone who may read issues and not stores sees the issue, and is told its store's data types could not be loaded",
    async () => {
      useTables(storedIssue({ dataTypeIds: [] }));
      setCaller([Permission.ReadDataSecurityIssue]);

      await renderIssuePage();
      await issueShown();

      await waitFor(() => {
        expect(
          screen.getByTestId("data-security-issue-store-data-types-error"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("data-security-issue-store-data-types-error"),
      ).toHaveTextContent(
        /^Couldn't load this store's data types\. .*Data Store/,
      );
      /*
       * The rest of the issue, and which store it is on. Not the store's
       * sensitivity, which a relation reads only for who may read the store
       * (#10281) - and never "Public" in its place.
       */
      expect(screen.getByText("On customer-exports")).toBeInTheDocument();
      expect(
        within(storeHolds()).queryByText("Restricted"),
      ).not.toBeInTheDocument();
      expect(
        within(storeHolds()).queryByText("Public"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("data-security-issue-parts-not-loaded"),
      ).not.toBeInTheDocument();
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "a record the issue names that the server will not read never takes the issue away: the page says what it could not load, and Try again loads it",
    async () => {
      keepStoreNameOffRelations();

      await renderIssuePage();
      await issueShown();

      // The issue, all of it but its store.
      expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
      expect(
        screen.getByTestId("data-security-issue-evidence"),
      ).toHaveTextContent(EVIDENCE);
      expect(within(storeHolds()).getByText("Card number")).toBeInTheDocument();
      expect(screen.queryByText("On customer-exports")).not.toBeInTheDocument();

      // What it could not load, and why: never in place of the page.
      const notice: HTMLElement = screen.getByTestId(
        "data-security-issue-parts-not-loaded",
      );

      expect(
        within(notice).getByTestId(
          "data-security-issue-part-not-loaded-dataStore",
        ),
      ).toHaveTextContent(
        ISSUE_STORE_NOT_LOADED.replace("{{error}}", NAME_REFUSAL),
      );
      expect(
        within(notice).queryByTestId(
          "data-security-issue-part-not-loaded-assignedToUser",
        ),
      ).not.toBeInTheDocument();

      /*
       * The whole read, refused; the issue's own columns; then each record
       * it names on its own - the store's refused, the others answered.
       */
      const issueReads: Array<SentRequest> = server.sentTo("POST", ISSUE_PATH);
      const readOf: (relation: string) => SentRequest | undefined = (
        relation: string,
      ): SentRequest | undefined => {
        return issueReads.find((sent: SentRequest): boolean => {
          const select: JSONObject = (sent.body as JSONObject)[
            "select"
          ] as JSONObject;

          return (
            Object.keys(select).sort().join(",") ===
            ["_id", relation].sort().join(",")
          );
        });
      };

      expect(issueReads[0]!.status).toBe(400);
      expect(issueReads).toHaveLength(6);
      expect(readOf("dataStore")?.status).toBe(400);
      expect(readOf("assignedToUser")?.status).toBe(200);
      expect(readOf("assignedToTeam")?.status).toBe(200);
      expect(readOf("acceptedByUser")?.status).toBe(200);

      // The store can be read again: Try again loads it, and the notice goes.
      jest.mocked(DataStore.prototype.getTableColumnMetadata).mockRestore();

      await act(async () => {
        fireEvent.click(within(notice).getByText("Try again"));
      });

      await waitFor(() => {
        expect(screen.getByText("On customer-exports")).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId("data-security-issue-parts-not-loaded"),
      ).not.toBeInTheDocument();
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "an issue the reader may not read is said in place of the page, with why, and nothing of it is shown",
    async () => {
      setCaller([Permission.Viewer]);

      await renderIssuePage();

      // The server's reason, which names who may read issues.
      await waitFor(() => {
        expect(
          screen.getByText(
            "You do not have permissions to read Data Security Issue. You need one of these permissions: Project Owner, Project Admin, Security Admin, Security Member, Security Viewer, Read Data Security Issue",
          ),
        ).toBeInTheDocument();
      });

      expect(
        screen.queryByTestId("data-security-issue-what-is-wrong"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("data-security-issue-parts-not-loaded"),
      ).not.toBeInTheDocument();
      expect(issues.repository.find).not.toHaveBeenCalled();
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "an issue that is not there says so in place of the page",
    async () => {
      await renderIssuePage(MISSING_ISSUE_ID);

      await waitFor(() => {
        expect(screen.getByText(ISSUE_NOT_FOUND)).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId("data-security-issue-what-is-wrong"),
      ).not.toBeInTheDocument();
    },
    FLOW_TIMEOUT_IN_MS,
  );

  /*
   * Data Security whole without AI (#10365): with the project's Enable AI
   * off, the issue's page is all there - what is wrong, the evidence, the
   * store and what it holds - and draws no analysis and no AI action; with
   * it on, OneUptime AI's analysis (#10369) and Fix with AI.
   */
  test.each([
    [false, []],
    [true, ["OneUptime AI Analysis", "Fix with AI"]],
  ])(
    "with Enable AI %s, the page is whole and draws %j",
    async (enableAi: boolean, actions: Array<string>) => {
      turnAi(enableAi);
      useTables(storedIssue(keptAnalysis(REAL)));

      await renderIssuePage();
      await issueShown();

      expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
      expect(
        screen.getByTestId("data-security-issue-evidence"),
      ).toHaveTextContent(EVIDENCE);
      expect(screen.getByText("On customer-exports")).toBeInTheDocument();
      expect(within(storeHolds()).getByText("Card number")).toBeInTheDocument();

      if (enableAi) {
        await analysisShown();
      }

      expect(
        ["OneUptime AI Analysis", "Fix with AI"].filter((action: string) => {
          return screen.queryAllByText(action).length > 0;
        }),
      ).toEqual(actions);
      // With AI off, the page asks nothing of OneUptime AI's analysis.
      expect(server.sentTo("POST", ANALYSIS_PATH).length).toBe(
        enableAi ? 1 : 0,
      );
      expect(server.sentTo("POST", EXPLAIN_PATH)).toEqual([]);
    },
    FLOW_TIMEOUT_IN_MS,
  );
});

interface AnalysisReader {
  name: string;
  permissions: Array<Permission>;
  // Reads who can reach the store: the lines that rest on it.
  readsAccess: boolean;
}

const ANALYSIS_READERS: Array<AnalysisReader> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    readsAccess: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    readsAccess: true,
  },
  {
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    readsAccess: true,
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    readsAccess: true,
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    readsAccess: true,
  },
  {
    name: "a custom role that reads issues and their stores, not who can reach them",
    permissions: [Permission.ReadDataSecurityIssue, Permission.ReadDataStore],
    readsAccess: false,
  },
];

describe("OneUptime AI's analysis on the issue's page, through the server (#10369)", () => {
  beforeEach(() => {
    turnAi(true);
    useTables(storedIssue(keptAnalysis(REAL)));
  });

  test.each(ANALYSIS_READERS)(
    "$name reads it at the top of the issue, as they may read what it rests on - and opening it asks OneUptime AI nothing",
    async (reader: AnalysisReader) => {
      setCaller(reader.permissions);

      await renderIssuePage();
      await issueShown();

      const card: HTMLElement = await analysisShown();

      expect(
        screen.getByTestId("data-security-issue-ai-analysis-verdict"),
      ).toHaveTextContent("Real");
      expect(within(card).getByText(AI_REASON)).toBeInTheDocument();

      if (reader.readsAccess) {
        expect(within(card).getByText(AI_RISK)).toBeInTheDocument();
        expect(within(card).getByText(AI_BREAKS)).toBeInTheDocument();
      } else {
        // Who can reach the store is not theirs: the lines say so, and no grant is drawn.
        for (const part of ["risk", "breaks"]) {
          expect(
            screen.getByTestId(
              `data-security-issue-ai-analysis-${part}-hidden`,
            ),
          ).toHaveTextContent(
            "Hidden: it rests on who can reach the store, which you may not read.",
          );
        }

        expect(card.textContent).not.toContain("Everyone");
        expect(card.textContent).not.toContain("Bucket policy");
      }

      // The analysis the issue keeps, read once; nothing asked of OneUptime AI.
      expect(
        server.sentTo("POST", ANALYSIS_PATH).map((sent: SentRequest) => {
          return sent.status;
        }),
      ).toEqual([200]);
      expect(server.sentTo("POST", EXPLAIN_PATH)).toEqual([]);
      expect(issues.updates).toEqual([]);
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "an issue never analyzed says so, and offers Analyze Issue",
    async () => {
      useTables(storedIssue());

      await renderIssuePage();
      await issueShown();

      await waitFor(() => {
        expect(
          screen.getByTestId("data-security-issue-ai-analysis-none"),
        ).toBeInTheDocument();
      });
      expect(screen.getByText("Analyze Issue")).toBeInTheDocument();
      expect(server.sentTo("POST", EXPLAIN_PATH)).toEqual([]);
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "a public bucket of images it calls likely by design: Accept Risk with its reason drafted, Public By Design, and nothing changes until a person chooses",
    async () => {
      const draft: string =
        "The bucket serves the website's public images through its CDN.";

      setCaller([Permission.SecurityAdmin]);
      useTables(
        storedIssue(
          keptAnalysis(
            {
              verdict: DataSecurityAiVerdict.LikelyByDesign,
              lines: {
                reason: {
                  text: "It holds only the website's images, which are meant to be public.",
                  facts: ["S3", "S1"],
                },
                risk: {
                  text: "No sensitive data was found in it.",
                  facts: ["S1"],
                },
                draft: { text: draft, facts: ["S3"] },
              },
            },
            {
              _id: STORE_ID,
              name: "customer-exports",
              kind: DataStoreKind.AwsS3Bucket,
              sensitivity: DataSensitivity.Public,
              dataTypeIds: [],
              exposure: DataStoreExposure.Public,
            },
          ),
        ),
      );

      await renderIssuePage();
      await issueShown();
      await analysisShown();

      expect(
        screen.getByTestId("data-security-issue-ai-analysis-verdict"),
      ).toHaveTextContent("Likely by design");
      expect(
        screen.getByText("Nothing changes until you choose."),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("data-security-issue-ai-analysis-public-by-design"),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByTestId("data-security-issue-ai-analysis-accept"),
      );

      // Accept Risk opens with OneUptime AI's reason drafted: the person sends it, or not.
      await waitFor(() => {
        expect(screen.getByDisplayValue(draft)).toBeInTheDocument();
      });
      expect(issues.updates).toEqual([]);
      expect(issues.get(ISSUE_ID)!["status"]).toBe("Open");
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test(
    "a reader who may not change the issue reads the verdict, and is offered nothing to change",
    async () => {
      setCaller([Permission.SecurityViewer]);
      useTables(
        storedIssue(
          keptAnalysis({
            verdict: DataSecurityAiVerdict.LikelyWrongFinding,
            lines: {
              reason: {
                text: "The card number is a request id that happens to pass the Luhn check.",
                facts: ["I1"],
              },
              draft: {
                text: "The value is a request id, not a card number.",
                facts: ["I1"],
              },
            },
          }),
        ),
      );

      await renderIssuePage();
      await issueShown();
      await analysisShown();

      expect(
        screen.getByTestId("data-security-issue-ai-analysis-verdict"),
      ).toHaveTextContent("Likely a wrong finding");
      expect(
        screen.queryByTestId("data-security-issue-ai-analysis-not-an-issue"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("data-security-issue-ai-analysis-accept"),
      ).not.toBeInTheDocument();
    },
    FLOW_TIMEOUT_IN_MS,
  );
});

describe("every record the issue's page names has its own sentence when it cannot be loaded", () => {
  test.each(
    Object.entries(DATA_SECURITY_ISSUE_VIEW_SELECT as JSONObject)
      .filter(([, value]: [string, unknown]): boolean => {
        return Boolean(value) && typeof value === "object";
      })
      .map(([relation]: [string, unknown]): string => {
        return relation;
      }),
  )("%s", (relation: string) => {
    const { container } = render(
      <IssuePartNotLoadedSentence
        part={{ relation: relation, error: "Refused here." }}
      />,
    );
    const sentence: string = container.textContent || "";

    // Its own words, not the sentence for a part nobody named.
    expect(sentence).not.toBe(
      ISSUE_PART_NOT_LOADED.replace("{{error}}", "Refused here."),
    );
    expect(sentence).toMatch(/^Couldn't load .+\. Refused here\.$/);
  });

  test("a part nobody named still says what failed, and why", () => {
    const { container } = render(
      <IssuePartNotLoadedSentence
        part={{ relation: "somethingElse", error: "Refused here." }}
      />,
    );

    expect(container.textContent).toBe(
      ISSUE_PART_NOT_LOADED.replace("{{error}}", "Refused here."),
    );
  });
});
