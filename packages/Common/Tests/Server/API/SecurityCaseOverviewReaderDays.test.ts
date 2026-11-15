import SecurityCaseAPI from "../../../Server/API/SecurityCaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../Server/Services/SecurityDetectionService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import SecurityRiskiestEntitiesReader from "../../../Server/Utils/SecurityEvent/EntityRisk/SecurityRiskiestEntities";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { DayCount } from "../../../Utils/SecurityCase/SecurityOverviewMetrics";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /security-case/overview counts the reader's days (issue #7925): the
 * page sends the reader's zone, and the cases-opened and detections bars are
 * cut on that zone's calendar. A zone the Timezone list does not name - a
 * typo, a zone newer than the list, a number, text written to be SQL - is
 * dropped, and those days stay UTC's, as an older Dashboard that sends no
 * zone gets: the overview is never refused over it.
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
  const record: (method: string) => (...args: Array<unknown>) => void = (
    method: string,
  ) => {
    return (uri: unknown, ...handlers: Array<unknown>): void => {
      recordedRoutes.push({
        method,
        uri: String(uri),
        handlers: handlers as Array<Handler>,
      });
    };
  };

  return {
    getRouter: () => {
      return {
        post: record("post"),
        get: record("get"),
        put: record("put"),
        delete: record("delete"),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT: ObjectID = new ObjectID("53535353-5353-4353-8353-535353535353");
const USER: ObjectID = new ObjectID("54545454-5454-4454-8454-545454545454");
const OVERVIEW: string = "/security-case/overview";

// 10:00 on 10 November in New York; the bars are the 30 and 14 days before.
const NOW: Date = new Date("2026-11-10T15:00:00.000Z");

// 20:00 on 4 November in New York, 01:00 on the 5th in UTC.
const OPENED_AT: Date = new Date("2026-11-05T01:00:00.000Z");
// The 25th hour of New York's 1 November: 04:30 UTC on the 2nd.
const TWENTY_FIFTH_HOUR: Date = new Date("2026-11-02T04:30:00.000Z");
// Five past midnight on 5 November in Kathmandu, 18:20 UTC on the 4th.
const KATHMANDU_MIDNIGHT: Date = new Date("2026-11-04T18:20:00.000Z");

let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function caseOpenedAt(createdAt: Date): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = ObjectID.generate().toString();
  model.createdAt = createdAt;
  return model;
}

function detectionSeenAt(firstSeenAt: Date): SecurityDetection {
  const model: SecurityDetection = new SecurityDetection();
  model._id = ObjectID.generate().toString();
  model.createdAt = firstSeenAt;
  model.firstSeenAt = firstSeenAt;
  model.source = SecurityDetectionSource.DetectionRule;
  model.ruleName = "Impossible travel";
  return model;
}

function overviewRoute(): Handler {
  const found: Array<{ handlers: Array<Handler> }> = recordedRoutes.filter(
    (item: { uri: string }): boolean => {
      return item.uri === OVERVIEW;
    },
  );
  expect(found).toHaveLength(1);
  return found[0]!.handlers[found[0]!.handlers.length - 1]!;
}

async function askWith(body: unknown): Promise<JSONObject> {
  await overviewRoute()(
    { params: {}, body: body } as unknown as ExpressRequest,
    res,
    next as unknown as NextFunction,
  );

  expect(next).not.toHaveBeenCalled();
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return (mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject)[
    "metrics"
  ] as JSONObject;
}

// The bars with something on them, as { day: total }.
function countedDays(value: JSONValue | undefined): Record<string, number> {
  const counted: Record<string, number> = {};

  for (const day of (value || []) as unknown as Array<DayCount>) {
    if (day.total > 0) {
      counted[day.day] = day.total;
    }
  }

  return counted;
}

function lastDay(value: JSONValue | undefined): string {
  const days: Array<DayCount> = (value || []) as unknown as Array<DayCount>;
  return days[days.length - 1]!.day;
}

beforeAll(() => {
  new SecurityCaseAPI();
});

beforeEach(() => {
  next = jest.fn();
  stubSecurityCaseValues();

  const props: DatabaseCommonInteractionProps = {
    userId: USER,
    tenantId: PROJECT,
    userTenantAccessPermission: {
      [PROJECT.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.SecurityViewer,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  } as unknown as DatabaseCommonInteractionProps;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  let reads: number = 0;
  jest.spyOn(SecurityCaseService, "findBy").mockImplementation((async () => {
    reads++;
    // The open cases first, then the cases opened in the window.
    return reads % 2 === 1
      ? []
      : [
          caseOpenedAt(OPENED_AT),
          caseOpenedAt(TWENTY_FIFTH_HOUR),
          caseOpenedAt(KATHMANDU_MIDNIGHT),
        ];
  }) as never);
  jest
    .spyOn(SecurityDetectionService, "findBy")
    .mockResolvedValue([detectionSeenAt(OPENED_AT)] as never);
  jest
    .spyOn(SecurityPlaybookRunService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest.spyOn(SecurityRiskiestEntitiesReader, "read").mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /security-case/overview, in the reader's zone", () => {
  test("a New York reader's case opened at 01:00 UTC on 5 November is on the 4 November bar", async () => {
    const metrics: JSONObject = await askWith({
      timezone: "America/New_York",
    });

    expect(countedDays(metrics["casesOpenedPerDay"])).toEqual({
      "2026-11-01": 1,
      "2026-11-04": 2,
    });
    expect(countedDays(metrics["detectionsPerDay"])).toEqual({
      "2026-11-04": 1,
    });
    expect(lastDay(metrics["casesOpenedPerDay"])).toBe("2026-11-10");
  });

  test("a Kathmandu reader's days start at 18:15 UTC the day before", async () => {
    const metrics: JSONObject = await askWith({ timezone: "Asia/Kathmandu" });

    // 06:45 and 00:05 on the 5th there, and 10:15 on the 2nd.
    expect(countedDays(metrics["casesOpenedPerDay"])).toEqual({
      "2026-11-02": 1,
      "2026-11-05": 2,
    });
  });

  test("a legacy name counts the days of the zone it stands for", async () => {
    const legacy: JSONObject = await askWith({ timezone: "US/Pacific-New" });
    const current: JSONObject = await askWith({
      timezone: "America/Los_Angeles",
    });

    expect(countedDays(legacy["casesOpenedPerDay"])).toEqual(
      countedDays(current["casesOpenedPerDay"]),
    );
    // 17:00 and 10:20 on the 4th, and 20:30 on the 1st, in Los Angeles.
    expect(countedDays(current["casesOpenedPerDay"])).toEqual({
      "2026-11-01": 1,
      "2026-11-04": 2,
    });
  });

  test("no zone is UTC's days, as an older Dashboard always got", async () => {
    const metrics: JSONObject = await askWith({});

    expect(countedDays(metrics["casesOpenedPerDay"])).toEqual({
      "2026-11-02": 1,
      "2026-11-04": 1,
      "2026-11-05": 1,
    });
    expect(countedDays(metrics["detectionsPerDay"])).toEqual({
      "2026-11-05": 1,
    });
  });

  test.each([
    ["a zone the list does not name", "Mars/Olympus_Mons"],
    ["a name in the wrong case", "america/new_york"],
    ["an offset", "+05:30"],
    ["a number", -300],
    ["text written to be SQL", "UTC'); DROP TABLE SecurityCase; --"],
    ["an object", { name: "America/New_York" }],
    ["null", null],
  ] as Array<[string, unknown]>)(
    "%s is dropped: the overview is answered, on UTC's days",
    async (_name: string, timezone: unknown) => {
      const metrics: JSONObject = await askWith({ timezone: timezone });

      expect(countedDays(metrics["casesOpenedPerDay"])).toEqual({
        "2026-11-02": 1,
        "2026-11-04": 1,
        "2026-11-05": 1,
      });
    },
  );

  test("a body that is not an object is answered on UTC's days", async () => {
    const metrics: JSONObject = await askWith(undefined);

    expect(countedDays(metrics["casesOpenedPerDay"])).toEqual({
      "2026-11-02": 1,
      "2026-11-04": 1,
      "2026-11-05": 1,
    });
  });
});
