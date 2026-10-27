import DetectionRuleAPI from "../../../Server/API/DetectionRuleAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import DetectionRuleRetrohunt, {
  DetectionRetrohuntRequest,
} from "../../../Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { DetectionRetrohuntResult } from "../../../Types/SecurityEvent/DetectionRetrohunt";

/*
 * POST /detection-rule/retrohunt: Run on Past Events. Who may ask (a role
 * that reads detection rules AND security events), which rule is run (a
 * saved rule read as the caller, the form's values over it, or the form's
 * values alone), which sources are read (only the caller's), and what is
 * answered - with nothing opened, sent or written.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;
const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const RETROHUNT: string = "/detection-rule/retrohunt";

const SAVED_YAML: string = `title: Saved rule
detection:
  selection:
    statusName: Failure
  condition: selection`;

const FORM_YAML: string = `title: The form's rule
detection:
  selection:
    statusName: Success
  condition: selection`;

const ANSWER: DetectionRetrohuntResult = {
  startTime: new Date("2026-10-20T12:00:00.000Z"),
  endTime: new Date("2026-10-27T12:00:00.000Z"),
  periodInHours: 168,
  isCorrelation: false,
  windowInMinutes: 5,
  threshold: 3,
  firedCount: 2,
  groupCount: 1,
  eventCount: 9,
  matchedEventCount: 11,
  exceptionCount: 0,
  skippedEventCount: 0,
  preventedFiredCount: 0,
  groups: [
    {
      value: "alice",
      entityType: "User",
      firedCount: 2,
      eventCount: 9,
      firstFiredAt: new Date("2026-10-21T03:05:00.000Z"),
      lastFiredAt: new Date("2026-10-26T03:05:00.000Z"),
      sampleMessage: "Failed sign-in",
      summary: "",
    },
  ],
  hasMoreGroups: false,
  candidateLimit: null,
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let run: jest.SpyInstance;
const res: ExpressResponse = {} as ExpressResponse;

function setPermissions(...permissions: Array<Permission>): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  } as never;
}

function handler(): Handler {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === RETROHUNT;
    });
  expect(found).toBeDefined();
  return found!.handlers[found!.handlers.length - 1]!;
}

async function ask(body: unknown): Promise<void> {
  await handler()({ params: {}, body } as unknown as ExpressRequest, res, next);
}

function asked(): DetectionRetrohuntRequest {
  return run.mock.calls[0]![0] as DetectionRetrohuntRequest;
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject;
}

function savedRule(projectId: ObjectID = PROJECT): jest.SpyInstance {
  const rule: DetectionRule = new DetectionRule();
  rule._id = RULE_ID.toString();
  rule.projectId = projectId;
  rule.sigmaRuleYaml = SAVED_YAML;
  rule.groupByField = "principalUser";
  rule.matchCountThreshold = 5;
  rule.evaluationIntervalInMinutes = 10;

  return jest
    .spyOn(DetectionRuleService, "findOneBy")
    .mockResolvedValue(rule as never);
}

beforeAll(() => {
  new DetectionRuleAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityMember);
  next = jest.fn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({ serviceIds: [SERVICE_ID] });
  run = jest.spyOn(DetectionRuleRetrohunt, "run").mockResolvedValue(ANSWER);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /detection-rule/retrohunt", () => {
  test("resolves the user and requires authentication first", () => {
    const found: { uri: string; handlers: Array<Handler> } | undefined =
      recordedRoutes.find((item: { uri: string }) => {
        return item.uri === RETROHUNT;
      });

    expect(found?.handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
    expect(found?.handlers).toHaveLength(3);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])(
    "%s may run a rule on past events: it reads rules and events",
    async (permission: Permission) => {
      setPermissions(permission);

      await ask({ sigmaRuleYaml: FORM_YAML });

      expect(next).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  test("a role that reads detection rules but not security events may not", async () => {
    setPermissions(Permission.ReadProjectDetectionRule);

    await ask({ sigmaRuleYaml: FORM_YAML });

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(String((next.mock.calls[0]![0] as Error).message)).toContain(
      "security events",
    );
    expect(run).not.toHaveBeenCalled();
  });

  test("a role with neither may not", async () => {
    setPermissions(Permission.ProjectMember);

    await ask({ sigmaRuleYaml: FORM_YAML });

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(run).not.toHaveBeenCalled();
  });

  test("the form's rule, not saved yet: its YAML and how it counts, over the period asked", async () => {
    await ask({
      sigmaRuleYaml: FORM_YAML,
      groupByField: "principalIp",
      distinctCountField: "",
      matchCountThreshold: "4",
      evaluationIntervalInMinutes: 15,
      periodInHours: 24,
    });

    expect(asked()).toEqual({
      projectId: PROJECT,
      rule: {
        id: undefined,
        sigmaRuleYaml: FORM_YAML,
        groupByField: "principalIp",
        distinctCountField: "",
        matchCountThreshold: 4,
        evaluationIntervalInMinutes: 15,
      },
      periodInHours: 24,
      serviceFilter: { serviceIds: [SERVICE_ID] },
    });
  });

  test("a week when no period is asked", async () => {
    await ask({ sigmaRuleYaml: FORM_YAML });

    expect(asked().periodInHours).toBe(168);
  });

  test("a saved rule is read as the caller, in their project, and run as saved", async () => {
    const find: jest.SpyInstance = savedRule();

    await ask({ detectionRuleId: RULE_ID.toString() });

    const findArgs: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    } = find.mock.calls[0]![0] as {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    };

    expect(findArgs.query["_id"]!.toString()).toBe(RULE_ID.toString());
    expect(findArgs.query["projectId"]).toBe(PROJECT);
    expect(findArgs.props).toBe(props);

    expect(asked().rule).toEqual({
      id: RULE_ID,
      sigmaRuleYaml: SAVED_YAML,
      groupByField: "principalUser",
      distinctCountField: undefined,
      matchCountThreshold: 5,
      evaluationIntervalInMinutes: 10,
    });
  });

  test("an edit runs the form's values over the saved rule, and keeps its exceptions", async () => {
    savedRule();

    await ask({
      detectionRuleId: RULE_ID.toString(),
      sigmaRuleYaml: FORM_YAML,
      groupByField: "",
      matchCountThreshold: 2,
    });

    expect(asked().rule).toEqual({
      id: RULE_ID,
      sigmaRuleYaml: FORM_YAML,
      // Emptied in the form: the form's.
      groupByField: "",
      distinctCountField: undefined,
      matchCountThreshold: 2,
      evaluationIntervalInMinutes: 10,
    });
  });

  test("a rule the caller cannot read is one that does not exist", async () => {
    jest
      .spyOn(DetectionRuleService, "findOneBy")
      .mockResolvedValue(null as never);

    await ask({ detectionRuleId: RULE_ID.toString() });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "This detection rule was not found. It may have been deleted.",
    );
    expect(run).not.toHaveBeenCalled();
  });

  test("another project's rule is refused", async () => {
    savedRule(OTHER_PROJECT);

    await ask({ detectionRuleId: RULE_ID.toString() });

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    [{ matchCountThreshold: "lots" }, "Match count threshold must be a number."],
    [{ evaluationIntervalInMinutes: "soon" }, "Evaluation interval must be a number."],
    [{ periodInHours: "all of it" }, "The period must be a number."],
  ])(
    "a number that is not one is refused, never guessed: %o",
    async (body: JSONObject, message: string) => {
      await ask({ sigmaRuleYaml: FORM_YAML, ...body });

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect((next.mock.calls[0]![0] as Error).message).toBe(message);
      expect(run).not.toHaveBeenCalled();
    },
  );

  test("reads only the sources the caller may read, of security events", async () => {
    const filter: jest.SpyInstance = jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockResolvedValue({ excludedServiceIds: [SERVICE_ID] });

    await ask({ sigmaRuleYaml: FORM_YAML });

    expect(filter).toHaveBeenCalledWith({ modelType: SecurityEvent, props });
    expect(asked().serviceFilter).toEqual({
      excludedServiceIds: [SERVICE_ID],
    });
  });

  test("answers with what the rule would have found, as JSON", async () => {
    await ask({ sigmaRuleYaml: FORM_YAML });

    const body: JSONObject = answered();

    expect(body["firedCount"]).toBe(2);
    expect(body["matchedEventCount"]).toBe(11);
    expect(body["startTime"]).toBe("2026-10-20T12:00:00.000Z");
    expect((body["groups"] as Array<JSONObject>)[0]!["value"]).toBe("alice");
  });

  test("a body that is not an object asks about nothing, and the run says so", async () => {
    run.mockRejectedValue(
      new BadDataException("Sigma rule YAML is required.") as never,
    );

    await ask("not an object");

    expect(asked().rule.sigmaRuleYaml).toBe("");
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
  });
});
