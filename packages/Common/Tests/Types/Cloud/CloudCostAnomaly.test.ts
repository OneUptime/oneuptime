import { describe, expect, test } from "@jest/globals";
import {
  CloudAccountCostSummary,
  CloudCostAnomaly,
  CloudCostState,
  addUtcDays,
  fromCloudCostDay,
  readCloudAccountCostSummary,
  readCloudCostAnomaly,
  toCloudCostDay,
} from "../../../Types/Cloud/CloudCost";
import {
  CLOUD_COST_ANOMALIES_KEPT,
  CLOUD_COST_ANOMALIES_PER_DAY,
  CLOUD_COST_ANOMALY_BASELINE_DAYS,
  CLOUD_COST_ANOMALY_DAYS_JUDGED,
  CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS,
  findCloudCostAnomalies,
  findCloudCostDayAnomalies,
  getCloudCostAnomalyDay,
  getCloudCostAnomalyIncrease,
  getCloudCostAnomalyRatio,
  getCloudCostMedian,
  getStartedCloudCostAnomalies,
  groupCloudCostAnomaliesByDay,
} from "../../../Types/Cloud/CloudCostAnomaly";

/*
 * A day that cost far more than usual: each of an account's last full days
 * held to the 14 days before it - a service at twice its usual day, the
 * whole account at half again, never a few cents, never a new account -
 * and how a budget and Costs read them back: by day, a spike told the day
 * it began.
 */

type ServiceCosts = Record<string, number>;

// "2026-11-05" .. "2026-11-18", both ends in.
function daysFrom(first: string, last: string): Array<string> {
  const days: Array<string> = [];

  for (
    let day: Date = fromCloudCostDay(first);
    toCloudCostDay(day) <= last;
    day = addUtcDays(day, 1)
  ) {
    days.push(toCloudCostDay(day));
  }

  return days;
}

// The same services' costs on each of a run of days.
function steady(
  first: string,
  last: string,
  services: ServiceCosts,
): Record<string, ServiceCosts> {
  const days: Record<string, ServiceCosts> = {};

  for (const day of daysFrom(first, last)) {
    days[day] = { ...services };
  }

  return days;
}

function totals(
  days: Record<string, ServiceCosts>,
): Map<string, Map<string, number>> {
  return new Map(
    Object.entries(days).map(
      ([day, services]: [string, ServiceCosts]): [
        string,
        Map<string, number>,
      ] => {
        return [day, new Map(Object.entries(services))];
      },
    ),
  );
}

// An account's usual 14 days before 2026-11-19: $130 a day.
const USUAL: ServiceCosts = {
  "Amazon EC2": 100,
  "Amazon S3": 20,
  "AWS Lambda": 10,
};
const BASELINE: Record<string, ServiceCosts> = steady(
  "2026-11-05",
  "2026-11-18",
  USUAL,
);

function judge(day: ServiceCosts): Array<CloudCostAnomaly> {
  return findCloudCostDayAnomalies({
    dailyServiceTotals: totals({ ...BASELINE, "2026-11-19": day }),
    day: "2026-11-19",
  });
}

describe("a day's usual", () => {
  test("is the median: one spike among the days moves it little", () => {
    expect(getCloudCostMedian([3, 1, 2])).toBe(2);
    expect(getCloudCostMedian([1, 2, 3, 1000])).toBe(2.5);
    expect(getCloudCostMedian([])).toBe(0);
    expect(getCloudCostMedian([Number.NaN, 4])).toBe(4);
  });

  test("the newest day judged is the full day before the newest one read", () => {
    expect(getCloudCostAnomalyDay("2026-11-20")).toBe("2026-11-19");
    expect(getCloudCostAnomalyDay("2026-12-01")).toBe("2026-11-30");
    expect(getCloudCostAnomalyDay("2027-01-01")).toBe("2026-12-31");
    expect(getCloudCostAnomalyDay("2028-03-01")).toBe("2028-02-29");
    expect(getCloudCostAnomalyDay(undefined)).toBeUndefined();
    expect(getCloudCostAnomalyDay("")).toBeUndefined();
    expect(getCloudCostAnomalyDay("not a day")).toBeUndefined();
  });

  test("how many times its usual, and how far above it", () => {
    const anomaly: CloudCostAnomaly = {
      day: "2026-11-19",
      service: "AWS Lambda",
      amount: 412,
      usual: 180,
    };
    expect(getCloudCostAnomalyRatio(anomaly)).toBeCloseTo(2.289, 3);
    expect(getCloudCostAnomalyIncrease(anomaly)).toBe(232);
    expect(getCloudCostAnomalyRatio({ ...anomaly, usual: 0 })).toBe(Infinity);
  });
});

describe("one day, held to the 14 before it", () => {
  test("a usual day is nothing", () => {
    expect(judge(USUAL)).toEqual([]);
  });

  test("a service at twice its usual day is unusual; one just under is not", () => {
    expect(
      judge({ "Amazon EC2": 100, "Amazon S3": 40, "AWS Lambda": 19.9 }),
    ).toEqual([
      { day: "2026-11-19", service: "Amazon S3", amount: 40, usual: 20 },
    ]);
  });

  test("a few cents more are never a spike: at least 10 more than usual", () => {
    expect(
      judge({ ...USUAL, "AWS Lambda": 19.99, "Amazon CloudWatch": 9.99 }),
    ).toEqual([]);
    expect(judge({ ...USUAL, "Amazon CloudWatch": 10 })).toEqual([
      { day: "2026-11-19", service: "Amazon CloudWatch", amount: 10, usual: 0 },
    ]);
  });

  test("in a large account, at least 5% of its usual day more", () => {
    const large: Record<string, ServiceCosts> = steady(
      "2026-11-05",
      "2026-11-18",
      { "Amazon EC2": 1000, "Amazon S3": 50 },
    );
    const judgeLarge: (s3: number) => Array<CloudCostAnomaly> = (
      s3: number,
    ): Array<CloudCostAnomaly> => {
      return findCloudCostDayAnomalies({
        dailyServiceTotals: totals({
          ...large,
          "2026-11-19": { "Amazon EC2": 1000, "Amazon S3": s3 },
        }),
        day: "2026-11-19",
      });
    };

    // Twice its usual, but $50 more is under 5% of $1,050.
    expect(judgeLarge(100)).toEqual([]);
    expect(judgeLarge(110)).toEqual([
      { day: "2026-11-19", service: "Amazon S3", amount: 110, usual: 50 },
    ]);
  });

  test("the whole account at half again its usual: its own line first, then its services by how far above usual", () => {
    expect(
      judge({ "Amazon EC2": 200, "Amazon S3": 45, "AWS Lambda": 10 }),
    ).toEqual([
      { day: "2026-11-19", service: "", amount: 255, usual: 130 },
      { day: "2026-11-19", service: "Amazon EC2", amount: 200, usual: 100 },
      { day: "2026-11-19", service: "Amazon S3", amount: 45, usual: 20 },
    ]);

    // Spread over services, none twice its usual: the account alone.
    expect(
      judge({ "Amazon EC2": 160, "Amazon S3": 30, "AWS Lambda": 15 }),
    ).toEqual([{ day: "2026-11-19", service: "", amount: 205, usual: 130 }]);

    // Just under half again.
    expect(
      judge({ "Amazon EC2": 160, "Amazon S3": 20, "AWS Lambda": 10 }),
    ).toEqual([]);
  });

  test("a service new to the account is unusual: it usually costs nothing", () => {
    expect(judge({ ...USUAL, "AWS Glue": 40 })).toEqual([
      { day: "2026-11-19", service: "AWS Glue", amount: 40, usual: 0 },
    ]);
  });

  test("a service that costs on some days only: its usual counts the days without as zeros", () => {
    const weekdays: Record<string, ServiceCosts> = {};

    for (const day of daysFrom("2026-11-05", "2026-11-18")) {
      const weekday: number = fromCloudCostDay(day).getUTCDay();
      weekdays[day] = {
        ...USUAL,
        "AWS Batch": weekday === 0 || weekday === 6 ? 0 : 50,
      };
    }

    // Ten weekdays at $50 among the 14: its usual is $50.
    const judgeBatch: (batch: number) => Array<CloudCostAnomaly> = (
      batch: number,
    ): Array<CloudCostAnomaly> => {
      return findCloudCostDayAnomalies({
        dailyServiceTotals: totals({
          ...weekdays,
          "2026-11-19": { ...USUAL, "AWS Batch": batch },
        }),
        day: "2026-11-19",
      });
    };

    expect(judgeBatch(50)).toEqual([]);
    expect(judgeBatch(120)).toEqual([
      { day: "2026-11-19", service: "AWS Batch", amount: 120, usual: 50 },
    ]);
  });

  test("one spike among the 14 leaves the usual where it was", () => {
    expect(
      findCloudCostDayAnomalies({
        dailyServiceTotals: totals({
          ...BASELINE,
          "2026-11-10": { ...USUAL, "Amazon EC2": 1000 },
          "2026-11-19": { ...USUAL, "Amazon EC2": 210 },
        }),
        day: "2026-11-19",
      }),
    ).toEqual([
      { day: "2026-11-19", service: "", amount: 240, usual: 130 },
      { day: "2026-11-19", service: "Amazon EC2", amount: 210, usual: 100 },
    ]);
  });

  test(`a new account is never judged: ${CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS} days since its first cost first, and the days before it are not zeros`, () => {
    const judgeAfter: (days: number) => Array<CloudCostAnomaly> = (
      days: number,
    ): Array<CloudCostAnomaly> => {
      const history: Record<string, ServiceCosts> = steady(
        toCloudCostDay(addUtcDays(fromCloudCostDay("2026-11-19"), -days)),
        "2026-11-18",
        USUAL,
      );

      return findCloudCostDayAnomalies({
        dailyServiceTotals: totals({
          ...history,
          "2026-11-19": { ...USUAL, "Amazon EC2": 500 },
        }),
        day: "2026-11-19",
      });
    };

    const spike: Array<CloudCostAnomaly> = [
      { day: "2026-11-19", service: "", amount: 530, usual: 130 },
      { day: "2026-11-19", service: "Amazon EC2", amount: 500, usual: 100 },
    ];

    expect(judgeAfter(CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS - 1)).toEqual([]);
    // Its usual is of the 7 days it has had costs: the rest are not zeros.
    expect(judgeAfter(CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS)).toEqual(spike);
    expect(judgeAfter(10)).toEqual(spike);
    expect(judgeAfter(CLOUD_COST_ANOMALY_BASELINE_DAYS)).toEqual(spike);
  });

  test("a day with no cost since the account's first is a zero", () => {
    expect(
      findCloudCostDayAnomalies({
        dailyServiceTotals: totals({
          ...BASELINE,
          // Eight days of the 14 cost nothing: the usual day is nothing.
          ...steady("2026-11-06", "2026-11-13", { "Amazon EC2": 0 }),
          "2026-11-19": USUAL,
        }),
        day: "2026-11-19",
      }),
    ).toEqual([
      { day: "2026-11-19", service: "", amount: 130, usual: 0 },
      { day: "2026-11-19", service: "Amazon EC2", amount: 100, usual: 0 },
      { day: "2026-11-19", service: "Amazon S3", amount: 20, usual: 0 },
      { day: "2026-11-19", service: "AWS Lambda", amount: 10, usual: 0 },
    ]);
  });

  test(`at most ${CLOUD_COST_ANOMALIES_PER_DAY} of a day, the account's line among them`, () => {
    const found: Array<CloudCostAnomaly> = judge({
      ...USUAL,
      "Service A": 60,
      "Service B": 50,
      "Service C": 40,
      "Service D": 30,
      "Service E": 20,
    });

    expect(found).toHaveLength(CLOUD_COST_ANOMALIES_PER_DAY);
    expect(
      found.map((anomaly: CloudCostAnomaly): string => {
        return anomaly.service;
      }),
    ).toEqual(["", "Service A", "Service B", "Service C", "Service D"]);
  });

  test("a day that is not a day judges nothing", () => {
    expect(
      findCloudCostDayAnomalies({
        dailyServiceTotals: totals(BASELINE),
        day: "someday",
      }),
    ).toEqual([]);
  });
});

describe("an account's last full days", () => {
  // Read through 2026-11-20: the 19th is the newest full day.
  const READ: Record<string, ServiceCosts> = steady(
    "2026-10-01",
    "2026-11-20",
    USUAL,
  );

  test("each full day, newest first; the newest day read, late and in part, never", () => {
    const found: Array<CloudCostAnomaly> = findCloudCostAnomalies({
      dailyServiceTotals: totals({
        ...READ,
        "2026-11-20": { ...USUAL, "AWS Lambda": 400 },
        "2026-11-19": { ...USUAL, "Amazon S3": 60 },
        "2026-11-16": { ...USUAL, "AWS Lambda": 40 },
      }),
      latestDay: "2026-11-20",
    });

    expect(found).toEqual([
      { day: "2026-11-19", service: "Amazon S3", amount: 60, usual: 20 },
      { day: "2026-11-16", service: "AWS Lambda", amount: 40, usual: 10 },
    ]);
  });

  test(`the last ${CLOUD_COST_ANOMALY_DAYS_JUDGED} full days, or as many as asked`, () => {
    const spikes: Record<string, ServiceCosts> = { ...READ };

    // A new service each of the last 20 full days.
    for (const day of daysFrom("2026-10-31", "2026-11-19")) {
      spikes[day] = { ...USUAL, [`New on ${day}`]: 15 };
    }

    const all: Array<CloudCostAnomaly> = findCloudCostAnomalies({
      dailyServiceTotals: totals(spikes),
      latestDay: "2026-11-20",
    });

    expect(all).toHaveLength(CLOUD_COST_ANOMALY_DAYS_JUDGED);
    expect(all[0]!.day).toBe("2026-11-19");
    expect(all[all.length - 1]!.day).toBe("2026-11-06");

    expect(
      findCloudCostAnomalies({
        dailyServiceTotals: totals(spikes),
        latestDay: "2026-11-20",
        days: 1,
      }),
    ).toEqual([
      { day: "2026-11-19", service: "New on 2026-11-19", amount: 15, usual: 0 },
    ]);
  });

  test("a day whose 14 reach before the costs read is judged on the days read: a day not read is not a zero", () => {
    // Read from the 1st only: the 10th's usual is of the nine days before it.
    expect(
      findCloudCostAnomalies({
        dailyServiceTotals: totals({
          ...steady("2026-11-01", "2026-11-20", USUAL),
          "2026-11-10": { ...USUAL, "Amazon S3": 60 },
        }),
        latestDay: "2026-11-20",
      }),
    ).toEqual([
      { day: "2026-11-10", service: "Amazon S3", amount: 60, usual: 20 },
    ]);
  });

  test(`at most ${CLOUD_COST_ANOMALIES_KEPT} in all`, () => {
    const spikes: Record<string, ServiceCosts> = { ...READ };

    for (const day of daysFrom("2026-11-06", "2026-11-19")) {
      spikes[day] = {
        ...USUAL,
        [`A on ${day}`]: 30,
        [`B on ${day}`]: 20,
      };
    }

    expect(
      findCloudCostAnomalies({
        dailyServiceTotals: totals(spikes),
        latestDay: "2026-11-20",
      }),
    ).toHaveLength(CLOUD_COST_ANOMALIES_KEPT);
  });

  test("nothing read is nothing judged", () => {
    expect(
      findCloudCostAnomalies({
        dailyServiceTotals: new Map(),
        latestDay: undefined,
      }),
    ).toEqual([]);
    expect(
      findCloudCostAnomalies({
        dailyServiceTotals: new Map(),
        latestDay: "2026-11-20",
      }),
    ).toEqual([]);
  });
});

describe("by day, and a spike told the day it began", () => {
  const ec2: (day: string) => CloudCostAnomaly = (
    day: string,
  ): CloudCostAnomaly => {
    return { day, service: "Amazon EC2", amount: 300, usual: 100 };
  };
  const whole: (day: string) => CloudCostAnomaly = (
    day: string,
  ): CloudCostAnomaly => {
    return { day, service: "", amount: 400, usual: 200 };
  };
  const glue: CloudCostAnomaly = {
    day: "2026-11-19",
    service: "AWS Glue",
    amount: 40,
    usual: 0,
  };

  test("grouped by day, newest first, each day's in its order", () => {
    expect(
      groupCloudCostAnomaliesByDay([
        ec2("2026-11-17"),
        whole("2026-11-19"),
        glue,
        ec2("2026-11-18"),
      ]),
    ).toEqual([
      { day: "2026-11-19", anomalies: [whole("2026-11-19"), glue] },
      { day: "2026-11-18", anomalies: [ec2("2026-11-18")] },
      { day: "2026-11-17", anomalies: [ec2("2026-11-17")] },
    ]);
    expect(groupCloudCostAnomaliesByDay([])).toEqual([]);
  });

  test("a spike that goes on is told the day it began; what began on a later day is told that day", () => {
    expect(
      getStartedCloudCostAnomalies(
        groupCloudCostAnomaliesByDay([
          whole("2026-11-19"),
          glue,
          ec2("2026-11-19"),
          whole("2026-11-18"),
          ec2("2026-11-18"),
          ec2("2026-11-17"),
        ]),
      ),
    ).toEqual([
      { day: "2026-11-19", anomalies: [glue] },
      { day: "2026-11-18", anomalies: [whole("2026-11-18")] },
      { day: "2026-11-17", anomalies: [ec2("2026-11-17")] },
    ]);
  });

  test("a spike back after a usual day began again", () => {
    expect(
      getStartedCloudCostAnomalies(
        groupCloudCostAnomaliesByDay([ec2("2026-11-17"), ec2("2026-11-15")]),
      ),
    ).toEqual([
      { day: "2026-11-17", anomalies: [ec2("2026-11-17")] },
      { day: "2026-11-15", anomalies: [ec2("2026-11-15")] },
    ]);
  });

  test("across a month's end", () => {
    expect(
      getStartedCloudCostAnomalies(
        groupCloudCostAnomaliesByDay([ec2("2026-12-01"), ec2("2026-11-30")]),
      ),
    ).toEqual([{ day: "2026-11-30", anomalies: [ec2("2026-11-30")] }]);
  });
});

describe("as stored on an account's summary", () => {
  test("an unusual day read back; a malformed one is none", () => {
    expect(
      readCloudCostAnomaly({
        day: "2026-11-19",
        service: "AWS Lambda",
        amount: 412,
        usual: 180,
      }),
    ).toEqual({
      day: "2026-11-19",
      service: "AWS Lambda",
      amount: 412,
      usual: 180,
    });
    // The account as a whole has no service; numbers written as text read.
    expect(
      readCloudCostAnomaly({ day: "2026-11-19", amount: "255", usual: "130" }),
    ).toEqual({ day: "2026-11-19", service: "", amount: 255, usual: 130 });

    for (const malformed of [
      null,
      "2026-11-19",
      [],
      { day: "19 November", amount: 1, usual: 0 },
      { day: "2026-11-19T00:00:00Z", amount: 1, usual: 0 },
      { day: "2026-11-19", amount: 0, usual: 0 },
      { day: "2026-11-19", amount: -5, usual: 0 },
      { day: "2026-11-19", amount: 5, usual: -1 },
      { day: "2026-11-19", amount: "lots", usual: 1 },
      { amount: 5, usual: 1 },
    ]) {
      expect(readCloudCostAnomaly(malformed)).toBeNull();
    }
  });

  test("a summary keeps its unusual days and drops what it cannot read; one stored before them has none", () => {
    const stored: Record<string, unknown> = {
      state: CloudCostState.Reading,
      currency: "USD",
      monthToDate: 100,
      lastMonth: 0,
      monthFullDays: 0,
      lastMonthToDate: 0,
      projectedMonth: 0,
      last30Days: 0,
      topServices: [],
      latestDay: "2026-11-20",
      readAt: "2026-11-20T06:00:00.000Z",
    };

    const read: CloudAccountCostSummary | null = readCloudAccountCostSummary({
      ...stored,
      anomalies: [
        { day: "2026-11-19", service: "AWS Lambda", amount: 412, usual: 180 },
        { day: "bad" },
        "text",
      ],
    });
    expect(read?.anomalies).toEqual([
      { day: "2026-11-19", service: "AWS Lambda", amount: 412, usual: 180 },
    ]);

    expect(readCloudAccountCostSummary(stored)?.anomalies).toBeUndefined();
  });
});
