import CriteriaNameUtil, {
  MonitorStepsNamingResult,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import MonitorCriteriaAlignmentUtil, {
  CriteriaSeedOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaAlignment";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../Types/ObjectID";

/*
 * Names made from a criteria's filters (CriteriaNameUtil).
 *
 * Every criteria used to open on two required, empty inputs - a name and a
 * description - and a monitor could not be saved until someone had made up
 * prose for both. The description is optional now, and the name is filled
 * in from the filters: "Add Criteria" names a new criteria after its filter,
 * and the name follows the filters until the user types their own.
 *
 * These pin what a name says for each kind of filter, when a name counts as
 * generated (and so follows the filters) and when it is the user's.
 */

function filter(data: Partial<CriteriaFilter>): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: undefined,
    ...data,
  };
}

const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const SEED_OPTIONS: CriteriaSeedOptions = {
  onlineMonitorStatusId: ONLINE_STATUS_ID,
  offlineMonitorStatusId: OFFLINE_STATUS_ID,
  defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
  defaultAlertSeverityId: ALERT_SEVERITY_ID,
  monitorName: "Acme",
};

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

function criteriaWith(data: {
  name: string;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.name = data.name;
  instance.data!.filters = data.filters;
  instance.data!.filterCondition = data.filterCondition || FilterCondition.All;
  return instance;
}

function stepsWith(instances: Array<MonitorCriteriaInstance>): MonitorSteps {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: instances };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.setMonitorCriteria(monitorCriteria);

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray([monitorStep]);
  monitorSteps.setDefaultMonitorStatusId(ONLINE_STATUS_ID);

  return monitorSteps;
}

function namesIn(monitorSteps: MonitorSteps): Array<string> {
  return (monitorSteps.data?.monitorStepsInstanceArray || []).flatMap(
    (monitorStep: MonitorStep) => {
      return (
        monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray ||
        []
      ).map((instance: MonitorCriteriaInstance) => {
        return instance.data!.name;
      });
    },
  );
}

describe("CriteriaNameUtil.describeFilter - one filter as a phrase", () => {
  test.each([
    [FilterType.EqualTo, "200", "Response Status Code is 200"],
    [FilterType.NotEqualTo, "200", "Response Status Code is not 200"],
    [FilterType.GreaterThan, "499", "Response Status Code is above 499"],
    [FilterType.LessThan, "200", "Response Status Code is below 200"],
    [
      FilterType.GreaterThanOrEqualTo,
      "400",
      "Response Status Code is at least 400",
    ],
    [
      FilterType.LessThanOrEqualTo,
      "399",
      "Response Status Code is at most 399",
    ],
  ])(
    "a status code compared with %s reads as a comparison",
    (filterType: FilterType, value: string, expected: string) => {
      expect(
        CriteriaNameUtil.describeFilter(
          filter({
            checkOn: CheckOn.ResponseStatusCode,
            filterType: filterType,
            value: value,
          }),
        ),
      ).toBe(expected);
    },
  );

  test("a number value stays a number, whatever type it is stored as", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({ checkOn: CheckOn.ResponseTime, value: 3000 }),
      ),
    ).toBe("Response Time (in ms) is above 3000");
  });

  test.each([
    [FilterType.Contains, 'Response Body contains "error"'],
    [FilterType.NotContains, 'Response Body does not contain "error"'],
    [FilterType.StartsWith, 'Response Body starts with "error"'],
    [FilterType.EndsWith, 'Response Body ends with "error"'],
    [FilterType.EqualTo, 'Response Body is "error"'],
  ])(
    "text compared with %s is quoted, so it cannot run into the words around it",
    (filterType: FilterType, expected: string) => {
      expect(
        CriteriaNameUtil.describeFilter(
          filter({
            checkOn: CheckOn.ResponseBody,
            filterType: filterType,
            value: "error",
          }),
        ),
      ).toBe(expected);
    },
  );

  test.each([
    [CheckOn.IsOnline, FilterType.True, "Is Online is true"],
    [CheckOn.IsOnline, FilterType.False, "Is Online is false"],
    [CheckOn.DomainIsExpired, FilterType.True, "Domain Is Expired is true"],
    [CheckOn.Error, FilterType.IsEmpty, "Error is empty"],
    [CheckOn.Error, FilterType.IsNotEmpty, "Error is not empty"],
  ])(
    "%s %s needs no value",
    (checkOn: CheckOn, filterType: FilterType, expected: string) => {
      expect(
        CriteriaNameUtil.describeFilter(
          filter({ checkOn: checkOn, filterType: filterType }),
        ),
      ).toBe(expected);
    },
  );

  test("a heartbeat window says how long", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.IncomingRequest,
          filterType: FilterType.NotRecievedInMinutes,
          value: 5,
        }),
      ),
    ).toBe("Incoming Request not received for 5 minutes");

    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.IncomingRequest,
          filterType: FilterType.RecievedInMinutes,
          value: 5,
        }),
      ),
    ).toBe("Incoming Request received within 5 minutes");
  });

  test("an email heartbeat does not say 'received' twice", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.EmailReceivedAt,
          filterType: FilterType.NotRecievedInMinutes,
          value: 10,
        }),
      ),
    ).toBe("Email not received for 10 minutes");
  });

  test("a JavaScript expression is not copied into the name", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.JavaScriptExpression,
          filterType: FilterType.EvaluatesToTrue,
          value: "{{responseBody.status}} === 'down'",
        }),
      ),
    ).toBe("JavaScript Expression evaluates to true");
  });

  test("a process check names the process", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsNotExecuting,
          value: "nginx",
        }),
      ),
    ).toBe('Server Process Name "nginx" is not executing');

    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.ServerProcessPID,
          filterType: FilterType.IsExecuting,
          value: 4242,
        }),
      ),
    ).toBe("Server Process PID 4242 is executing");
  });

  test.each([
    [FilterType.AnomalouslyHigh, "Log Count is anomalously high"],
    [FilterType.AnomalouslyLow, "Log Count is anomalously low"],
    [FilterType.Anomalous, "Log Count is anomalous"],
  ])(
    "an anomaly condition (%s) needs no threshold",
    (filterType: FilterType, expected: string) => {
      expect(
        CriteriaNameUtil.describeFilter(
          filter({ checkOn: CheckOn.LogCount, filterType: filterType }),
        ),
      ).toBe(expected);
    },
  );

  test("a threshold not typed in yet shows as an ellipsis, not as nothing", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({ checkOn: CheckOn.ResponseTime, value: "" }),
      ),
    ).toBe("Response Time (in ms) is above …");

    expect(
      CriteriaNameUtil.describeFilter(
        filter({ checkOn: CheckOn.ResponseTime, value: undefined }),
      ),
    ).toBe("Response Time (in ms) is above …");
  });

  test("a filter with no condition yet is named by its check alone", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({ checkOn: CheckOn.ResponseTime, filterType: undefined }),
      ),
    ).toBe("Response Time (in ms)");
  });

  test("a filter with no check says nothing", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({ checkOn: undefined as unknown as CheckOn }),
      ),
    ).toBe("");
  });

  test("a metric threshold names the metric by its alias, with its unit", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.MetricValue,
          value: 80,
          metricMonitorOptions: {
            metricAlias: "container_cpu",
            metricAggregationType: EvaluateOverTimeType.Average,
            thresholdUnit: "%",
          },
        }),
      ),
    ).toBe("container_cpu is above 80 %");
  });

  test("a metric threshold without an alias yet falls back to the check", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.MetricValue,
          value: 80,
          metricMonitorOptions: {
            metricAggregationType: EvaluateOverTimeType.AnyValue,
          },
        }),
      ),
    ).toBe("Metric Value is above 80");
  });

  test("a database filter names its metric, not 'Database Metric'", () => {
    const name: string = CriteriaNameUtil.describeFilter(
      filter({
        checkOn: CheckOn.DatabaseMetric,
        value: 90,
        databaseMonitorOptions: {
          metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
        },
      }),
    );

    expect(name).not.toContain("Database Metric");
    expect(name).toContain("is above 90");
  });

  test("a disk, an interface and an OID say what they are scoped to", () => {
    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.DiskUsagePercent,
          value: 90,
          serverMonitorOptions: { diskPath: "/var" },
        }),
      ),
    ).toBe("Disk Usage (in %) on /var is above 90");

    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
          value: 80,
          snmpMonitorOptions: { interfaceName: "Gi0/1" },
        }),
      ),
    ).toBe("SNMP Interface Utilization (in %) on Gi0/1 is above 80");

    expect(
      CriteriaNameUtil.describeFilter(
        filter({
          checkOn: CheckOn.SnmpOidValue,
          filterType: FilterType.GreaterThan,
          value: 5,
          snmpMonitorOptions: { oid: "1.3.6.1.2.1.1.3.0" },
        }),
      ),
    ).toBe("SNMP OID Value 1.3.6.1.2.1.1.3.0 is above 5");
  });

  test("a long text value is cut short", () => {
    const name: string = CriteriaNameUtil.describeFilter(
      filter({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.Contains,
        value: "x".repeat(200),
      }),
    );

    // The quoted value is at most MAX_VALUE_LENGTH long, ellipsis included.
    const quoted: string = name.slice(name.indexOf('"') + 1, -1);
    expect(quoted.length).toBeLessThanOrEqual(
      CriteriaNameUtil.MAX_VALUE_LENGTH,
    );
    expect(quoted.endsWith(CriteriaNameUtil.ELLIPSIS)).toBe(true);
  });
});

describe("CriteriaNameUtil.getNameFromFilters - the whole criteria", () => {
  const offline: CriteriaFilter = filter({
    checkOn: CheckOn.IsOnline,
    filterType: FilterType.False,
  });
  const serverError: CriteriaFilter = filter({
    checkOn: CheckOn.ResponseStatusCode,
    filterType: FilterType.GreaterThanOrEqualTo,
    value: 400,
  });
  const slow: CriteriaFilter = filter({
    checkOn: CheckOn.ResponseTime,
    value: 3000,
  });
  const timeout: CriteriaFilter = filter({
    checkOn: CheckOn.IsRequestTimeout,
    filterType: FilterType.True,
  });

  test("one filter is the name", () => {
    expect(CriteriaNameUtil.getNameFromFilters({ filters: [slow] })).toBe(
      "Response Time (in ms) is above 3000",
    );
  });

  test("All joins the filters with 'and', Any with 'or'", () => {
    expect(
      CriteriaNameUtil.getNameFromFilters({
        filters: [offline, serverError],
        filterCondition: FilterCondition.All,
      }),
    ).toBe("Is Online is false and Response Status Code is at least 400");

    expect(
      CriteriaNameUtil.getNameFromFilters({
        filters: [offline, serverError],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe("Is Online is false or Response Status Code is at least 400");
  });

  test("without a condition the filters are read as All, as the evaluator does", () => {
    expect(
      CriteriaNameUtil.getNameFromFilters({
        filters: [offline, serverError],
      }),
    ).toContain(" and ");
  });

  test("three filters are spelled out; past that the rest are counted", () => {
    expect(
      CriteriaNameUtil.getNameFromFilters({
        filters: [offline, serverError, timeout],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe(
      "Is Online is false or Response Status Code is at least 400 or Is Request Timeout is true",
    );

    expect(
      CriteriaNameUtil.getNameFromFilters({
        filters: [offline, serverError, timeout, slow],
        filterCondition: FilterCondition.Any,
      }),
    ).toBe(
      "Is Online is false or Response Status Code is at least 400 or 2 more",
    );
  });

  test("a name never grows past MAX_NAME_LENGTH", () => {
    const long: CriteriaFilter = filter({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "y".repeat(60),
    });

    const twoLong: string = CriteriaNameUtil.getNameFromFilters({
      filters: [long, long, long],
      filterCondition: FilterCondition.All,
    });

    expect(twoLong.length).toBeLessThanOrEqual(
      CriteriaNameUtil.MAX_NAME_LENGTH,
    );
    expect(twoLong.endsWith(" and 2 more")).toBe(true);
  });

  test("filters that say nothing fall back to a plain name, never to an empty one", () => {
    expect(CriteriaNameUtil.getNameFromFilters({ filters: [] })).toBe(
      CriteriaNameUtil.FALLBACK_NAME,
    );
    expect(CriteriaNameUtil.getNameFromFilters({ filters: undefined })).toBe(
      CriteriaNameUtil.FALLBACK_NAME,
    );
  });
});

describe("when a name is generated, and when it is the user's", () => {
  const filters: Array<CriteriaFilter> = [
    filter({ checkOn: CheckOn.ResponseTime, value: 3000 }),
  ];

  test("an empty name, or one of spaces, is not the user's", () => {
    expect(
      CriteriaNameUtil.isNameFromFilters({ name: "", filters: filters }),
    ).toBe(true);
    expect(
      CriteriaNameUtil.isNameFromFilters({ name: "   ", filters: filters }),
    ).toBe(true);
    expect(
      CriteriaNameUtil.isNameFromFilters({ name: undefined, filters: filters }),
    ).toBe(true);
  });

  test("the name the filters give is generated", () => {
    expect(
      CriteriaNameUtil.isNameFromFilters({
        name: "Response Time (in ms) is above 3000",
        filters: filters,
      }),
    ).toBe(true);
  });

  test("anything else is the user's", () => {
    expect(
      CriteriaNameUtil.isNameFromFilters({
        name: "Slow checkout",
        filters: filters,
      }),
    ).toBe(false);
  });

  test("a generated name follows the filters", () => {
    expect(
      CriteriaNameUtil.getNameAfterFiltersChange({
        name: "Response Time (in ms) is above 3000",
        previous: { filters: filters },
        next: {
          filters: [filter({ checkOn: CheckOn.ResponseTime, value: 5000 })],
        },
      }),
    ).toBe("Response Time (in ms) is above 5000");
  });

  test("a generated name follows the filter condition too", () => {
    const two: Array<CriteriaFilter> = [
      filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.False }),
      filter({ checkOn: CheckOn.ResponseTime, value: 3000 }),
    ];

    expect(
      CriteriaNameUtil.getNameAfterFiltersChange({
        name: "Is Online is false and Response Time (in ms) is above 3000",
        previous: { filters: two, filterCondition: FilterCondition.All },
        next: { filters: two, filterCondition: FilterCondition.Any },
      }),
    ).toBe("Is Online is false or Response Time (in ms) is above 3000");
  });

  test("an empty name is filled in when the filters change", () => {
    expect(
      CriteriaNameUtil.getNameAfterFiltersChange({
        name: "",
        previous: { filters: filters },
        next: { filters: filters },
      }),
    ).toBe("Response Time (in ms) is above 3000");
  });

  test("the user's own name stays as it is", () => {
    expect(
      CriteriaNameUtil.getNameAfterFiltersChange({
        name: "Slow checkout",
        previous: { filters: filters },
        next: {
          filters: [filter({ checkOn: CheckOn.ResponseTime, value: 5000 })],
        },
      }),
    ).toBe("Slow checkout");
  });

  test("a name each new monitor is seeded with is never mistaken for a generated one", () => {
    /*
     * "Check if Acme is online" and the rest are names a person would have
     * written; editing those criteria's filters must not rename them. Swept
     * over every monitor type's out-of-the-box criteria.
     */
    let checked: number = 0;

    for (const monitorType of ALL_MONITOR_TYPES) {
      const seeded: MonitorCriteria = MonitorCriteria.getDefaultMonitorCriteria(
        {
          monitorType: monitorType,
          ...SEED_OPTIONS,
        },
      );

      for (const instance of seeded.data?.monitorCriteriaInstanceArray || []) {
        if (!instance.data?.name) {
          continue;
        }

        checked++;

        expect({
          monitorType: monitorType,
          name: instance.data.name,
          isNameFromFilters: CriteriaNameUtil.isNameFromFilters({
            name: instance.data.name,
            filters: instance.data.filters,
            filterCondition: instance.data.filterCondition,
          }),
        }).toEqual({
          monitorType: monitorType,
          name: instance.data.name,
          isNameFromFilters: false,
        });
      }
    }

    // The sweep looked at the defaults of most monitor types, not at none.
    expect(checked).toBeGreaterThan(30);
  });
});

describe("the name a criteria added with Add Criteria starts with", () => {
  test.each(
    ALL_MONITOR_TYPES.filter((monitorType: MonitorType) => {
      return monitorType !== MonitorType.Manual;
    }),
  )(
    "a new %s criteria has a name that says what it checks",
    (monitorType: MonitorType) => {
      const defaultFilter: CriteriaFilter =
        CriteriaFilterUtil.getDefaultCriteriaFilter(monitorType);

      const name: string = CriteriaNameUtil.getNameFromFilters({
        filters: [defaultFilter],
        filterCondition: FilterCondition.All,
      });

      expect(name).not.toBe("");
      expect(name).not.toBe(CriteriaNameUtil.FALLBACK_NAME);
      expect(name.length).toBeLessThanOrEqual(CriteriaNameUtil.MAX_NAME_LENGTH);

      /*
       * It passes the one check a name has to pass: whatever else a new
       * criteria still needs (a threshold, say), it is never its name.
       */
      const instance: MonitorCriteriaInstance = criteriaWith({
        name: name,
        filters: [defaultFilter],
      });

      expect(
        MonitorCriteriaInstance.getValidationError(instance, monitorType) || "",
      ).not.toContain("Name is required");
    },
  );
});

describe("CriteriaNameUtil.nameUnnamedCriteria", () => {
  test("names only the criteria that have no name", () => {
    const unnamed: MonitorCriteriaInstance = criteriaWith({
      name: "",
      filters: [filter({ checkOn: CheckOn.ResponseTime, value: 3000 })],
    });
    const named: MonitorCriteriaInstance = criteriaWith({
      name: "Slow checkout",
      filters: [filter({ checkOn: CheckOn.ResponseTime, value: 5000 })],
    });

    const result: MonitorStepsNamingResult =
      CriteriaNameUtil.nameUnnamedCriteria(stepsWith([unnamed, named]));

    expect(result.didChange).toBe(true);
    expect(namesIn(result.monitorSteps)).toEqual([
      "Response Time (in ms) is above 3000",
      "Slow checkout",
    ]);
  });

  test("a name of only spaces counts as no name", () => {
    const result: MonitorStepsNamingResult =
      CriteriaNameUtil.nameUnnamedCriteria(
        stepsWith([
          criteriaWith({
            name: "  ",
            filters: [
              filter({
                checkOn: CheckOn.IsOnline,
                filterType: FilterType.True,
              }),
            ],
          }),
        ]),
      );

    expect(namesIn(result.monitorSteps)).toEqual(["Is Online is true"]);
  });

  test("hands back the very same steps when every criteria has a name", () => {
    const monitorSteps: MonitorSteps = stepsWith([
      criteriaWith({
        name: "Slow checkout",
        filters: [filter({ checkOn: CheckOn.ResponseTime, value: 5000 })],
      }),
    ]);

    const result: MonitorStepsNamingResult =
      CriteriaNameUtil.nameUnnamedCriteria(monitorSteps);

    expect(result.didChange).toBe(false);
    expect(result.monitorSteps).toBe(monitorSteps);
  });

  test("leaves the steps it was given as they were", () => {
    const unnamed: MonitorCriteriaInstance = criteriaWith({
      name: "",
      filters: [filter({ checkOn: CheckOn.ResponseTime, value: 3000 })],
    });
    const monitorSteps: MonitorSteps = stepsWith([unnamed]);

    CriteriaNameUtil.nameUnnamedCriteria(monitorSteps);

    expect(namesIn(monitorSteps)).toEqual([""]);
    expect(unnamed.data!.name).toBe("");
  });

  test("keeps the default monitor status and every other step setting", () => {
    const monitorSteps: MonitorSteps = stepsWith([
      criteriaWith({
        name: "",
        filters: [filter({ checkOn: CheckOn.ResponseTime, value: 3000 })],
      }),
    ]);

    const result: MonitorStepsNamingResult =
      CriteriaNameUtil.nameUnnamedCriteria(monitorSteps);

    expect(result.monitorSteps.data?.defaultMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
    expect(result.monitorSteps.data?.monitorStepsInstanceArray).toHaveLength(1);
  });
});

describe("a monitor type change repairs filters, and a generated name follows them", () => {
  /*
   * The create form brings criteria back in line with a monitor type picked
   * after they were seeded, dropping filters the new type cannot express.
   * A name made from the dropped filters would go on describing a rule that
   * is gone, so a generated name follows the repaired filters - and a name
   * the user typed does not.
   */
  function repairFor(instance: MonitorCriteriaInstance): string {
    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = { monitorCriteriaInstanceArray: [instance] };

    return MonitorCriteriaAlignmentUtil.repairMonitorCriteriaFilters({
      monitorCriteria: monitorCriteria,
      monitorType: MonitorType.Ping,
      seedOptions: SEED_OPTIONS,
    }).monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!.name;
  }

  // A Ping monitor offers Is Online and Response Time, not the body.
  const filters: Array<CriteriaFilter> = [
    filter({ checkOn: CheckOn.ResponseTime, value: 3000 }),
    filter({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "error",
    }),
  ];

  test("a generated name loses the filter that was dropped", () => {
    const generated: string = CriteriaNameUtil.getNameFromFilters({
      filters: filters,
    });

    expect(generated).toContain("Response Body");

    expect(repairFor(criteriaWith({ name: generated, filters: filters }))).toBe(
      "Response Time (in ms) is above 3000",
    );
  });

  test("the user's own name survives the repair", () => {
    expect(
      repairFor(criteriaWith({ name: "Slow or broken", filters: filters })),
    ).toBe("Slow or broken");
  });
});

describe("what the monitor docs say about criteria names", () => {
  /*
   * The Website and API monitor pages tell readers what "Add Criteria" names
   * a criteria, with an example. The example has to be the name the form
   * really gives, or the docs teach a name nobody will see.
   */
  const DOCS: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Docs",
    "Content",
    "en",
    "monitor",
  );

  test.each(["website-monitor.md", "api-monitor.md"])(
    "%s gives an example name the form really gives, and says where the fallback status lives",
    (fileName: string) => {
      const page: string = fs.readFileSync(path.join(DOCS, fileName), "utf8");

      const example: string = CriteriaNameUtil.getNameFromFilters({
        filters: [filter({ checkOn: CheckOn.ResponseTime, value: 3000 })],
      });

      expect(page).toContain(
        `**Add Criteria** adds a criteria that is already named after its filter, for example _${example}_.`,
      );
      expect(page).toContain("A description is optional");
      expect(page).toContain(
        "When none of them matches, the monitor falls back to its default status: **Operational**, unless you pick another under **Advanced**",
      );
    },
  );
});
