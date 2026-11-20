import "@testing-library/jest-dom";
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
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE SECURITY PAGES THAT NAME A RECORD THROUGH A RELATION, FOR EACH OF
 * THEIR READERS (#10310).
 *
 * A watchlist's feed, a feed's connection, a finding's scan, an issue's case
 * and a store's or a scan's cloud connection and account are read through
 * the relation only by who may read them now - but for which record it is:
 * its name, its kind or provider, whether it is on, a case's number. The
 * pages read only that much through these relations, so each of their
 * readers is shown them as before:
 *
 *   - Security Events > Watchlists, its table's Holds column: the feed each
 *     list follows, by name, for every reader of watchlists - the Security
 *     tiers and a custom role that reads detection rules alone;
 *   - a watchlist's page, rendered through the server: the feed it follows,
 *     by name, in the read every reader of the list sends;
 *   - Data Security > Scans, its table: the store a scan read and the cloud
 *     connection it read through, by name, for the Security tiers - who do
 *     not read cloud connections - and a custom role that reads scans.
 *
 * And the read each would send had it shown more of the feed or the
 * connection - a list's address, a connection's configuration - is refused
 * those readers, saying who may: the regression the server now stops.
 *
 * The tables are captured rather than drawn: what is under test is the
 * relation select their columns send (getRelationSelectFromColumns), held to
 * the server's own check of a select through a relation
 * (QueryPermission.checkRelationQueryPermission).
 */

configure({ asyncUtilTimeout: 15000 });

const mockCapturedTables: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTables.push(props);
      return null;
    },
  };
});

// A watchlist's settings card, which reads the list on its own.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

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

import DataSecurityScansPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Scans";
import { WATCHLISTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import SecurityWatchlistViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WatchlistView";
import SecurityWatchlistsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Watchlists";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityWatchlistAPI from "../../../Server/API/SecurityWatchlistAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityWatchlistService from "../../../Server/Services/SecurityWatchlistService";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import Select from "../../../Server/Types/Database/Select";
import DataSecurityScan from "../../../Models/DatabaseModels/DataSecurityScan";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import Route from "../../../Types/API/Route";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableSelect from "../../../Types/BaseDatabase/Select";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Columns from "../../../UI/Components/ModelTable/Columns";
import { getRelationSelectFromColumns } from "../../../UI/Components/ModelTable/SelectFromColumns";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import { useInMemoryTable } from "../../Server/TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";

const PROJECT_ID: ObjectID = new ObjectID(
  "10310000-0000-4000-8000-000000000002",
);
const WATCHLIST_ID: string = "10310000-0000-4000-8000-0000000000d1";
const FEED_ID: string = "10310000-0000-4000-8000-0000000000d2";

const FLOW_TIMEOUT_IN_MS: number = 60000;

interface Reader {
  name: string;
  permissions: Array<Permission>;
}

const SECURITY_TIERS_AND_OWNERS: Array<Reader> = [
  { name: "a project owner", permissions: [Permission.ProjectOwner] },
  { name: "a project admin", permissions: [Permission.ProjectAdmin] },
  { name: "a security admin", permissions: [Permission.SecurityAdmin] },
  { name: "a security member", permissions: [Permission.SecurityMember] },
  { name: "a security viewer", permissions: [Permission.SecurityViewer] },
];

const DETECTION_RULE_READER: Reader = {
  name: "a custom role that reads detection rules, and not feeds",
  permissions: [Permission.ReadProjectDetectionRule],
};

const SCAN_READER: Reader = {
  name: "a custom role that reads scans, and not cloud connections",
  permissions: [Permission.ReadDataSecurityScan],
};

const WATCHLIST_READERS: Array<Reader> = [
  ...SECURITY_TIERS_AND_OWNERS,
  DETECTION_RULE_READER,
];

const SCAN_READERS: Array<Reader> = [...SECURITY_TIERS_AND_OWNERS, SCAN_READER];

function propsOf(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function readerHolds(permissions: Array<Permission>): void {
  caller = propsOf(permissions);
  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

// The last table a page drew with this model.
function tableOf<TBaseModel extends BaseModel>(modelType: {
  new (): TBaseModel;
}): Columns<TBaseModel> {
  const table: Record<string, unknown> | undefined = [...mockCapturedTables]
    .reverse()
    .find((props: Record<string, unknown>): boolean => {
      return props["modelType"] === modelType;
    });

  expect(table).toBeDefined();

  return table!["columns"] as Columns<TBaseModel>;
}

// What the table's columns read through relations: its read's relation select.
function relationSelectOf<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  columns: Columns<TBaseModel>,
): JSONObject {
  return getRelationSelectFromColumns<TBaseModel>({
    columns: columns,
    model: new modelType(),
  }) as JSONObject;
}

function serverCheckOf(
  modelType: { new (): BaseModel },
  relationSelect: JSONObject,
  permissions: Array<Permission>,
): () => void {
  return (): void => {
    QueryPermission.checkRelationQueryPermission(
      modelType,
      {},
      { _id: true, ...relationSelect } as Select<BaseModel>,
      propsOf(permissions),
    );
  };
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([new SecurityWatchlistAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  mockCapturedTables.length = 0;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  // What reads the lists (rules, monitors, hunts) and a list's values: none here.
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 200,
  } as never);

  readerHolds([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Security Events > Watchlists, for each reader of watchlists", () => {
  test.each(
    WATCHLIST_READERS.map((reader: Reader): [string, Reader] => {
      return [reader.name, reader];
    }),
  )(
    "%s: the feed each list follows, by its name, in a read the server takes",
    async (_who: string, reader: Reader) => {
      readerHolds(reader.permissions);

      await act(async () => {
        render(
          <MemoryRouter>
            <SecurityWatchlistsPage
              pageRoute={new Route("/dashboard/security-events/watchlists")}
              currentProject={null}
              hasPaymentMethod={true}
            />
          </MemoryRouter>,
        );
      });

      const relationSelect: JSONObject = relationSelectOf(
        SecurityWatchlist,
        tableOf(SecurityWatchlist),
      );

      expect(relationSelect["threatIntelFeed"]).toEqual({ name: true });
      expect(
        serverCheckOf(SecurityWatchlist, relationSelect, reader.permissions),
      ).not.toThrow();
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test("had the column shown a list's address, the read would be refused a role that reads detection rules alone - and taken from the Security tiers", () => {
    const withAddress: JSONObject = {
      threatIntelFeed: { name: true, listUrl: true },
    };

    expect(
      serverCheckOf(
        SecurityWatchlist,
        withAddress,
        DETECTION_RULE_READER.permissions,
      ),
    ).toThrow(
      "You do not have permissions to read listUrl of Threat Intel Feed through threatIntelFeed on Watchlist. You need one of these permissions: Project Owner, Project Admin, Security Admin, Security Member, Security Viewer, Read Threat Intel Feed.",
    );

    for (const reader of SECURITY_TIERS_AND_OWNERS) {
      expect(
        serverCheckOf(SecurityWatchlist, withAddress, reader.permissions),
      ).not.toThrow();
    }
  });
});

describe("a watchlist's page, rendered through the server, for each reader of watchlists", () => {
  const VIEW_PATH: string = `/dashboard/${PROJECT_ID.toString()}/security-events/watchlists/${WATCHLIST_ID}`;

  beforeEach(() => {
    useInMemoryTable(
      SecurityWatchlistService as unknown as DatabaseService<BaseModel>,
      [
        {
          _id: WATCHLIST_ID,
          projectId: PROJECT_ID.toString(),
          name: "known_bad_urls",
          description: "Addresses URLhaus lists as malicious.",
          entityType: "URL",
          source: "Threat Intel Feed",
          valueCount: 0,
          threatIntelFeedId: FEED_ID,
          threatIntelFeed: {
            _id: FEED_ID,
            projectId: PROJECT_ID.toString(),
            name: "URLhaus",
            listUrl:
              "https://lists.example.com/urlhaus.txt?key=list-secret-10310",
            nextPageToken: "page-token-10310",
          },
        },
      ],
      { answersOnlySelectedColumns: true },
    );

    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(WATCHLIST_ID));
    Navigation.setLocation({
      pathname: VIEW_PATH,
      search: "",
      hash: "",
      state: null,
      key: "watchlist",
    });
  });

  test.each(
    WATCHLIST_READERS.map((reader: Reader): [string, Reader] => {
      return [reader.name, reader];
    }),
  )(
    "%s: the feed it follows, by its name, and nothing it is reached by",
    async (_who: string, reader: Reader) => {
      readerHolds(reader.permissions);

      await act(async () => {
        render(
          <MemoryRouter initialEntries={[VIEW_PATH]}>
            <SecurityWatchlistViewPage
              pageRoute={new Route(VIEW_PATH)}
              currentProject={null}
              hasPaymentMethod={true}
            />
          </MemoryRouter>,
        );
      });

      await waitFor(() => {
        expect(
          screen.getByTestId(WATCHLISTS_TEST_IDS.feedValues),
        ).toHaveTextContent("URLhaus");
      });

      const reads: Array<SentRequest> = server.sentTo(
        "POST",
        `/api/security-watchlist/${WATCHLIST_ID}/get-item`,
      );

      expect(
        reads.map((sent: SentRequest): number => {
          return sent.status;
        }),
      ).toEqual([200]);
      expect(
        ((reads[0]!.body as JSONObject)["select"] as JSONObject)[
          "threatIntelFeed"
        ],
      ).toEqual({ name: true });
      expect(JSON.stringify(reads[0]!.answer)).not.toContain("list-secret");
      expect(document.body.textContent || "").not.toContain("list-secret");
    },
    FLOW_TIMEOUT_IN_MS,
  );
});

describe("Data Security > Scans, for each reader of scans", () => {
  test.each(
    SCAN_READERS.map((reader: Reader): [string, Reader] => {
      return [reader.name, reader];
    }),
  )(
    "%s: the store a scan read and the cloud connection it read through, by name, in a read the server takes",
    async (_who: string, reader: Reader) => {
      readerHolds(reader.permissions);

      await act(async () => {
        render(
          <MemoryRouter>
            <DataSecurityScansPage
              pageRoute={new Route("/dashboard/data-security/scans")}
              currentProject={null}
              hasPaymentMethod={true}
            />
          </MemoryRouter>,
        );
      });

      const relationSelect: JSONObject = relationSelectOf(
        DataSecurityScan,
        tableOf(DataSecurityScan),
      );

      expect(relationSelect["cloudConnection"]).toEqual({ name: true });
      expect(relationSelect["dataStore"]).toEqual(
        expect.objectContaining({ name: true }),
      );
      expect(
        serverCheckOf(DataSecurityScan, relationSelect, reader.permissions),
      ).not.toThrow();
    },
    FLOW_TIMEOUT_IN_MS,
  );

  test("had it shown a connection's configuration, the read would be refused the Security tiers and a role that reads scans - who do not read cloud connections", () => {
    const withConfig: JSONObject = {
      cloudConnection: { name: true, config: true },
    };

    for (const reader of [...SECURITY_TIERS_AND_OWNERS.slice(2), SCAN_READER]) {
      expect(
        serverCheckOf(DataSecurityScan, withConfig, reader.permissions),
      ).toThrow(
        "You do not have permissions to read config of Cloud Connection through cloudConnection on Data Security Scan. You need one of these permissions: Project Owner, Project Admin, Project Member, Viewer, Settings Admin, Settings Member, Settings Viewer, Read Cloud Resource.",
      );
    }

    for (const reader of SECURITY_TIERS_AND_OWNERS.slice(0, 2)) {
      expect(
        serverCheckOf(DataSecurityScan, withConfig, reader.permissions),
      ).not.toThrow();
    }
  });
});

describe("the reads the Security pages send through these relations name which record it is, and nothing held", () => {
  test("a watchlist's page reads its feed by name, and the scans table its connection by name", () => {
    // TableSelect: what a page hands the API, its relation selects as written.
    const feed: TableSelect<SecurityWatchlist> = {
      threatIntelFeed: { name: true },
    } as TableSelect<SecurityWatchlist>;

    expect(
      PermissionGate.getSelectReadableThroughRelations(
        SecurityWatchlist,
        feed,
        {
          permissions: DETECTION_RULE_READER.permissions,
        },
      ),
    ).toEqual(feed);
  });
});
