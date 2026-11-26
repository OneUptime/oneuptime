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
import LogScrubRuleService from "../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../Server/Services/TraceScrubRuleService";
import ListOrderMaintainer from "../../../Server/Utils/Database/ListOrderMaintainer";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TraceScrubPatternType from "../../../Types/Trace/TraceScrubPatternType";
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
 * A SCRUB RULE NAMES ONLY A SERVICE OF ITS OWN PROJECT (#10433), THROUGH
 * THE ROUTES THE DASHBOARD AND THE API USE.
 *
 * Scrub It's rules became a service's own (#10601): a log or trace scrub
 * rule names the service whose records it scrubs, and the person or API key
 * that writes the rule writes that service too. The rule services did not
 * check it was the project's, so a rule could name another project's
 * service, and read that service's name back through the relation. The
 * services now check it as every service of a project's records does
 * (ProjectReferencesService): another project's service - or one that does
 * not exist, answered the same way - is refused before anything is written,
 * in the create and in an update alike, and the project's own is kept.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10433a00-0000-4000-8000-000000000001",
);
const RULE_ID: string = "10433a00-0000-4000-8000-0000000000a1";
const CHECKOUT_SERVICE_ID: string = "10433a00-0000-4000-8000-0000000000b1";
const PAYMENTS_SERVICE_ID: string = "10433a00-0000-4000-8000-0000000000b2";
// A service of another project, and an id no service has.
const OTHER_PROJECTS_SERVICE_ID: string =
  "10433a00-0000-4000-8000-0000000000c1";
const NO_SERVICE_ID: string = "10433a00-0000-4000-8000-0000000000d1";

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

interface RuleKind {
  name: string;
  path: string;
  service: DatabaseService<BaseModel>;
  patternType: string;
}

const KINDS: Array<RuleKind> = [
  {
    name: "a log scrub rule",
    path: "/api/log-scrub-rule",
    service: LogScrubRuleService as unknown as DatabaseService<BaseModel>,
    patternType: LogScrubPatternType.Email,
  },
  {
    name: "a trace scrub rule",
    path: "/api/trace-scrub-rule",
    service: TraceScrubRuleService as unknown as DatabaseService<BaseModel>,
    patternType: TraceScrubPatternType.Email,
  },
];

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function storedRule(kind: RuleKind): StoredRow {
  return {
    _id: RULE_ID,
    projectId: PROJECT_ID.toString(),
    name: "Hide emails in checkout",
    patternType: kind.patternType,
    serviceId: CHECKOUT_SERVICE_ID,
    isEnabled: true,
    sortOrder: 1,
  };
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

function notInProject(serviceId: string): string {
  return `references records that are not in this project: Service "${serviceId}"`;
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<LogScrubRule, DatabaseService<BaseModel>>(
      LogScrubRule,
      LogScrubRuleService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<TraceScrubRule, DatabaseService<BaseModel>>(
      TraceScrubRule,
      TraceScrubRuleService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = OWNER;

  // The project's services; another project's is elsewhere.
  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: { Service: [CHECKOUT_SERVICE_ID, PAYMENTS_SERVICE_ID] },
    elsewhere: [OTHER_PROJECTS_SERVICE_ID],
  });

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  // A new rule goes to the end of the list; the list is not under test.
  jest
    .spyOn(ListOrderMaintainer, "planCreate")
    .mockResolvedValue(null as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "$name names only a service of its project",
  (kind: RuleKind) => {
    let rules: InMemoryTable;

    beforeEach(() => {
      rules = useInMemoryTable(kind.service, [storedRule(kind)]);
    });

    function createBody(service: JSONObject): JSONObject {
      return {
        data: {
          name: "Hide emails in payments",
          projectId: PROJECT_ID.toString(),
          patternType: kind.patternType,
          isEnabled: true,
          ...service,
        },
        miscDataProps: {},
      };
    }

    test.each([
      ["a person", OWNER],
      ["an API key", API_KEY],
    ] as Array<[string, DatabaseCommonInteractionProps]>)(
      "a create by %s naming another project's service is refused, and nothing is made",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        caller = props;

        const sent: SentRequest = await server.request(
          "POST",
          kind.path,
          createBody({ serviceId: OTHER_PROJECTS_SERVICE_ID }),
        );

        expect(sent.status).toBe(400);
        expect(refusalOf(sent)).toContain(
          notInProject(OTHER_PROJECTS_SERVICE_ID),
        );
        expect(rules.inserts).toEqual([]);
      },
    );

    test("named as the relation, another project's service is refused the same way", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        kind.path,
        createBody({ service: { _id: OTHER_PROJECTS_SERVICE_ID } }),
      );

      expect(sent.status).toBe(400);
      expect(refusalOf(sent)).toContain(
        notInProject(OTHER_PROJECTS_SERVICE_ID),
      );
      expect(rules.inserts).toEqual([]);
    });

    test("a service that does not exist is answered exactly as another project's is", async () => {
      const missing: SentRequest = await server.request(
        "POST",
        kind.path,
        createBody({ serviceId: NO_SERVICE_ID }),
      );
      const elsewhere: SentRequest = await server.request(
        "POST",
        kind.path,
        createBody({ serviceId: OTHER_PROJECTS_SERVICE_ID }),
      );

      expect(missing.status).toBe(elsewhere.status);
      expect(refusalOf(missing)).toBe(
        refusalOf(elsewhere).replace(OTHER_PROJECTS_SERVICE_ID, NO_SERVICE_ID),
      );
      expect(rules.inserts).toEqual([]);
    });

    test("a create naming the project's own service is made, for that service", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        kind.path,
        createBody({ serviceId: PAYMENTS_SERVICE_ID }),
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(rules.inserts).toHaveLength(1);
      expect(String(rules.inserts[0]!["serviceId"])).toBe(PAYMENTS_SERVICE_ID);
    });

    test("a create naming no service is made for every service of the project", async () => {
      const sent: SentRequest = await server.request(
        "POST",
        kind.path,
        createBody({}),
      );

      expect(sent.status).toBe(200);
      expect(rules.inserts).toHaveLength(1);
      expect(rules.inserts[0]!["serviceId"] ?? null).toBeNull();
    });

    test.each([
      ["a person", OWNER],
      ["an API key", API_KEY],
    ] as Array<[string, DatabaseCommonInteractionProps]>)(
      "an update by %s moving a rule to another project's service is refused, and the rule keeps its own",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        caller = props;

        const sent: SentRequest = await server.request(
          "PUT",
          `${kind.path}/${RULE_ID}`,
          { data: { serviceId: OTHER_PROJECTS_SERVICE_ID } },
        );

        expect(sent.status).toBe(400);
        expect(refusalOf(sent)).toContain(
          notInProject(OTHER_PROJECTS_SERVICE_ID),
        );
        expect(rules.updates).toEqual([]);
        expect(String(rules.get(RULE_ID)!["serviceId"])).toBe(
          CHECKOUT_SERVICE_ID,
        );
      },
    );

    test("an update moving a rule to another of the project's services goes through", async () => {
      const sent: SentRequest = await server.request(
        "PUT",
        `${kind.path}/${RULE_ID}`,
        { data: { serviceId: PAYMENTS_SERVICE_ID } },
      );

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(String(rules.get(RULE_ID)!["serviceId"])).toBe(
        PAYMENTS_SERVICE_ID,
      );
    });
  },
);
