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
import HostAPI from "../../../Server/API/HostAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import HostService from "../../../Server/Services/HostService";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { tryCollectorConfigAgain } from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorCard";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
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
 * A COLUMN ONLY ONEUPTIME WRITES, THROUGH THE SERVER'S OWN ROUTES OVER HTTP
 * (#10053).
 *
 * Every route that writes a record - POST /<path> to create it, PUT
 * /<path>/:id and POST /<path>/:id/update-item to update it - with each kind
 * of caller: a person, an API key, a server admin, and OneUptime itself
 * (root), through Express's JSON body parser, BaseAPI, the permission
 * layer, DatabaseService and the error handler, into a table in memory. A
 * network site's rollup state is OneUptime's alone (ServerOwned.Always).
 *
 * And the Dashboard's own requests, sent by its own code: a site created
 * and edited as its forms send them, an update that names such a column
 * (no Dashboard page sends one), and a host's collector Try again, which
 * has a route of its own (HostAPI).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10053000-0000-4000-8000-000000000002",
);
const SITE_ID: string = "10053000-0000-4000-8000-0000000000a2";
const HOST_ID: string = "10053000-0000-4000-8000-0000000000c2";
const ROLLED_UP_AT: string = "2026-11-19T10:00:00.000Z";

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

const API_KEY: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
    isApiKey: true,
  }),
  ...ON_HIGHEST_PLAN,
};

const SERVER_ADMIN: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [],
    projectId: PROJECT_ID,
    isMasterAdmin: true,
  }),
  isMasterAdmin: true,
  ...ON_HIGHEST_PLAN,
};

const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

class PlainNetworkSiteService extends DatabaseService<NetworkSite> {
  public constructor() {
    super(NetworkSite);
  }
}

const siteService: PlainNetworkSiteService = new PlainNetworkSiteService();

let server: DashboardRequestsOverHttp;
let sites: InMemoryTable;
let hosts: InMemoryTable;
let caller: DatabaseCommonInteractionProps;

function storedSite(): StoredRow {
  return {
    _id: SITE_ID,
    projectId: PROJECT_ID.toString(),
    name: "Frankfurt",
    slug: "frankfurt",
    depth: 0,
    materializedPath: `/${SITE_ID}/`,
    lastRollupAt: null,
  };
}

function answerOf(sent: SentRequest): JSONObject {
  return (sent.answer || {}) as JSONObject;
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = answerOf(sent);
  return String(answer["error"] || answer["message"] || "");
}

const ROLLUP_REFUSAL: string =
  "User is not allowed to update on lastRollupAt column of Network Site. No permission allows it: the column is changed by the server, not by a request.";

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<NetworkSite, DatabaseService<BaseModel>>(
      NetworkSite,
      siteService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new HostAPI().getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  stubProjectDirectory({});
  caller = OWNER;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  sites = useInMemoryTable(siteService, [storedSite()]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/network-site, a create", () => {
  const body: JSONObject = {
    data: {
      name: "Berlin",
      projectId: PROJECT_ID.toString(),
      lastRollupAt: ROLLED_UP_AT,
      depth: 9,
    },
    miscDataProps: {},
  };

  test.each([
    ["a person", OWNER],
    ["an API key", API_KEY],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "by %s goes through without what only OneUptime writes",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      caller = props;
      const sent: SentRequest = await server.request(
        "POST",
        "/api/network-site",
        body,
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(sites.inserts).toHaveLength(1);
      expect(sites.inserts[0]!["name"]).toBe("Berlin");
      expect(sites.inserts[0]!["lastRollupAt"]).toBeUndefined();
      expect(sites.inserts[0]!["depth"]).not.toBe(9);
    },
  );

  test.each([
    ["a server admin", SERVER_ADMIN],
    ["OneUptime itself", ROOT],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "by %s keeps it",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      caller = props;
      const sent: SentRequest = await server.request(
        "POST",
        "/api/network-site",
        body,
      );

      expect(sent.status).toBe(200);
      expect(
        new Date(sites.inserts[0]!["lastRollupAt"] as string).toISOString(),
      ).toBe(ROLLED_UP_AT);
    },
  );
});

// Every route that updates a record: PUT /:id, and POST /:id/update-item.
const UPDATE_ROUTES: Array<[string, string]> = [
  ["PUT", `/api/network-site/${SITE_ID}`],
  ["POST", `/api/network-site/${SITE_ID}/update-item`],
];

describe("an update, PUT /api/network-site/:id and POST /api/network-site/:id/update-item", () => {
  test.each(
    UPDATE_ROUTES.flatMap(
      ([method, path]: [string, string]): Array<
        [string, string, string, DatabaseCommonInteractionProps]
      > => {
        return [
          [method, path, "a person", OWNER],
          [method, path, "an API key", API_KEY],
        ];
      },
    ),
  )(
    "%s %s by %s that names one is refused with its name, and writes nothing",
    async (
      method: string,
      path: string,
      _who: string,
      props: DatabaseCommonInteractionProps,
    ) => {
      caller = props;
      const sent: SentRequest = await server.request(method, path, {
        data: { name: "Frankfurt 2", lastRollupAt: ROLLED_UP_AT },
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: ROLLUP_REFUSAL,
      });
      expect(sites.updates).toHaveLength(0);
    },
  );

  test.each(UPDATE_ROUTES)(
    "%s %s by a person that names none goes through",
    async (method: string, path: string) => {
      const sent: SentRequest = await server.request(method, path, {
        data: { name: "Frankfurt 2" },
      });

      expect(sent.status).toBe(200);
      expect(sites.get(SITE_ID)!["name"]).toBe("Frankfurt 2");
    },
  );

  test.each(
    UPDATE_ROUTES.flatMap(
      ([method, path]: [string, string]): Array<
        [string, string, string, DatabaseCommonInteractionProps]
      > => {
        return [
          [method, path, "a server admin", SERVER_ADMIN],
          [method, path, "OneUptime itself", ROOT],
        ];
      },
    ),
  )(
    "%s %s by %s writes it",
    async (
      method: string,
      path: string,
      _who: string,
      props: DatabaseCommonInteractionProps,
    ) => {
      caller = props;
      const sent: SentRequest = await server.request(method, path, {
        data: { lastRollupAt: ROLLED_UP_AT },
      });

      expect(sent.status).toBe(200);
      expect(
        new Date(sites.get(SITE_ID)!["lastRollupAt"] as Date).toISOString(),
      ).toBe(ROLLED_UP_AT);
    },
  );

  test("that names several is refused naming each", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/network-site/${SITE_ID}`,
      { data: { lastRollupAt: ROLLED_UP_AT, depth: 4 } },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(
      "User is not allowed to update on depth, lastRollupAt columns of Network Site. No permission allows it: these columns are changed by the server, not by a request.",
    );
  });
});

describe("the Dashboard's own requests", () => {
  test("a site created and edited as its forms send them goes through", async () => {
    const site: NetworkSite = new NetworkSite();
    site.name = "Paris";
    site.projectId = PROJECT_ID;

    await ModelAPI.create<NetworkSite>({ model: site, modelType: NetworkSite });
    await ModelAPI.updateById<NetworkSite>({
      modelType: NetworkSite,
      id: new ObjectID(SITE_ID),
      data: { name: "Frankfurt am Main" },
    });

    expect(
      server.requests.map((sent: SentRequest): number => {
        return sent.status;
      }),
    ).toEqual([200, 200]);
    expect(sites.get(SITE_ID)!["name"]).toBe("Frankfurt am Main");
  });

  test("an update that names a column only OneUptime writes is refused, and the page reads why", async () => {
    let message: string = "";

    try {
      await ModelAPI.updateById<NetworkSite>({
        modelType: NetworkSite,
        id: new ObjectID(SITE_ID),
        data: { lastRollupAt: new Date(ROLLED_UP_AT) },
      });
    } catch (error) {
      message = API.getFriendlyMessage(error);
    }

    expect(message).toBe(ROLLUP_REFUSAL);
    expect(sites.updates).toHaveLength(0);
  });
});

describe("Try again on a host's collector", () => {
  beforeEach(() => {
    hosts = useInMemoryTable(HostService, [
      {
        _id: HOST_ID,
        projectId: PROJECT_ID.toString(),
        name: "web-01",
        hostIdentifier: "web-01",
        collectorFailedConfigHash: "a-failed-config",
      },
    ]);
  });

  test("clears the failed config through its own route, as the person", async () => {
    await tryCollectorConfigAgain(new ObjectID(HOST_ID));

    const sent: SentRequest = server.sentTo(
      "POST",
      `/api/host/${HOST_ID}/try-collector-config-again`,
    )[0]!;
    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(hosts.get(HOST_ID)!["collectorFailedConfigHash"]).toBeNull();
  });

  test("is refused to someone who may not change the host", async () => {
    caller = {
      ...customDomainCaller({
        permissions: [Permission.Viewer],
        projectId: PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };

    await expect(
      tryCollectorConfigAgain(new ObjectID(HOST_ID)),
    ).rejects.toBeDefined();
    expect(hosts.get(HOST_ID)!["collectorFailedConfigHash"]).toBe(
      "a-failed-config",
    );
  });

  test("an update of the host that clears it is refused: only OneUptime writes it", async () => {
    const sent: SentRequest = await server.request(
      "PUT",
      `/api/host/${HOST_ID}`,
      { data: { collectorFailedConfigHash: null } },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toContain("collectorFailedConfigHash");
    expect(hosts.get(HOST_ID)!["collectorFailedConfigHash"]).toBe(
      "a-failed-config",
    );
  });
});
