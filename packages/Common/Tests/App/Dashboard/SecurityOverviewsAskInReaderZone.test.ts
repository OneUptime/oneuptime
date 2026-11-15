import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import OneUptimeDate from "../../../Types/Date";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import Timezone from "../../../Types/Timezone";
import API from "../../../UI/Utils/API/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The Security and Data Security overviews ask for their day bars in the
 * reader's zone (issue #7925): the cases-opened, detections and issue-trend
 * bars are cut on the server, so the page sends the zone it reads days in
 * (OneUptimeDate.getCurrentTimezone(): User Settings', else the browser's),
 * as AnalyticsModelAPI.aggregate sends it with every chart's read. A zone
 * the Timezone list does not name is not sent - the server would drop it -
 * and the request names none, as an older Dashboard's did.
 */

interface Posted {
  url: string;
  data: JSONObject;
}

let posted: Array<Posted>;

beforeEach(() => {
  posted = [];
  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    posted.push({ url: request.url.toString(), data: request.data });
    return new HTTPResponse(200, {}, {});
  }) as never);
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

const OVERVIEWS: Array<[string, () => Promise<unknown>, string]> = [
  [
    "the Security overview",
    (): Promise<unknown> => {
      return SecurityCaseApi.getOverview();
    },
    "/security-case/overview",
  ],
  [
    "the Data Security overview",
    (): Promise<unknown> => {
      return DataSecurityApi.getOverview();
    },
    DATA_SECURITY_API_ROUTES.overview,
  ],
];

describe.each(OVERVIEWS)(
  "%s",
  (_name: string, read: () => Promise<unknown>, route: string) => {
    test.each([
      Timezone.AmericaNew_York,
      Timezone.EuropeLondon,
      Timezone.AsiaKolkata,
      Timezone.AsiaKathmandu,
      Timezone.PacificAuckland,
      Timezone.UTC,
    ])("asks in the zone User Settings picked: %s", async (zone: Timezone) => {
      OneUptimeDate.setUserTimezone(zone);

      await read();

      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toContain(route);
      expect(posted[0]!.data).toEqual({ timezone: zone });
    });

    test("asks in the browser's zone when the reader picked none", async () => {
      jest
        .spyOn(OneUptimeDate, "getCurrentTimezone")
        .mockReturnValue(Timezone.AsiaTokyo);

      await read();

      expect(posted[0]!.data).toEqual({ timezone: Timezone.AsiaTokyo });
    });

    test("a legacy name the reader saved is sent by its current name", async () => {
      OneUptimeDate.setUserTimezone(Timezone.AsiaCalcutta);

      await read();

      expect(posted[0]!.data).toEqual({ timezone: Timezone.AsiaKolkata });
    });

    test("a zone the list does not name is not sent: the request names none", async () => {
      jest
        .spyOn(OneUptimeDate, "getCurrentTimezone")
        .mockReturnValue("Mars/Olympus_Mons" as Timezone);

      await read();

      expect(posted[0]!.data).toEqual({});
    });
  },
);

describe("AggregationIntervalUtil.getListedReaderTimezone", () => {
  test("is the reader's zone, when the list names it", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    expect(AggregationIntervalUtil.getListedReaderTimezone()).toBe(
      Timezone.AmericaNew_York,
    );
  });

  test("is undefined for a zone the list does not name", () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentTimezone")
      .mockReturnValue("Mars/Olympus_Mons" as Timezone);
    expect(AggregationIntervalUtil.getListedReaderTimezone()).toBeUndefined();
  });

  test("is the zone every chart's read asks its days in", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKathmandu);
    const thirtyDays: { startDate: Date; endDate: Date } = {
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-31T00:00:00.000Z"),
    };

    expect(AggregationIntervalUtil.getListedReaderTimezone()).toBe(
      AggregationIntervalUtil.getReaderTimezone(thirtyDays),
    );
  });
});
