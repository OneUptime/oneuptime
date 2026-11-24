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
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FieldsLeftOut, {
  FIELDS_LEFT_OUT_HEADER,
} from "../../../Types/API/FieldsLeftOut";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
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
 * A CREATE SAYS WHICH FIELDS IT LEFT OUT BECAUSE ONLY ONEUPTIME WRITES THEM,
 * OVER HTTP (#10136).
 *
 * POST /api/<path> goes through without what only OneUptime writes - a
 * network site's rollup state and its place in the hierarchy, who created
 * it - when a person or an API key sends them, as a copy of a record does
 * (#10053). Its answer is the record, as before, and names what it left
 * out in X-OneUptime-Fields-Left-Out (Types/API/FieldsLeftOut): through
 * Express, BaseAPI, the permission layer, DatabaseService and the error
 * handler, into a table in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10136000-0000-4000-8000-000000000001",
);
const ROLLED_UP_AT: string = "2026-11-19T10:00:00.000Z";
const SOMEONE_ELSE: string = "10136000-0000-4000-8000-0000000000c1";

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
let caller: DatabaseCommonInteractionProps;

// What the answer's header names.
function leftOutOf(sent: SentRequest): Array<string> {
  return FieldsLeftOut.fromHeaders(sent.headers);
}

function headerOf(sent: SentRequest): string | undefined {
  return sent.headers[FIELDS_LEFT_OUT_HEADER.toLowerCase()];
}

// A site as a copy of one read before sends it: what OneUptime set, too.
const COPIED_SITE: JSONObject = {
  name: "Berlin",
  projectId: PROJECT_ID.toString(),
  lastRollupAt: ROLLED_UP_AT,
  depth: 9,
  createdByUserId: SOMEONE_ELSE,
};

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<NetworkSite, DatabaseService<BaseModel>>(
      NetworkSite,
      siteService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
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

  sites = useInMemoryTable(siteService, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create by a person or an API key that sends what only OneUptime writes", () => {
  test.each([
    ["a person", OWNER],
    ["an API key", API_KEY],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "by %s goes through, and its answer names each field it left out",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      caller = props;
      const sent: SentRequest = await server.request(
        "POST",
        "/api/network-site",
        { data: COPIED_SITE },
      );

      expect(sent.status).toBe(200);
      expect(headerOf(sent)).toBe("createdByUserId, depth, lastRollupAt");
      expect(leftOutOf(sent)).toEqual([
        "createdByUserId",
        "depth",
        "lastRollupAt",
      ]);

      // As before: the record is created without them.
      expect(sites.inserts).toHaveLength(1);
      expect(sites.inserts[0]!["name"]).toBe("Berlin");
      expect(sites.inserts[0]!["lastRollupAt"]).toBeUndefined();
      expect(sites.inserts[0]!["depth"]).not.toBe(9);
      expect(String(sites.inserts[0]!["createdByUserId"] || "")).not.toBe(
        SOMEONE_ELSE,
      );

      // And the answer is the record it always was.
      const answer: JSONObject = sent.answer as JSONObject;
      expect(answer["name"]).toBe("Berlin");
      expect(answer).not.toHaveProperty("fieldsLeftOut");
    },
  );

  test("a field only OneUptime writes, sent alone, is named alone", async () => {
    const sent: SentRequest = await server.request(
      "POST",
      "/api/network-site",
      {
        data: {
          name: "Paris",
          projectId: PROJECT_ID.toString(),
          lastRollupAt: ROLLED_UP_AT,
        },
      },
    );

    expect(sent.status).toBe(200);
    expect(leftOutOf(sent)).toEqual(["lastRollupAt"]);
  });
});

describe("a create that leaves nothing out", () => {
  test("sends no header: a client that reads only the record sees no change", async () => {
    const sent: SentRequest = await server.request(
      "POST",
      "/api/network-site",
      {
        data: { name: "Lisbon", projectId: PROJECT_ID.toString() },
      },
    );

    expect(sent.status).toBe(200);
    expect(headerOf(sent)).toBeUndefined();
    expect(leftOutOf(sent)).toEqual([]);
  });

  test.each([
    ["a server admin", SERVER_ADMIN],
    ["OneUptime itself", ROOT],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "by %s, which keeps what it sends: no header",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      caller = props;
      const sent: SentRequest = await server.request(
        "POST",
        "/api/network-site",
        {
          data: {
            name: "Madrid",
            projectId: PROJECT_ID.toString(),
            lastRollupAt: ROLLED_UP_AT,
          },
        },
      );

      expect(sent.status).toBe(200);
      expect(headerOf(sent)).toBeUndefined();
      expect(
        new Date(sites.inserts[0]!["lastRollupAt"] as string).toISOString(),
      ).toBe(ROLLED_UP_AT);
    },
  );
});

describe("a create that is refused", () => {
  test("names nothing it left out: nothing was created", async () => {
    const sent: SentRequest = await server.request(
      "POST",
      "/api/network-site",
      {
        data: { projectId: PROJECT_ID.toString(), lastRollupAt: ROLLED_UP_AT },
      },
    );

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(headerOf(sent)).toBeUndefined();
    expect(sites.inserts).toHaveLength(0);
  });
});

describe("an update", () => {
  test("never names fields left out: one that sends a field only OneUptime writes is refused, as before", async () => {
    sites.rows.push({
      _id: "10136000-0000-4000-8000-0000000000a1",
      projectId: PROJECT_ID.toString(),
      name: "Rome",
      slug: "rome",
      depth: 0,
      materializedPath: "/10136000-0000-4000-8000-0000000000a1/",
      lastRollupAt: null,
    });

    const sent: SentRequest = await server.request(
      "PUT",
      "/api/network-site/10136000-0000-4000-8000-0000000000a1",
      { data: { name: "Roma", lastRollupAt: ROLLED_UP_AT } },
    );

    expect(sent.status).toBe(400);
    expect(headerOf(sent)).toBeUndefined();
  });
});
