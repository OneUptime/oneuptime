import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  MAX_COUNTED_WINDOW_IN_MINUTES,
  NoDataPolicy,
  PreviousCheckChangeType,
} from "../../../Types/Monitor/CriteriaFilter";
import CriteriaFilterValues from "../../../Types/Monitor/CriteriaFilterValues";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorStepsValuesUtil from "../../../Utils/Monitor/MonitorStepsValuesUtil";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The types behind #10821, a filter that compares a check with the one
 * before it: how its window is read, written, offered and refused.
 */

function slower(
  options: Partial<CriteriaFilter["evaluateOverTimeOptions"]> = {},
  filter: Partial<CriteriaFilter> = {},
): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: undefined,
    ...filter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      changeType: PreviousCheckChangeType.Percentage,
      changeValue: 50,
      ...options,
    } as CriteriaFilter["evaluateOverTimeOptions"],
  };
}

function criteriaWith(filters: Array<CriteriaFilter>): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "slower",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: filters,
    incidents: [],
    alerts: [],
    name: "Slower than the last check",
    description: "",
  };
  return instance;
}

function roundTrip(instance: MonitorCriteriaInstance): MonitorCriteriaInstance {
  return MonitorCriteriaInstance.fromJSON(
    JSON.parse(JSON.stringify(instance.toJSON())) as JSONObject,
  );
}

function stepsWith(criteria: MonitorCriteriaInstance): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: ObjectID.generate().toString(),
            monitorDestination: "https://shop.example.com",
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [criteria.toJSON()],
              },
            },
          },
        },
      ],
      defaultMonitorStatusId: ObjectID.generate().toString(),
    },
  };
}

describe("a previous check, written and read back", () => {
  test("its change survives the JSON the API and Terraform write", () => {
    const filter: CriteriaFilter = roundTrip(criteriaWith([slower()])).data!
      .filters[0]!;

    expect(filter.evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      changeType: PreviousCheckChangeType.Percentage,
      changeValue: 50,
    });
  });

  test.each([
    ["Previous Check", EvaluateOverTimeType.PreviousCheck],
    ["previous_check", EvaluateOverTimeType.PreviousCheck],
    ["PreviousCheck", EvaluateOverTimeType.PreviousCheck],
  ])(
    "the window type %s is read as Previous Check",
    (written: string, read: EvaluateOverTimeType) => {
      expect(CriteriaFilterValues.readEvaluateOverTimeType(written)).toBe(read);
    },
  );

  test.each([
    ["Amount", PreviousCheckChangeType.Amount],
    ["amount", PreviousCheckChangeType.Amount],
    ["Percentage", PreviousCheckChangeType.Percentage],
    ["percent", PreviousCheckChangeType.Percentage],
    ["%", PreviousCheckChangeType.Percentage],
  ])(
    "the change type %s is read as %s",
    (written: string, read: PreviousCheckChangeType) => {
      expect(CriteriaFilterValues.readPreviousCheckChangeType(written)).toBe(
        read,
      );

      const filter: JSONObject = CriteriaFilterValues.readFilter(
        slower({ changeType: written as PreviousCheckChangeType }) as never,
      );

      expect(
        (filter["evaluateOverTimeOptions"] as JSONObject)["changeType"],
      ).toBe(read);
    },
  );

  test("a change written as its digits is stored as a number", () => {
    const filter: JSONObject = CriteriaFilterValues.readFilter(
      slower({ changeValue: "12.5" as unknown as number }) as never,
    );

    expect(
      (filter["evaluateOverTimeOptions"] as JSONObject)["changeValue"],
    ).toBe(12.5);
  });

  test("a measured value compared with the previous check needs no value of its own", () => {
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith([slower()]),
        MonitorType.Website,
      ),
    ).toBeNull();
  });

  test("a body compared with the previous check still needs the text it looks for", () => {
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith([
          slower(
            { changeType: undefined, changeValue: undefined },
            {
              checkOn: CheckOn.ResponseBody,
              filterType: FilterType.Contains,
              value: undefined,
            },
          ),
        ]),
        MonitorType.Website,
      ),
    ).toContain("Value is required");
  });

  test("the same filter with no window needs its value, as any filter does", () => {
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith([{ ...slower(), evaluateOverTime: false }]),
        MonitorType.Website,
      ),
    ).toContain("Value is required");
  });
});

describe("a previous check that no check can read is refused", () => {
  test("without a window: how long ago the previous check may be", () => {
    expect(
      MonitorCriteriaInstance.getWindowValidationError({
        filter: slower({ timeValueInMinutes: 0 }),
        where: 'criteria "Slower"',
        monitorType: MonitorType.Website,
      }),
    ).toBe(
      'Previous Check of criteria "Slower" on filter type Response Time (in ms) needs a window: how many minutes ago the previous check may be.',
    );
  });

  test("looking back more than a week", () => {
    expect(
      MonitorCriteriaInstance.getWindowValidationError({
        filter: slower({
          timeValueInMinutes: MAX_COUNTED_WINDOW_IN_MINUTES + 1,
        }),
        where: 'criteria "Slower"',
        monitorType: MonitorType.Website,
      }),
    ).toContain("looks back at most 10080 minutes (7 days)");

    expect(
      MonitorCriteriaInstance.getWindowValidationError({
        filter: slower({ timeValueInMinutes: MAX_COUNTED_WINDOW_IN_MINUTES }),
        where: 'criteria "Slower"',
        monitorType: MonitorType.Website,
      }),
    ).toBeNull();
  });

  test("a measured value compared by text", () => {
    expect(
      MonitorCriteriaInstance.getWindowValidationError({
        filter: slower({}, { filterType: FilterType.Contains }),
        where: 'criteria "Slower"',
        monitorType: MonitorType.Website,
      }),
    ).toBe(
      'Previous Check of criteria "Slower" on filter type Response Time (in ms) compares a number with the previous check\'s, with Greater Than, Greater Than Or Equal To, Less Than, Less Than Or Equal To, Equal To or Not Equal To, not Contains.',
    );
  });

  test.each([-1, "-5", "lots", Infinity])(
    "a change of %s",
    (changeValue: unknown) => {
      expect(
        MonitorCriteriaInstance.getWindowValidationError({
          filter: slower({ changeValue: changeValue as number }),
          where: 'criteria "Slower"',
          monitorType: MonitorType.Website,
        }),
      ).toBe(
        'Previous Check of criteria "Slower" on filter type Response Time (in ms) needs a change of 0 or more: how far above or below the previous check this one must be.',
      );
    },
  );

  test("a change of 0, or none, is any rise", () => {
    for (const changeValue of [0, undefined]) {
      expect(
        MonitorCriteriaInstance.getWindowValidationError({
          filter: slower({ changeValue: changeValue }),
          where: 'criteria "Slower"',
          monitorType: MonitorType.Website,
        }),
      ).toBeNull();
    }
  });

  test("a yes or no check takes no change, and is never refused for one", () => {
    expect(
      MonitorCriteriaInstance.getWindowValidationError({
        filter: slower(
          { changeValue: -1 },
          { checkOn: CheckOn.IsOnline, filterType: FilterType.False },
        ),
        where: 'criteria "Went down"',
        monitorType: MonitorType.Ping,
      }),
    ).toBeNull();
  });

  test("the server refuses a change type that means none", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Website,
        monitorSteps: stepsWith(
          criteriaWith([
            slower({ changeType: "lots" as PreviousCheckChangeType }),
          ]),
        ),
      }),
    ).toBe(
      'Criteria "Slower than the last check": filters[0].evaluateOverTimeOptions.changeType "lots" is not a value OneUptime reads there. Use one of "Amount" or "Percentage".',
    );
  });

  test("the server refuses a negative change on write", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Website,
        monitorSteps: stepsWith(criteriaWith([slower({ changeValue: -10 })])),
      }),
    ).toContain("needs a change of 0 or more");
  });

  test("the server takes a previous check as it is written", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Website,
        monitorSteps: stepsWith(
          criteriaWith([
            slower({ onNoDataPolicy: NoDataPolicy.TreatAsZero }),
            slower(
              { changeType: undefined, changeValue: undefined },
              {
                checkOn: CheckOn.ResponseBody,
                filterType: FilterType.Contains,
                value: "Maintenance",
              },
            ),
          ]),
        ),
      }),
    ).toBeNull();
  });
});

describe("where a previous check is offered", () => {
  test.each([
    [CheckOn.ResponseTime, MonitorType.Website, true],
    [CheckOn.ResponseStatusCode, MonitorType.API, true],
    [CheckOn.ResponseBody, MonitorType.Website, true],
    [CheckOn.JavaScriptExpression, MonitorType.API, true],
    [CheckOn.IsOnline, MonitorType.Ping, true],
    [CheckOn.PacketLossPercent, MonitorType.IP, true],
    [CheckOn.PortTcpConnectTime, MonitorType.Port, true],
    [CheckOn.CPUUsagePercent, MonitorType.Server, true],
    [CheckOn.DiskUsagePercent, MonitorType.Server, true],
    [CheckOn.SnmpResponseTime, MonitorType.NetworkDevice, true],
    [CheckOn.DnsResponseTime, MonitorType.DNS, true],
    [CheckOn.NtpClockOffset, MonitorType.NTP, true],
    [CheckOn.DatabaseMetric, MonitorType.Database, true],
    [
      CheckOn.ExternalStatusPageResponseTime,
      MonitorType.ExternalStatusPage,
      true,
    ],
    [CheckOn.DisconnectedProbes, MonitorType.ProbeStatus, true],
    // An agent that stops reporting writes nothing to compare.
    [CheckOn.IsOnline, MonitorType.Server, false],
    // Certificates and domains are judged on their latest check.
    [CheckOn.ExpiresInDays, MonitorType.SSLCertificate, false],
    // Receivers have no checks at a cadence.
    [CheckOn.IncomingRequest, MonitorType.IncomingRequest, false],
    [CheckOn.EmailSubject, MonitorType.IncomingEmail, false],
  ])(
    "%s on a %s monitor: %s",
    (checkOn: CheckOn, monitorType: MonitorType, isOffered: boolean) => {
      expect(
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
          { checkOn: checkOn, filterType: undefined, value: undefined },
          monitorType,
        ).includes(EvaluateOverTimeType.PreviousCheck),
      ).toBe(isOffered);
    },
  );
});
