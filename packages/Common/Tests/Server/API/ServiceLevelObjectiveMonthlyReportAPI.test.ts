import ServiceLevelObjectiveAPI, {
  SLO_MONTHLY_REPORT_NOT_FOUND_MESSAGE,
  SLO_MONTHLY_REPORT_PERMISSION_MESSAGE,
  SLO_RELEASE_CHECK_BAD_ID_MESSAGE,
} from "../../../Server/API/ServiceLevelObjectiveAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SloMonthlyReportMeasurement, {
  SLO_MONTHLY_REPORT_SELECT,
} from "../../../Server/Utils/Slo/SloMonthlyReportMeasurement";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import UserType from "../../../Types/UserType";
import {
  SLO_MONTHLY_REPORT_OPTION_ERRORS,
  SloMonthlyReport,
  SloMonthlyReportPeriodKind,
  buildSloMonthlyReport,
  getSloReportMonths,
  parseSloMonthlyReport,
  sloMonthlyReportToJSON,
} from "../../../Utils/Slo/SloMonthlyReport";

/*
 * GET /service-level-objective/:id/monthly-report: an SLO's months (#5476).
 * The route is captured from the router, and the SLO read and the
 * measurement are stubbed, so these tests pin the endpoint's own contract:
 * who may ask, how the period is read, and what is answered - and that the
 * per-monitor breakdown names only the monitors the caller may read.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ method: "post", uri, handlers });
        },
        get: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ method: "get", uri, handlers });
        },
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

jest.mock("../../../Server/Utils/Logger");

const PROJECT: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000001");
const USER: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000002");
const SLO_ID: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000003");
const MONITOR_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000004",
);

const PATH: string = "/service-level-objective/:id/monthly-report";
const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let findSpy: jest.SpyInstance;
let measureSpy: jest.SpyInstance;
const res: ExpressResponse = {} as ExpressResponse;

const REPORT: SloMonthlyReport = buildSloMonthlyReport({
  sloId: SLO_ID,
  sloName: "Checkout",
  sliType: SliType.MonitorUptime,
  targetPercentage: 99.9,
  timezone: "UTC",
  period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 3 },
  months: getSloReportMonths({
    period: { kind: SloMonthlyReportPeriodKind.LastMonths, months: 3 },
    now: NOW,
  }),
  figures: [
    { total: 30 * 86400, bad: 0, sliPercentage: 100 },
    { total: 31 * 86400, bad: 3600, sliPercentage: 99.8656 },
    { total: 15.5 * 86400, bad: 0, sliPercentage: 100 },
  ],
  now: NOW,
});

function withPermissions(permissions: Array<Permission>): void {
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

function route(): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((candidate: { method: string; uri: string }) => {
      return candidate.method === "get" && candidate.uri === PATH;
    });

  expect(found).toBeDefined();
  return found!;
}

async function ask(
  data: { id?: string; query?: JSONObject } = {},
): Promise<void> {
  const handlers: Array<Handler> = route().handlers;

  await handlers[handlers.length - 1]!(
    {
      params: { id: data.id ?? SLO_ID.toString() },
      query: data.query || {},
    } as unknown as ExpressRequest,
    res,
    next,
  );
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0]![2] as JSONObject;
}

function refusal(): Error {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Error;
}

function monitorSlo(): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(SLO_ID);
  slo.projectId = PROJECT;
  slo.name = "Checkout";
  slo.sliType = SliType.MonitorUptime;
  slo.targetPercentage = 99.9;
  slo.monitors = [new Monitor(MONITOR_ID)];
  return slo;
}

beforeAll(() => {
  new ServiceLevelObjectiveAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT, userType: UserType.User };
  withPermissions([Permission.ReadServiceLevelObjective]);
  next = jest.fn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  findSpy = jest
    .spyOn(ServiceLevelObjectiveService, "findOneById")
    .mockResolvedValue(monitorSlo());

  measureSpy = jest
    .spyOn(SloMonthlyReportMeasurement, "measure")
    .mockResolvedValue(REPORT);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the route", () => {
  test("is a GET beside the SLO's CRUD path, behind the user middleware", () => {
    const handlers: Array<Handler> = route().handlers;

    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(UserMiddleware.getUserMiddleware);
  });

  test("the SLO's release check and its own CRUD routes are still there", () => {
    const uris: Array<string> = recordedRoutes.map(
      (candidate: { uri: string }): string => {
        return candidate.uri;
      },
    );

    expect(uris).toContain("/service-level-objective/:id/release-check");
    expect(uris).toContain("/service-level-objective/:id/get-item");
  });
});

describe("the answer", () => {
  test("is the report as JSON, which reads back as the report", async () => {
    await ask();

    const body: JSONObject = answered();

    expect(body).toEqual(sloMonthlyReportToJSON(REPORT));
    expect(parseSloMonthlyReport(JSON.parse(JSON.stringify(body)))).toEqual(
      REPORT,
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("reads the SLO as the caller, with only what the report needs", async () => {
    await ask();

    const args: { id: ObjectID; select: unknown; props: unknown } =
      findSpy.mock.calls[0]![0];

    expect(args.id.toString()).toBe(SLO_ID.toString());
    expect(args.select).toBe(SLO_MONTHLY_REPORT_SELECT);
    expect(args.props).toBe(props);
    expect(measureSpy.mock.calls[0]![0].now).toBe(NOW);
  });
});

describe("how the period is read", () => {
  test("no period is the last 12 months", async () => {
    await ask();

    expect(measureSpy.mock.calls[0]![0].period).toEqual({
      kind: SloMonthlyReportPeriodKind.LastMonths,
      months: 12,
    });
  });

  test("months from the query string", async () => {
    await ask({ query: { months: "6" } });

    expect(measureSpy.mock.calls[0]![0].period).toEqual({
      kind: SloMonthlyReportPeriodKind.LastMonths,
      months: 6,
    });
  });

  test("a calendar year from the query string", async () => {
    await ask({ query: { year: "2025" } });

    expect(measureSpy.mock.calls[0]![0].period).toEqual({
      kind: SloMonthlyReportPeriodKind.Year,
      year: 2025,
    });
  });

  test.each([
    [{ months: "0" }, SLO_MONTHLY_REPORT_OPTION_ERRORS.months],
    [{ months: "36" }, SLO_MONTHLY_REPORT_OPTION_ERRORS.months],
    [{ year: "1990" }, SLO_MONTHLY_REPORT_OPTION_ERRORS.year],
    [{ months: "3", year: "2025" }, SLO_MONTHLY_REPORT_OPTION_ERRORS.both],
  ])(
    "%p is refused before the SLO is read",
    async (query: JSONObject, message: string) => {
      await ask({ query: query });

      const error: Error = refusal();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(message);
      expect(findSpy).not.toHaveBeenCalled();
      expect(measureSpy).not.toHaveBeenCalled();
    },
  );
});

describe("who may ask", () => {
  test("a role that cannot read SLOs is refused, and nothing is read", async () => {
    withPermissions([Permission.ReadProjectMonitor]);

    await ask();

    expect(refusal().message).toBe(SLO_MONTHLY_REPORT_PERMISSION_MESSAGE);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("an ID that is not one is refused", async () => {
    await ask({ id: "not-an-id" });

    const error: Error = refusal();

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(SLO_RELEASE_CHECK_BAD_ID_MESSAGE);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("an SLO the caller cannot see is answered as missing", async () => {
    findSpy.mockResolvedValue(null);

    await ask();

    const error: Error = refusal();

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(SLO_MONTHLY_REPORT_NOT_FOUND_MESSAGE);
    expect(measureSpy).not.toHaveBeenCalled();
  });

  test("every refusal is a sentence", () => {
    for (const message of [
      SLO_MONTHLY_REPORT_PERMISSION_MESSAGE,
      SLO_MONTHLY_REPORT_NOT_FOUND_MESSAGE,
    ]) {
      expect(message).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe("readMonitorNames", () => {
  test("reads the monitors' names as the caller", async () => {
    withPermissions([
      Permission.ReadServiceLevelObjective,
      Permission.ReadProjectMonitor,
    ]);

    const monitor: Monitor = new Monitor(MONITOR_ID);
    monitor.name = "Payments API";

    const find: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([monitor]);

    const names: Map<string, string> =
      await ServiceLevelObjectiveAPI.readMonitorNames({
        projectId: PROJECT,
        monitorIds: [MONITOR_ID],
        props: props,
      });

    expect(names.get(MONITOR_ID.toString())).toBe("Payments API");
    expect(find.mock.calls[0]![0].props).toBe(props);
    expect(find.mock.calls[0]![0].query.projectId).toBe(PROJECT);
  });

  test("a role that may not read monitors gets no names, and no error", async () => {
    const find: jest.SpyInstance = jest.spyOn(MonitorService, "findBy");

    const names: Map<string, string> =
      await ServiceLevelObjectiveAPI.readMonitorNames({
        projectId: PROJECT,
        monitorIds: [MONITOR_ID],
        props: props,
      });

    expect(names.size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });

  test("a refusal from the read itself gets no names either", async () => {
    withPermissions([
      Permission.ReadServiceLevelObjective,
      Permission.ReadProjectMonitor,
    ]);

    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("Not allowed."));

    expect(
      (
        await ServiceLevelObjectiveAPI.readMonitorNames({
          projectId: PROJECT,
          monitorIds: [MONITOR_ID],
          props: props,
        })
      ).size,
    ).toBe(0);
  });

  test("any other failure is not hidden", async () => {
    withPermissions([
      Permission.ReadServiceLevelObjective,
      Permission.ReadProjectMonitor,
    ]);

    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("The database is down."));

    await expect(
      ServiceLevelObjectiveAPI.readMonitorNames({
        projectId: PROJECT,
        monitorIds: [MONITOR_ID],
        props: props,
      }),
    ).rejects.toThrow("The database is down.");
  });

  test("no monitors reads nothing", async () => {
    const find: jest.SpyInstance = jest.spyOn(MonitorService, "findBy");

    expect(
      (
        await ServiceLevelObjectiveAPI.readMonitorNames({
          projectId: PROJECT,
          monitorIds: [],
          props: props,
        })
      ).size,
    ).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
