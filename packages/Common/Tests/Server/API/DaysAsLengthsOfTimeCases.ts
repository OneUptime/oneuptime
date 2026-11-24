import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import DataSecurityAiReads from "../../../Server/Utils/AI/DataSecurity/DataSecurityAiReads";
import SecurityCaseAPI from "../../../Server/API/SecurityCaseAPI";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import DataAssetFeedService from "../../../Server/Services/DataAssetFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../Server/Services/SecurityDetectionService";
import SecurityEntityRiskService from "../../../Server/Services/SecurityEntityRiskService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import { SecurityAddressVaultService } from "../../../Server/Services/SecurityAddressVaultService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import DataObservabilityAttentionReader from "../../../Server/Utils/DataObservability/DataObservabilityAttentionReader";
import DataSecurityEvaluator from "../../../Server/Utils/DataSecurity/DataSecurityEvaluator";
import DataSecurityFindingWriter, {
  FINDING_RETENTION_IN_DAYS,
} from "../../../Server/Utils/DataSecurity/DataSecurityFindingWriter";
import SecurityEntityRiskRecorder from "../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import SecurityRiskiestEntitiesReader from "../../../Server/Utils/SecurityEvent/EntityRisk/SecurityRiskiestEntities";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../../../Server/Utils/OnCall/CalendarFeedToken";
import { getSessionReplayRetentionDate } from "../../../Server/Utils/SessionReplay/SessionReplayRetention";
import {
  IngestionStamp,
  getRetentionDateDb,
} from "../../../Server/Utils/Telemetry/IngestionTimestamp";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import { SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS } from "../../../Models/AnalyticsModels/SecurityAddressVault";
import { SCHEMA_CHANGE_WINDOW_IN_DAYS } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataSecurityOverview } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  FINDING_FRESHNESS_IN_DAYS,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { JSONObject } from "../../../Types/JSON";
import { PREVIOUS_TOKEN_GRACE_DAYS } from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { ENTITY_RISK_HISTORY_IN_DAYS } from "../../../Types/SecurityCase/SecurityEntityRisk";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import {
  DayCount,
  SecurityOverviewMetrics,
} from "../../../Utils/SecurityCase/SecurityOverviewMetrics";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import { afterEach, describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * "THE LAST N DAYS" IS A LENGTH OF TIME, ON EVERY SERVER (issue #8236).
 *
 * The Security overview's last 30 and 14 days, Data Observability's last 7
 * days of schema changes, Data Security's 30 days of fresh findings, its 90
 * days of kept ones, Entity Risk's 30 quiet days and every caller of
 * OneUptimeDate's getSomeDays family stepped the server's own calendar
 * (moment's add(n, "days"), addRemoveDays without a zone). On a server
 * whose zone moves its clocks, N calendar days across a change are an hour
 * (half an hour on Lord Howe Island) more or less than N x 24 hours. CI
 * runs in UTC, where they never are, so nothing failed there.
 *
 * These cases run with the process in a zone of its own (the zone
 * docblock of each file that calls describeDaysAsLengthsOfTime: east and
 * west of UTC, both hemispheres, half-hour and 45-minute offsets, and
 * zones that never change their clocks). For every clock change the zone
 * makes in 2026 they read each window from a moment just after it - and
 * from one just before it, for a window that reaches forward over it -
 * and the first tests show those changes are there, so the cases fail on
 * the old code wherever the zone has any.
 *
 * Data Security's issue trend is the reader's calendar days, not a length:
 * it is checked against the platform's own clock (Intl) in several reader
 * zones, whatever zone the server is in.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

const PROJECT: ObjectID = new ObjectID("8236aaaa-8236-4236-8236-823682368236");

export interface ZoneUnderTest {
  // The zone the process runs in, as the docblock names it.
  zone: string;
  // How far its clocks move at each change in 2026, in minutes; [] for none.
  clockChangeMinutes: Array<number>;
}

interface ClockChange {
  // The first instant on the new offset.
  atMs: number;
  // Minutes the clocks moved: positive forward, negative back.
  movedMinutes: number;
}

// Each instant in 2026 the process's zone changes its offset at.
function clockChangesOfTheProcessIn2026(): Array<ClockChange> {
  const changes: Array<ClockChange> = [];
  const startMs: number = Date.parse("2026-01-01T00:00:00.000Z");
  const endMs: number = Date.parse("2027-01-01T00:00:00.000Z");
  const step: number = 15 * MINUTE_MS;
  let previousOffset: number = new Date(startMs).getTimezoneOffset();

  for (let ms: number = startMs + step; ms <= endMs; ms += step) {
    const offset: number = new Date(ms).getTimezoneOffset();

    if (offset !== previousOffset) {
      // getTimezoneOffset is minutes BEHIND UTC: it falls as clocks go forward.
      changes.push({ atMs: ms, movedMinutes: previousOffset - offset });
      previousOffset = offset;
    }
  }

  return changes;
}

/*
 * The moments a window is read from: three days after each clock change
 * (a window reaching back over it), three days before (one reaching
 * forward), and, in a zone with none, a winter and a summer day.
 */
function momentsAroundTheChanges(changes: Array<ClockChange>): Array<Date> {
  if (changes.length === 0) {
    return [
      new Date("2026-01-20T13:37:00.000Z"),
      new Date("2026-07-20T01:05:00.000Z"),
    ];
  }

  return changes.flatMap((change: ClockChange): Array<Date> => {
    return [
      new Date(change.atMs + 3 * DAY_MS + 7 * HOUR_MS + 11 * MINUTE_MS),
      new Date(change.atMs - 3 * DAY_MS - 5 * HOUR_MS),
    ];
  });
}

// The date an instant falls on in `timezone`, as the platform's clock has it.
function platformDay(ms: number, timezone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(new Date(ms));
  const part: (type: string) => string = (type: string): string => {
    return parts.find((item: Intl.DateTimeFormatPart): boolean => {
      return item.type === type;
    })!.value;
  };

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/*
 * The first instant of the day `ms` falls on in `timezone`, found on the
 * platform's clock: the latest minute whose date is that day's and whose
 * minute before it is another day's.
 */
function platformStartOfDay(ms: number, timezone: string): number {
  const day: string = platformDay(ms, timezone);
  let start: number = Math.floor(ms / MINUTE_MS) * MINUTE_MS;

  while (platformDay(start - MINUTE_MS, timezone) === day) {
    start -= MINUTE_MS;
  }

  return start;
}

// The calendar date `days` days before a YYYY-MM-DD one.
function dateBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// Every date a QueryHelper comparison was asked about, in the order asked.
function datesComparedWith(spy: jest.SpyInstance): Array<Date> {
  return spy.mock.calls.map((call: Array<unknown>): Date => {
    return call[0] as Date;
  });
}

function pinNow(now: Date): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now.getTime());
  });
  jest.spyOn(OneUptimeDate, "getCurrentMomentDate").mockImplementation(() => {
    return moment(now.getTime());
  });
}

function windowLabel(now: Date): string {
  return now.toISOString();
}

export default function describeDaysAsLengthsOfTime(data: ZoneUnderTest): void {
  const changes: Array<ClockChange> = clockChangesOfTheProcessIn2026();
  const moments: Array<Date> = momentsAroundTheChanges(changes);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe(`the server's zone, ${data.zone}`, () => {
    test("is the one the docblock asked for", () => {
      // In its current name: ICU says Asia/Calcutta and Asia/Katmandu.
      expect(
        TimezoneAlias.getCanonicalTimezone(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ).toBe(data.zone);
    });

    test("changes its clocks in 2026 as the zone does", () => {
      expect(
        changes.map((change: ClockChange): number => {
          return Math.abs(change.movedMinutes);
        }),
      ).toEqual(data.clockChangeMinutes);

      // Both ways: forward once and back once, when it moves at all.
      if (changes.length > 0) {
        expect(
          new Set(
            changes.map((change: ClockChange): number => {
              return Math.sign(change.movedMinutes);
            }),
          ),
        ).toEqual(new Set([1, -1]));
      }
    });

    test("steps its own calendar days a clock change short or long, so the windows below would not be N x 24 hours on the old code", () => {
      for (const change of changes) {
        const after: Date = new Date(change.atMs + 3 * DAY_MS);
        const spanMs: number =
          after.getTime() - OneUptimeDate.addRemoveDays(after, -7).getTime();

        // Back over a change forward: a day of 23 hours (23.5 on Lord Howe).
        expect(spanMs).toBe(7 * DAY_MS - change.movedMinutes * MINUTE_MS);
      }

      if (changes.length === 0) {
        for (const now of moments) {
          expect(
            now.getTime() - OneUptimeDate.addRemoveDays(now, -30).getTime(),
          ).toBe(30 * DAY_MS);
        }
      }
    });
  });

  describe("OneUptimeDate's getSomeDays family steps lengths of time", () => {
    const DAY_COUNTS: Array<number> = [1, 7, 14, 30, 90];

    test.each(moments.map(windowLabel))(
      "from %s, N days ago and N days on are N x 24 hours away",
      (iso: string) => {
        const now: Date = new Date(iso);
        pinNow(now);

        for (const days of DAY_COUNTS) {
          const span: number = days * DAY_MS;

          expect(OneUptimeDate.getSomeDaysAgo(days).getTime()).toBe(
            now.getTime() - span,
          );
          expect(
            OneUptimeDate.getSomeDaysAgo(new PositiveNumber(days)).getTime(),
          ).toBe(now.getTime() - span);
          expect(OneUptimeDate.getSomeDaysAfter(days).getTime()).toBe(
            now.getTime() + span,
          );
          expect(
            OneUptimeDate.getSomeDaysAfter(new PositiveNumber(days)).getTime(),
          ).toBe(now.getTime() + span);
          expect(
            OneUptimeDate.getSomeDaysAgoFromDate(now, days).getTime(),
          ).toBe(now.getTime() - span);
          expect(
            OneUptimeDate.getSomeDaysBeforeFromDate(now, days).getTime(),
          ).toBe(now.getTime() - span);
          expect(
            OneUptimeDate.getSomeDaysAfterFromDate(now, days).getTime(),
          ).toBe(now.getTime() + span);
        }

        expect(OneUptimeDate.getOneDayAgo().getTime()).toBe(
          now.getTime() - DAY_MS,
        );
        expect(OneUptimeDate.getOneDayAfter().getTime()).toBe(
          now.getTime() + DAY_MS,
        );
      },
    );

    test("a day across each clock change is still 24 hours, not 23 or 25", () => {
      for (const change of changes) {
        // Half an hour before the change, and the same a day after.
        const before: Date = new Date(change.atMs - 30 * MINUTE_MS);

        expect(
          OneUptimeDate.getSomeDaysAfterFromDate(before, 1).getTime() -
            before.getTime(),
        ).toBe(DAY_MS);
        expect(
          new Date(change.atMs + 30 * MINUTE_MS).getTime() -
            OneUptimeDate.getSomeDaysAgoFromDate(
              new Date(change.atMs + 30 * MINUTE_MS),
              1,
            ).getTime(),
        ).toBe(DAY_MS);
      }
    });

    test("takes an ISO string, as it did, and leaves the date it is given alone", () => {
      const from: Date = moments[0]!;
      const iso: string = from.toISOString();

      expect(
        OneUptimeDate.getSomeDaysAgoFromDate(
          iso as unknown as Date,
          7,
        ).getTime(),
      ).toBe(from.getTime() - 7 * DAY_MS);
      OneUptimeDate.getSomeDaysAfterFromDate(from, 7);
      expect(from.toISOString()).toBe(iso);
    });

    test("a part of a day is that part of 24 hours", () => {
      const from: Date = moments[0]!;

      expect(OneUptimeDate.getSomeDaysAgoFromDate(from, 0.5).getTime()).toBe(
        from.getTime() - 12 * HOUR_MS,
      );
      expect(OneUptimeDate.getSomeDaysAfterFromDate(from, 1.25).getTime()).toBe(
        from.getTime() + 30 * HOUR_MS,
      );
    });

    test("getSomeDaysAfterDate still walks calendar days: the same wall clock a day on, over each change", () => {
      for (const change of changes) {
        const before: Date = new Date(change.atMs - 2 * HOUR_MS);
        const next: Date = OneUptimeDate.getSomeDaysAfterDate(before, 1);

        expect(next.getHours()).toBe(before.getHours());
        expect(next.getMinutes()).toBe(before.getMinutes());
        expect(next.getTime() - before.getTime()).toBe(
          DAY_MS - change.movedMinutes * MINUTE_MS,
        );
      }
    });
  });

  /*
   * The Security overview's last 30 and 14 days are the reader's 30 and 14
   * days, a bar each, today's the last (issue #8474): its cases and
   * detections are read from the reader's midnight 29 and 13 days before
   * today, where the first bar starts. Read from now - 30 x 24 hours, it
   * drew 31 and 15 bars, the first only part of its day.
   */
  describe("the Security overview's last 30 and 14 days", () => {
    const OVERVIEW_READERS: Array<Timezone | undefined> = [
      undefined,
      Timezone.AmericaNew_York,
      Timezone.AsiaKathmandu,
      Timezone.AustraliaLord_Howe,
    ];

    const OVERVIEW_CASES: Array<[string, string]> = moments.flatMap(
      (now: Date): Array<[string, string]> => {
        return OVERVIEW_READERS.map(
          (zone: Timezone | undefined): [string, string] => {
            return [now.toISOString(), zone || "no zone (UTC)"];
          },
        );
      },
    );

    test.each(OVERVIEW_CASES)(
      "from %s, read in %s: 30 and 14 whole days, read from the first one's midnight",
      async (iso: string, zoneName: string) => {
        const now: Date = new Date(iso);
        const zone: Timezone | undefined = zoneName.startsWith("no zone")
          ? undefined
          : (zoneName as Timezone);
        const readerZone: string = zone || "UTC";
        const today: string = platformDay(now.getTime(), readerZone);
        const startOf: (daysBefore: number) => number = (
          daysBefore: number,
        ): number => {
          return platformStartOfDay(
            moment
              .tz(`${dateBefore(today, daysBefore)}T12:00:00`, readerZone)
              .valueOf(),
            readerZone,
          );
        };

        pinNow(now);
        stubSecurityCaseValues();
        jest.spyOn(SecurityCaseService, "findBy").mockResolvedValue([]);
        jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([]);
        jest
          .spyOn(SecurityPlaybookRunService, "countBy")
          .mockResolvedValue(new PositiveNumber(0) as never);
        jest
          .spyOn(SecurityRiskiestEntitiesReader, "read")
          .mockResolvedValue(null);
        const compared: jest.SpyInstance = jest.spyOn(
          QueryHelper,
          "greaterThanEqualTo",
        );

        const getOverview: (data: unknown) => Promise<JSONObject> = (
          SecurityCaseAPI.prototype as unknown as {
            getOverview: (data: unknown) => Promise<JSONObject>;
          }
        ).getOverview;

        const overview: JSONObject = await getOverview.call(null, {
          projectId: PROJECT,
          props: { isRoot: true },
          timezone: zone,
        });
        const metrics: SecurityOverviewMetrics = overview[
          "metrics"
        ] as unknown as SecurityOverviewMetrics;

        expect(
          datesComparedWith(compared).map((date: Date): number => {
            return date.getTime();
          }),
        ).toEqual([startOf(29), startOf(13)]);

        for (const [days, count] of [
          [metrics.casesOpenedPerDay, 30],
          [metrics.detectionsPerDay, 14],
        ] as Array<[Array<DayCount>, number]>) {
          expect(days).toHaveLength(count);
          expect(days[0]!.day).toBe(dateBefore(today, count - 1));
          expect(days[count - 1]!.day).toBe(today);

          for (let index: number = 1; index < days.length; index++) {
            expect(dateBefore(days[index]!.day, 1)).toBe(days[index - 1]!.day);
          }
        }
      },
    );

    test("the first bar is a whole day: a case at its midnight counts, one a millisecond before does not", async () => {
      const now: Date = moments[0]!;
      const zone: Timezone = Timezone.AmericaNew_York;
      const today: string = platformDay(now.getTime(), zone);
      const firstStart: number = platformStartOfDay(
        moment.tz(`${dateBefore(today, 29)}T12:00:00`, zone).valueOf(),
        zone,
      );
      const caseAt: (ms: number) => SecurityCase = (ms: number) => {
        const row: SecurityCase = new SecurityCase(ObjectID.generate());
        row.createdAt = new Date(ms);
        return row;
      };

      pinNow(now);
      stubSecurityCaseValues();
      let reads: number = 0;
      jest
        .spyOn(SecurityCaseService, "findBy")
        .mockImplementation((async () => {
          reads++;
          // The open cases first, then the cases of the window.
          return reads % 2 === 1
            ? []
            : [
                caseAt(firstStart - 1),
                caseAt(firstStart),
                caseAt(now.getTime()),
              ];
        }) as never);
      jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([]);
      jest
        .spyOn(SecurityPlaybookRunService, "countBy")
        .mockResolvedValue(new PositiveNumber(0) as never);
      jest
        .spyOn(SecurityRiskiestEntitiesReader, "read")
        .mockResolvedValue(null);

      const overview: JSONObject = await (
        SecurityCaseAPI.prototype as unknown as {
          getOverview: (data: unknown) => Promise<JSONObject>;
        }
      ).getOverview.call(null, {
        projectId: PROJECT,
        props: { isRoot: true },
        timezone: zone,
      });
      const metrics: SecurityOverviewMetrics = overview[
        "metrics"
      ] as unknown as SecurityOverviewMetrics;

      // The read is from firstStart; a row before it the database never returns.
      expect(metrics.casesOpenedPerDay[0]!.total).toBe(1);
      expect(metrics.casesOpenedPerDay[29]!.total).toBe(1);
    });
  });

  describe("Data Observability's last 7 days of schema changes", () => {
    test.each(moments.map(windowLabel))(
      "from %s, schema changes are counted from 7 x 24 hours back",
      async (iso: string) => {
        const now: Date = new Date(iso);
        pinNow(now);
        jest
          .spyOn(DataObservabilityAPI, "getStoreSummaries")
          .mockResolvedValue([]);
        jest
          .spyOn(
            DataObservabilityAPI as unknown as {
              readAssets: () => Promise<Array<unknown>>;
            },
            "readAssets",
          )
          .mockResolvedValue([]);
        const counted: jest.SpyInstance = jest
          .spyOn(DataAssetFeedService, "countBy")
          .mockResolvedValue(new PositiveNumber(0) as never);
        jest.spyOn(DataAssetFeedService, "findBy").mockResolvedValue([]);
        jest.spyOn(DataObservabilityAttentionReader, "read").mockResolvedValue({
          items: [],
          failingCheckCount: 0,
          checkCount: 0,
          pipelineCount: 0,
        } as never);
        jest
          .spyOn(DataObservabilityAttentionReader, "getOwnerCounts")
          .mockResolvedValue({ tableOwnerCount: 0, ownerRuleCount: 0 });
        const compared: jest.SpyInstance = jest.spyOn(
          QueryHelper,
          "greaterThanEqualTo",
        );

        await DataObservabilityAPI.getOverview(PROJECT);

        expect(counted).toHaveBeenCalledTimes(1);
        expect(
          datesComparedWith(compared).map((date: Date): number => {
            return now.getTime() - date.getTime();
          }),
        ).toEqual([SCHEMA_CHANGE_WINDOW_IN_DAYS * DAY_MS]);
      },
    );
  });

  describe("Data Security's fresh and kept findings", () => {
    test.each(moments.map(windowLabel))(
      "from %s, OneUptime AI reads the findings of the last 30 x 24 hours",
      async (iso: string) => {
        const now: Date = new Date(iso);
        pinNow(now);
        jest.spyOn(DataStoreFindingService, "findBy").mockResolvedValue([]);
        const compared: jest.SpyInstance = jest.spyOn(
          QueryHelper,
          "greaterThanEqualTo",
        );
        const issue: DataSecurityIssue = new DataSecurityIssue();
        issue.checkId = SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID;
        issue.dataStoreId = ObjectID.generate();

        await DataSecurityAiReads.readPlaces({ projectId: PROJECT, issue });

        expect(
          datesComparedWith(compared).map((date: Date): number => {
            return now.getTime() - date.getTime();
          }),
        ).toEqual([FINDING_FRESHNESS_IN_DAYS * DAY_MS]);
      },
    );

    test.each(moments.map(windowLabel))(
      "from %s, an evaluation counts the findings of the same 30 x 24 hours",
      async (iso: string) => {
        const now: Date = new Date(iso);
        jest.spyOn(DataStoreFindingService, "findBy").mockResolvedValue([]);
        const compared: jest.SpyInstance = jest.spyOn(
          QueryHelper,
          "greaterThanEqualTo",
        );

        await (
          DataSecurityEvaluator as unknown as {
            readFindings: (
              projectId: ObjectID,
              now: Date,
              facts: Map<string, unknown>,
              custom: Map<string, unknown>,
            ) => Promise<void>;
          }
        ).readFindings(PROJECT, now, new Map(), new Map());

        expect(
          datesComparedWith(compared).map((date: Date): number => {
            return now.getTime() - date.getTime();
          }),
        ).toEqual([FINDING_FRESHNESS_IN_DAYS * DAY_MS]);
      },
    );

    test.each(moments.map(windowLabel))(
      "from %s, a finding is kept until 90 x 24 hours after it was last seen, and not a minute more",
      async (iso: string) => {
        const now: Date = new Date(iso);
        const retentionMs: number = FINDING_RETENTION_IN_DAYS * DAY_MS;
        const kept: DataStoreFinding = new DataStoreFinding(
          ObjectID.generate(),
        );
        kept.lastSeenAt = new Date(now.getTime() - retentionMs);
        const pruned: DataStoreFinding = new DataStoreFinding(
          ObjectID.generate(),
        );
        pruned.lastSeenAt = new Date(now.getTime() - retentionMs - 1);
        jest
          .spyOn(DataStoreFindingService, "findBy")
          .mockResolvedValue([kept, pruned]);
        const deleted: jest.SpyInstance = jest
          .spyOn(DataStoreFindingService, "deleteOneById")
          .mockResolvedValue(undefined as never);

        await (
          DataSecurityFindingWriter as unknown as {
            pruneOldFindings: (id: ObjectID, now: Date) => Promise<void>;
          }
        ).pruneOldFindings(ObjectID.generate(), now);

        expect(
          deleted.mock.calls.map((call: Array<unknown>): string => {
            return (call[0] as { id: ObjectID }).id.toString();
          }),
        ).toEqual([pruned.id!.toString()]);
      },
    );
  });

  describe("Entity Risk forgets an entity quiet for 30 days", () => {
    test.each(moments.map(windowLabel))(
      "from %s, quiet means nothing added for 30 x 24 hours",
      async (iso: string) => {
        const now: Date = new Date(iso);
        jest
          .spyOn(SecurityEntityRiskService, "deleteBy")
          .mockResolvedValue(0 as never);
        const compared: jest.SpyInstance = jest.spyOn(QueryHelper, "lessThan");

        await SecurityEntityRiskRecorder.forgetQuietEntities(now);

        expect(
          datesComparedWith(compared).map((date: Date): number => {
            return now.getTime() - date.getTime();
          }),
        ).toEqual([ENTITY_RISK_HISTORY_IN_DAYS * DAY_MS]);
      },
    );
  });

  describe("the Security Events address vault names an address for 30 days", () => {
    test.each(moments.map(windowLabel))(
      "from %s, the oldest an address may have been seen and still be named is 30 x 24 hours ago",
      (iso: string) => {
        const now: Date = new Date(iso);

        expect(
          now.getTime() -
            SecurityAddressVaultService.getOldestNameableTime(now).getTime(),
        ).toBe(SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS * DAY_MS);
      },
    );
  });

  /*
   * The rest of the server's windows, retention dates, grace periods and
   * day counts are lengths of time too (issue #8473): about 120 calls in
   * its services, utils, ingest and workers stepped its own calendar.
   * DaysAsLengthsOfTimeGuard keeps them out; these read a few of them from
   * around each clock change.
   */
  describe("the server's retention dates, grace periods and day counts", () => {
    const RETENTION_DAYS: Array<number> = [1, 7, 15, 30, 90, 365];

    test.each(moments.map(windowLabel))(
      "from %s, a telemetry row's retention date is N x 24 hours on",
      (iso: string) => {
        const now: Date = new Date(iso);

        for (const days of RETENTION_DAYS) {
          const stamp: IngestionStamp = {
            date: now,
            db: OneUptimeDate.toClickhouseDateTime(now),
            epochSecond: Math.floor(now.getTime() / 1000),
            retentionDbByDays: new Map<number, string>(),
          } as unknown as IngestionStamp;

          expect(getRetentionDateDb(stamp, days)).toBe(
            OneUptimeDate.toClickhouseDateTime(
              new Date(now.getTime() + days * DAY_MS),
            ),
          );
        }
      },
    );

    test.each(moments.map(windowLabel))(
      "from %s, a session replay is kept N x 24 hours, and an old calendar feed link serves 7 x 24 hours more",
      (iso: string) => {
        const now: Date = new Date(iso);

        for (const days of RETENTION_DAYS) {
          expect(
            getSessionReplayRetentionDate({
              serverClampedSessionStart: now,
              retentionInDays: days,
            }).getTime(),
          ).toBe(now.getTime() + days * DAY_MS);
        }

        const rotation: CalendarFeedRotation = CalendarFeedToken.buildRotation({
          currentTokenHash: "a-hash",
          now,
        });

        expect(rotation.previousTokenExpiresAt!.getTime() - now.getTime()).toBe(
          PREVIOUS_TOKEN_GRACE_DAYS * DAY_MS,
        );
      },
    );

    test("whole days of time: 7 x 24 hours across each clock change are 7 days, a millisecond less 6", () => {
      for (const change of changes) {
        const from: Date = new Date(change.atMs - 3 * DAY_MS);
        const to: Date = new Date(from.getTime() + 7 * DAY_MS);

        expect(OneUptimeDate.getWholeDaysOfTimeBetween(from, to)).toBe(7);
        expect(
          OneUptimeDate.getWholeDaysOfTimeBetween(
            from,
            new Date(to.getTime() - 1),
          ),
        ).toBe(6);
        expect(OneUptimeDate.getWholeDaysOfTimeBetween(to, from)).toBe(-7);
      }

      for (const now of moments) {
        expect(OneUptimeDate.getWholeDaysOfTimeBetween(now, now)).toBe(0);
        expect(
          Object.is(OneUptimeDate.getWholeDaysOfTimeBetween(now, now), -0),
        ).toBe(false);
        expect(
          OneUptimeDate.getWholeDaysOfTimeBetween(
            now.toISOString(),
            new Date(now.getTime() + 36 * HOUR_MS).toISOString(),
          ),
        ).toBe(1);
      }
    });

    test("an event 7 x 24 hours old across a clock change is 7 days old, where the server's calendar said 6 when its clocks went back", () => {
      for (const change of changes) {
        const ingestedAt: Date = new Date(change.atMs + 2 * DAY_MS);
        const eventAt: Date = new Date(ingestedAt.getTime() - 7 * DAY_MS);
        const calendarDays: number = OneUptimeDate.getNumberOfDaysBetweenDates(
          eventAt,
          ingestedAt,
        );

        expect(
          OneUptimeDate.getWholeDaysOfTimeBetween(eventAt, ingestedAt),
        ).toBe(7);
        // Over a change back, 7 x 24 hours is less than 7 days there.
        expect(calendarDays).toBe(change.movedMinutes > 0 ? 7 : 6);
      }
    });
  });

  /*
   * The Data Security overview's issue trend is calendar days - the
   * reader's - wherever the server is: 30 bars, today's the last, the
   * first starting at the reader's midnight 29 days before today's, and
   * an issue counted when it is in one of them.
   */
  describe("Data Security's issue trend: the reader's last 30 days", () => {
    const READER_ZONES: Array<Timezone | undefined> = [
      undefined,
      Timezone.AmericaNew_York,
      Timezone.EuropeLondon,
      Timezone.AustraliaLord_Howe,
      Timezone.AsiaKathmandu,
      Timezone.PacificChatham,
    ];

    function issueAt(openedAtMs: number): DataSecurityIssue {
      const issue: DataSecurityIssue = new DataSecurityIssue(
        ObjectID.generate(),
      );
      issue.status = DataSecurityIssueStatus.Open;
      issue.severity = SecuritySeverity.High;
      issue.riskScore = 50;
      issue.firstDetectedAt = new Date(openedAtMs);
      return issue;
    }

    const CASES: Array<[string, string]> = moments.flatMap(
      (now: Date): Array<[string, string]> => {
        return READER_ZONES.map(
          (zone: Timezone | undefined): [string, string] => {
            return [now.toISOString(), zone || "no zone (UTC)"];
          },
        );
      },
    );

    test.each(CASES)(
      "from %s, read in %s",
      async (iso: string, zoneName: string) => {
        const now: Date = new Date(iso);
        const zone: Timezone | undefined = zoneName.startsWith("no zone")
          ? undefined
          : (zoneName as Timezone);
        const readerZone: string = zone || "UTC";
        const today: string = platformDay(now.getTime(), readerZone);
        const firstDay: string = dateBefore(today, 29);
        // Noon on the first day, whatever its zone: a moment of that day.
        const firstDayStartMs: number = platformStartOfDay(
          moment.tz(`${firstDay}T12:00:00`, readerZone).valueOf(),
          readerZone,
        );

        pinNow(now);
        jest.spyOn(DataStoreService, "findBy").mockResolvedValue([]);
        jest
          .spyOn(DataSecurityIssueService, "findBy")
          .mockResolvedValue([
            issueAt(firstDayStartMs - 1),
            issueAt(firstDayStartMs),
            issueAt(now.getTime()),
          ]);
        jest.spyOn(DataStoreFindingService, "findBy").mockResolvedValue([]);
        jest.spyOn(CloudConnectionService, "findBy").mockResolvedValue([]);

        const overview: DataSecurityOverview =
          await DataSecurityAPI.getOverview(PROJECT, zone);
        const trend: DataSecurityOverview["issueTrend"] = overview.issueTrend;

        expect(trend).toHaveLength(30);
        expect(trend[0]!.day).toBe(firstDay);
        expect(trend[29]!.day).toBe(today);
        // One bar a day, none twice, none skipped.
        for (let index: number = 1; index < trend.length; index++) {
          expect(dateBefore(trend[index]!.day, 1)).toBe(trend[index - 1]!.day);
        }
        // The issue a millisecond before the first day is not counted.
        expect(trend[0]!.opened).toBe(1);
        expect(trend[29]!.opened).toBe(1);
        expect(
          trend.reduce((sum: number, entry: { opened: number }): number => {
            return sum + entry.opened;
          }, 0),
        ).toBe(2);
      },
    );
  });
}
