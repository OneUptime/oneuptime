import { describe, expect, test } from "@jest/globals";
import { printHclExpression } from "../../../Utils/DeveloperDocs/Hcl";
import {
  FILTER_JSON_OPTIONS,
  MonitorStepsHclContext,
  monitorStepsToHcl,
} from "../../../Utils/DeveloperDocs/TerraformMonitorSteps";
import {
  TerraformSecretVariable,
  TerraformVariableCollector,
} from "../../../Utils/DeveloperDocs/TerraformValues";
import { HclTestValue, toTestValue } from "./HclTestValue";

/*
 * monitorStepsToHcl is the provider's MonitorStepsFromAPI
 * (Scripts/TerraformProvider/StaticFiles/monitorsteps.go) ported to write HCL:
 * the provider stores that conversion in its state, so configuration written
 * from it imports with no changes. The cases below are the Go suite's
 * FromAPI cases (TestMonitorStepsFromAPI*), plus the secret handling the
 * dashboard adds.
 */

function context(): MonitorStepsHclContext {
  return {
    variables: new TerraformVariableCollector(),
    variablePrefix: "api_health",
    monitorLabel: 'monitor "API Health"',
  };
}

function envelope(steps: Array<unknown>): unknown {
  return {
    _type: "MonitorSteps",
    value: { monitorStepsInstanceArray: steps },
  };
}

function step(value: Record<string, unknown>): unknown {
  return { _type: "MonitorStep", value };
}

function criteriaEnvelope(instances: Array<Record<string, unknown>>): unknown {
  return {
    _type: "MonitorCriteria",
    value: {
      monitorCriteriaInstanceArray: instances.map(
        (instance: Record<string, unknown>) => {
          return { _type: "MonitorCriteriaInstance", value: instance };
        },
      ),
    },
  };
}

function convert(
  value: unknown,
  data: MonitorStepsHclContext = context(),
): HclTestValue {
  return toTestValue(monitorStepsToHcl(value, data));
}

describe("what the API returns for a website monitor", () => {
  test("becomes the typed monitor_steps list", () => {
    expect(
      convert(
        envelope([
          step({
            id: "server-generated-step-id",
            monitorDestination: { _type: "URL", value: "https://example.com" },
            requestType: "GET",
            monitorCriteria: criteriaEnvelope([
              {
                id: "server-generated-criteria-id",
                name: "Online",
                description: "Website responds with 200",
                filterCondition: "All",
                monitorStatusId: "status-online",
                changeMonitorStatus: true,
                createIncidents: false,
                createAlerts: false,
                filters: [
                  { checkOn: "Is Online", filterType: "True" },
                  {
                    checkOn: "Response Status Code",
                    filterType: "Equal To",
                    value: 200,
                  },
                ],
                incidents: [],
                alerts: [],
              },
            ]),
          }),
        ]),
      ),
    ).toEqual([
      {
        monitor_destination: "https://example.com",
        monitor_destination_type: "URL",
        request_type: "GET",
        criteria: [
          {
            name: "Online",
            description: "Website responds with 200",
            filter_condition: "All",
            monitor_status_id: "status-online",
            change_monitor_status: true,
            create_incidents: false,
            create_alerts: false,
            filters: [
              { check_on: "Is Online", filter_type: "True" },
              {
                check_on: "Response Status Code",
                filter_type: "Equal To",
                value: "200",
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("server extras are dropped (TestMonitorStepsFromAPIDropsServerExtras)", () => {
  test("ids, the snmpMonitor carrier, unknown keys and echoed empty containers", () => {
    const converted: HclTestValue = convert({
      _type: "MonitorSteps",
      value: {
        defaultMonitorStatusId: "64df2b8f0e3a4b0012345678",
        monitorStepsInstanceArray: [
          step({
            id: "64df2b8f0e3a4b0087654321",
            snmpMonitor: { hostname: "10.0.0.1", port: 161 },
            someFutureKey: "ignore-me",
            requestHeaders: {},
            requestType: "GET",
            monitorCriteria: criteriaEnvelope([
              {
                id: "64df2b8f0e3a4b0011112222",
                name: "Check",
                incidents: [],
                alerts: [],
                someUnknownCriteriaKey: true,
                filters: [
                  {
                    checkOn: "Is Online",
                    filterType: "True",
                    metricCriteriaContext: { metricName: "cpu" },
                    someUnknownFilterKey: 42,
                  },
                ],
              },
            ]),
          }),
        ],
      },
    });

    expect(converted).toEqual([
      {
        request_type: "GET",
        criteria: [
          {
            name: "Check",
            filters: [{ check_on: "Is Online", filter_type: "True" }],
          },
        ],
      },
    ]);
  });

  test("empty strings count as unset", () => {
    expect(
      convert(
        envelope([
          step({
            requestType: "",
            requestBody: "",
            customCode: "",
            retryCount: 0,
          }),
        ]),
      ),
    ).toEqual([{ retry_count: 0 }]);
  });
});

describe("input forms (TestMonitorStepsFromAPIInputForms)", () => {
  test("the wrapper envelope and the bare value give the same list", () => {
    const steps: Array<unknown> = [step({ requestType: "POST" })];

    expect(convert(envelope(steps))).toEqual([{ request_type: "POST" }]);
    expect(convert({ monitorStepsInstanceArray: steps })).toEqual([
      { request_type: "POST" },
    ]);
  });

  test("nothing, an empty envelope, no steps and garbage leave the attribute out", () => {
    for (const value of [
      null,
      undefined,
      { _type: "MonitorSteps", value: null },
      envelope([]),
      "not-a-monitor-steps",
      42,
      true,
      ["nope"],
      { foo: "bar" },
      { monitorStepsInstanceArray: "not-an-array" },
    ]) {
      expect({ value, converted: convert(value) }).toEqual({
        value,
        converted: null,
      });
    }
  });
});

describe("value coercions", () => {
  test("numeric filter values are written as strings (TestMonitorStepsFromAPINumericFilterValues)", () => {
    const converted: HclTestValue = convert(
      envelope([
        step({
          monitorCriteria: criteriaEnvelope([
            {
              name: "Numbers",
              filterCondition: "All",
              filters: [
                {
                  checkOn: "Response Status Code",
                  filterType: "Equal To",
                  value: 200,
                },
                {
                  checkOn: "Response Time (in ms)",
                  filterType: "Less Than",
                  value: 99.5,
                },
                {
                  checkOn: "Response Body",
                  filterType: "Contains",
                  value: "ok",
                },
              ],
            },
          ]),
        }),
      ]),
    );

    const filters: Array<{ value: string }> = (
      converted as Array<{
        criteria: Array<{ filters: Array<{ value: string }> }>;
      }>
    )[0]!.criteria[0]!.filters;

    expect(
      filters.map((filter: { value: string }): string => {
        return filter.value;
      }),
    ).toEqual(["200", "99.5", "ok"]);
  });

  test("wrapped ids, hostnames and ports (TestMonitorStepsFromAPIObjectIDWrappers)", () => {
    expect(
      convert({
        value: {
          monitorStepsInstanceArray: [
            step({
              monitorDestination: { _type: "Hostname", value: "example.com" },
              monitorDestinationPort: { _type: "Port", value: 443 },
              monitorCriteria: criteriaEnvelope([
                {
                  name: "Wrapped ids",
                  filterCondition: "Any",
                  monitorStatusId: { value: "status-1" },
                  filters: [{ checkOn: "Is Online", filterType: "False" }],
                  incidents: [
                    {
                      id: "incident-template-id",
                      title: "Down",
                      description: "It is down.",
                      incidentSeverityId: { _type: "ObjectID", value: "sev-9" },
                      onCallPolicyIds: [
                        { _type: "ObjectID", value: "ocp-9" },
                        "ocp-10",
                      ],
                    },
                  ],
                },
              ]),
            }),
          ],
        },
      }),
    ).toEqual([
      {
        monitor_destination: "example.com",
        monitor_destination_type: "Hostname",
        port: 443,
        criteria: [
          {
            name: "Wrapped ids",
            filter_condition: "Any",
            monitor_status_id: "status-1",
            filters: [{ check_on: "Is Online", filter_type: "False" }],
            incidents: [
              {
                title: "Down",
                description: "It is down.",
                incident_severity_id: "sev-9",
                on_call_policy_ids: ["ocp-9", "ocp-10"],
              },
            ],
          },
        ],
      },
    ]);
  });

  test("legacy filters wrapped as CriteriaFilter (TestMonitorStepsFromAPILegacyWrappedFilters)", () => {
    expect(
      convert(
        envelope([
          step({
            monitorCriteria: criteriaEnvelope([
              {
                name: "Legacy",
                filters: [
                  {
                    _type: "CriteriaFilter",
                    value: {
                      checkOn: "Response Status Code",
                      filterType: "Equal To",
                      value: "200",
                    },
                  },
                ],
              },
            ]),
          }),
        ]),
      ),
    ).toEqual([
      {
        criteria: [
          {
            name: "Legacy",
            filters: [
              {
                check_on: "Response Status Code",
                filter_type: "Equal To",
                value: "200",
              },
            ],
          },
        ],
      },
    ]);
  });

  test("a destination of an unknown type is left out, with its type", () => {
    expect(
      convert(
        envelope([
          step({
            monitorDestination: { _type: "Email", value: "a@b.c" },
            requestType: "GET",
          }),
        ]),
      ),
    ).toEqual([{ request_type: "GET" }]);
  });

  test("an Incoming Email criteria that opens an incident for every email", () => {
    expect(
      convert(
        envelope([
          step({
            monitorCriteria: criteriaEnvelope([
              {
                name: "Reported by email",
                createIncidents: true,
                openForEveryEmail: true,
                filters: [
                  {
                    checkOn: "Email From Address",
                    filterType: "Ends With",
                    value: "@acme.example",
                  },
                ],
              },
              {
                name: "Set to false through the API",
                openForEveryEmail: false,
                filters: [
                  {
                    checkOn: "Email Received",
                    filterType: "Recieved In Minutes",
                    value: 60,
                  },
                ],
              },
              {
                name: "Never set",
                filters: [
                  {
                    checkOn: "Email Received",
                    filterType: "Recieved In Minutes",
                    value: 60,
                  },
                ],
              },
            ]),
          }),
        ]),
      ),
    ).toEqual([
      {
        criteria: [
          {
            name: "Reported by email",
            create_incidents: true,
            open_for_every_email: true,
            filters: [
              {
                check_on: "Email From Address",
                filter_type: "Ends With",
                value: "@acme.example",
              },
            ],
          },
          {
            name: "Set to false through the API",
            open_for_every_email: false,
            filters: [
              {
                check_on: "Email Received",
                filter_type: "Recieved In Minutes",
                value: "60",
              },
            ],
          },
          {
            name: "Never set",
            filters: [
              {
                check_on: "Email Received",
                filter_type: "Recieved In Minutes",
                value: "60",
              },
            ],
          },
        ],
      },
    ]);
  });

  test("over-time evaluation, server options and the alert template", () => {
    expect(
      convert(
        envelope([
          step({
            monitorCriteria: criteriaEnvelope([
              {
                name: "CPU",
                isEnabled: true,
                filters: [
                  {
                    checkOn: "CPU Usage (in %)",
                    filterType: "Greater Than",
                    value: 90,
                    evaluateOverTime: true,
                    evaluateOverTimeOptions: {
                      timeValueInMinutes: 5,
                      evaluateOverTimeType: "Average",
                      onNoDataPolicy: "Ignore",
                    },
                    serverMonitorOptions: { diskPath: "/var" },
                  },
                ],
                alerts: [
                  {
                    title: "CPU high",
                    alertSeverityId: "sev-1",
                    autoResolveAlert: true,
                    labelIds: ["label-1"],
                    isPrivate: true,
                  },
                ],
              },
            ]),
          }),
        ]),
      ),
    ).toEqual([
      {
        criteria: [
          {
            name: "CPU",
            is_enabled: true,
            filters: [
              {
                check_on: "CPU Usage (in %)",
                filter_type: "Greater Than",
                value: "90",
                evaluate_over_time: true,
                evaluate_over_time_minutes: 5,
                evaluate_over_time_type: "Average",
                evaluate_over_time_no_data_policy: "Ignore",
                disk_path: "/var",
              },
            ],
            alerts: [
              {
                title: "CPU high",
                alert_severity_id: "sev-1",
                auto_resolve_alert: true,
                label_ids: ["label-1"],
                is_private: true,
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("a comparison with the previous check (#10821)", () => {
  function previousCheckFilter(
    options: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      checkOn: "Response Time (in ms)",
      filterType: "Greater Than",
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 10,
        evaluateOverTimeType: "Previous Check",
        ...options,
      },
    };
  }

  function exportedFilter(
    options: Record<string, unknown>,
  ): Record<string, HclTestValue> {
    const converted: HclTestValue = convert(
      envelope([
        step({
          monitorCriteria: criteriaEnvelope([
            { name: "Slower", filters: [previousCheckFilter(options)] },
          ]),
        }),
      ]),
    );

    return (
      converted as Array<{
        criteria: Array<{ filters: Array<Record<string, HclTestValue>> }>;
      }>
    )[0]!.criteria[0]!.filters[0]!;
  }

  test("writes the change's kind and size, a fraction kept", () => {
    expect(
      exportedFilter({ changeType: "Percentage", changeValue: 12.5 }),
    ).toEqual({
      check_on: "Response Time (in ms)",
      filter_type: "Greater Than",
      evaluate_over_time: true,
      evaluate_over_time_minutes: 10,
      evaluate_over_time_type: "Previous Check",
      evaluate_over_time_change_type: "Percentage",
      evaluate_over_time_change_value: 12.5,
    });
  });

  test("reads a change kept as its digits, and leaves out one that is not a number, as the provider does", () => {
    expect(
      exportedFilter({ changeType: "Amount", changeValue: " 200 " })[
        "evaluate_over_time_change_value"
      ],
    ).toBe(200);

    for (const changeValue of ["NaN", "Infinity", "fast", "", null, {}]) {
      expect({
        changeValue,
        written: exportedFilter({ changeType: "Amount", changeValue })[
          "evaluate_over_time_change_value"
        ],
      }).toEqual({ changeValue, written: undefined });
    }
  });

  test("a filter with no change set writes none", () => {
    expect(exportedFilter({})).toEqual({
      check_on: "Response Time (in ms)",
      filter_type: "Greater Than",
      evaluate_over_time: true,
      evaluate_over_time_minutes: 10,
      evaluate_over_time_type: "Previous Check",
    });
  });
});

describe("a criteria's recovery condition and active hours (#10822)", () => {
  // Weekdays from 08:00 to 18:00 in Oslo, as the dashboard keeps them.
  const OSLO_WEEKDAYS: Record<string, unknown> = {
    _type: "RestrictionTimes",
    value: {
      restictionType: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [12, 13, 14, 15, 16].map((date: number) => {
        const day: string = [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
        ][date - 12]!;

        return {
          startDay: day,
          endDay: day,
          startTime: {
            _type: "DateTime",
            value: `2026-01-${date}T07:00:00.000Z`,
          },
          endTime: {
            _type: "DateTime",
            value: `2026-01-${date}T17:00:00.000Z`,
          },
        };
      }),
    },
  };

  function offlineCriteria(
    settings: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    return [
      {
        name: "Offline",
        filterCondition: "Any",
        filters: [
          { checkOn: "Is Online", filterType: "False" },
          {
            checkOn: "Response Time (in ms)",
            filterType: "Greater Than",
            value: 5000,
          },
        ],
        ...settings,
      },
    ];
  }

  function exportedCriteria(
    settings: Record<string, unknown>,
  ): Record<string, HclTestValue> {
    const converted: HclTestValue = convert(
      envelope([
        step({ monitorCriteria: criteriaEnvelope(offlineCriteria(settings)) }),
      ]),
    );

    return (
      converted as Array<{ criteria: Array<Record<string, HclTestValue>> }>
    )[0]!.criteria[0]!;
  }

  test("writes the recovery filters, how they combine, the hours and their zone", () => {
    expect(
      exportedCriteria({
        recoveryFilters: [
          {
            checkOn: "Response Time (in ms)",
            filterType: "Less Than",
            value: 300,
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 10,
              evaluateOverTimeType: "Percentile",
              percentile: 99,
            },
          },
        ],
        recoveryFilterCondition: "All",
        activeHours: OSLO_WEEKDAYS,
        activeHoursTimezone: "Europe/Oslo",
      }),
    ).toEqual({
      name: "Offline",
      filter_condition: "Any",
      filters: [
        { check_on: "Is Online", filter_type: "False" },
        {
          check_on: "Response Time (in ms)",
          filter_type: "Greater Than",
          value: "5000",
        },
      ],
      recovery_filters: [
        {
          check_on: "Response Time (in ms)",
          filter_type: "Less Than",
          value: "300",
          evaluate_over_time: true,
          evaluate_over_time_minutes: 10,
          evaluate_over_time_type: "Percentile",
          evaluate_over_time_percentile: 99,
        },
      ],
      recovery_filter_condition: "All",
      active_hours: { days: [0, 1, 2, 3, 4], from: "08:00", to: "18:00" },
      active_hours_timezone: "Europe/Oslo",
    });
  });

  test("hours read on another zone's clock are other hours", () => {
    expect(
      exportedCriteria({
        activeHours: OSLO_WEEKDAYS,
        activeHoursTimezone: "America/New_York",
      })["active_hours"],
    ).toEqual({ days: [0, 1, 2, 3, 4], from: "02:00", to: "12:00" });
  });

  test("hours that are not alike on each day, or have no zone, are left out as the provider leaves them", () => {
    const differentHours: Record<string, unknown> = {
      _type: "RestrictionTimes",
      value: {
        restictionType: "Weekly",
        dayRestrictionTimes: null,
        weeklyRestrictionTimes: [
          {
            startDay: "Monday",
            endDay: "Monday",
            startTime: { _type: "DateTime", value: "2026-01-12T08:00:00.000Z" },
            endTime: { _type: "DateTime", value: "2026-01-12T16:00:00.000Z" },
          },
          {
            startDay: "Tuesday",
            endDay: "Tuesday",
            startTime: { _type: "DateTime", value: "2026-01-13T09:00:00.000Z" },
            endTime: { _type: "DateTime", value: "2026-01-13T12:00:00.000Z" },
          },
        ],
      },
    };

    const different: Record<string, HclTestValue> = exportedCriteria({
      activeHours: differentHours,
      activeHoursTimezone: "UTC",
    });

    expect(different["active_hours"]).toBeUndefined();
    expect(different["active_hours_timezone"]).toBe("UTC");
    expect(
      exportedCriteria({ activeHours: OSLO_WEEKDAYS })["active_hours"],
    ).toBeUndefined();
    expect(
      exportedCriteria({ activeHours: "weekdays", activeHoursTimezone: "UTC" })[
        "active_hours"
      ],
    ).toBeUndefined();
  });

  test("a criteria with neither writes neither", () => {
    expect(Object.keys(exportedCriteria({}))).toEqual([
      "name",
      "filter_condition",
      "filters",
    ]);
  });

  test("the printed hours say which days they are on", () => {
    const printed: string = printHclExpression(
      monitorStepsToHcl(
        envelope([
          step({
            monitorCriteria: criteriaEnvelope(
              offlineCriteria({
                activeHours: OSLO_WEEKDAYS,
                activeHoursTimezone: "Europe/Oslo",
              }),
            ),
          }),
        ]),
        context(),
      )!,
    );

    expect(printed).toMatch(/days = \[0, 1, 2, 3, 4\] +# Monday to Friday\n/);
    expect(printed).toMatch(/from = "08:00"\n/);
    expect(printed).toMatch(/to {3}= "18:00"\n/);
    expect(printed).toMatch(/active_hours_timezone += "Europe\/Oslo"\n/);
  });
});

describe("raw-JSON sub-configs (TestMonitorStepsFromAPIMapsInjectedSubConfigs)", () => {
  test("a log monitor's query is written with jsonencode, exactly as stored", () => {
    const converted: HclTestValue = convert(
      envelope([
        step({
          requestType: "GET",
          logMonitor: {
            attributes: {},
            body: "",
            severityTexts: [],
            telemetryServiceIds: [],
            lastXSecondsOfLogs: 60,
          },
        }),
      ]),
    );

    expect(converted).toEqual([
      {
        request_type: "GET",
        log_monitor: {
          call: "jsonencode",
          args: [
            {
              attributes: {},
              body: "",
              severityTexts: [],
              telemetryServiceIds: [],
              lastXSecondsOfLogs: 60,
            },
          ],
        },
      },
    ]);
  });

  test("a sub-config that is not an object is left out", () => {
    expect(
      convert(envelope([step({ requestType: "GET", logMonitor: "nope" })])),
    ).toEqual([{ request_type: "GET" }]);
  });
});

/*
 * The raw-JSON filter options (TestMonitorStepsFilterJSONOptionsRoundTrip,
 * TestMonitorStepsFromAPICustomCodeMonitorOptions). A Custom Code monitor's
 * Result Value filter names the field of the returned data it compares in
 * customCodeMonitorOptions.resultValuePath; the provider keeps it in
 * custom_code_monitor_options, so the export writes it there too - otherwise
 * applying the exported configuration would drop the field path.
 */
describe("raw-JSON filter options", () => {
  const SCRIPT: string = "return { data: { status: 'UP' } };";

  type HclFilter = { [key: string]: HclTestValue };

  function customCodeMonitor(filters: Array<Record<string, unknown>>): unknown {
    return envelope([
      step({
        id: "server-generated-step-id",
        customCode: SCRIPT,
        monitorCriteria: criteriaEnvelope([
          { name: "Unhealthy", filterCondition: "Any", filters },
        ]),
      }),
    ]);
  }

  function exportedFilters(
    filters: Array<Record<string, unknown>>,
  ): Array<HclFilter> {
    const converted: HclTestValue = convert(customCodeMonitor(filters));

    return (
      converted as Array<{ criteria: Array<{ filters: Array<HclFilter> }> }>
    )[0]!.criteria[0]!.filters;
  }

  function resultValueFilter(
    customCodeMonitorOptions?: unknown,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      checkOn: "Result Value",
      filterType: "Not Equal To",
      value: "UP",
    };

    if (customCodeMonitorOptions !== undefined) {
      filter["customCodeMonitorOptions"] = customCodeMonitorOptions;
    }

    return filter;
  }

  test("a Result Value filter's field path is written as custom_code_monitor_options", () => {
    expect(
      convert(
        customCodeMonitor([
          {
            checkOn: "Result Value",
            filterType: "Greater Than",
            value: 500,
            customCodeMonitorOptions: {
              resultValuePath: "data.items[0].value",
            },
          },
        ]),
      ),
    ).toEqual([
      {
        custom_code: SCRIPT,
        criteria: [
          {
            name: "Unhealthy",
            filter_condition: "Any",
            filters: [
              {
                check_on: "Result Value",
                filter_type: "Greater Than",
                value: "500",
                custom_code_monitor_options: {
                  call: "jsonencode",
                  args: [{ resultValuePath: "data.items[0].value" }],
                },
              },
            ],
          },
        ],
      },
    ]);
  });

  test("a filter without a field path writes no custom_code_monitor_options", () => {
    const filters: Array<HclFilter> = exportedFilters([resultValueFilter()]);

    expect(filters).toEqual([
      { check_on: "Result Value", filter_type: "Not Equal To", value: "UP" },
    ]);
    expect(filters[0]).not.toHaveProperty("custom_code_monitor_options");
  });

  test("filters with and without a path keep their own: the option never moves to a neighbour", () => {
    expect(
      exportedFilters([
        resultValueFilter({ resultValuePath: "status" }),
        resultValueFilter(),
        resultValueFilter({ resultValuePath: "checks[1].status" }),
      ]).map((filter: HclFilter): HclTestValue => {
        return filter["custom_code_monitor_options"] ?? null;
      }),
    ).toEqual([
      { call: "jsonencode", args: [{ resultValuePath: "status" }] },
      null,
      { call: "jsonencode", args: [{ resultValuePath: "checks[1].status" }] },
    ]);
  });

  test('a path cleared in the dashboard leaves {}, written as jsonencode({}) because the provider reads it as "{}"', () => {
    expect(exportedFilters([resultValueFilter({})])).toEqual([
      {
        check_on: "Result Value",
        filter_type: "Not Equal To",
        value: "UP",
        custom_code_monitor_options: { call: "jsonencode", args: [{}] },
      },
    ]);
  });

  test("options that are not an object are left out, as the provider leaves them", () => {
    for (const options of ["status", ["status"], null, 42, true]) {
      expect({
        options,
        filters: exportedFilters([resultValueFilter(options)]),
      }).toEqual({
        options,
        filters: [
          {
            check_on: "Result Value",
            filter_type: "Not Equal To",
            value: "UP",
          },
        ],
      });
    }
  });

  test("keys the dashboard does not know yet stay in the JSON, as the provider keeps them", () => {
    expect(
      exportedFilters([
        resultValueFilter({ resultValuePath: "healthy", someFutureOption: 1 }),
      ])[0]?.["custom_code_monitor_options"],
    ).toEqual({
      call: "jsonencode",
      args: [{ resultValuePath: "healthy", someFutureOption: 1 }],
    });
  });

  test("every raw-JSON option is written from its own CriteriaFilter key", () => {
    expect(FILTER_JSON_OPTIONS.length).toBeGreaterThanOrEqual(4);

    for (const option of FILTER_JSON_OPTIONS) {
      const value: Record<string, unknown> = { example: option.apiKey };

      expect({
        option: option.apiKey,
        filters: exportedFilters([
          {
            checkOn: "Result Value",
            filterType: "Equal To",
            value: "UP",
            [option.apiKey]: value,
          },
        ]),
      }).toEqual({
        option: option.apiKey,
        filters: [
          {
            check_on: "Result Value",
            filter_type: "Equal To",
            value: "UP",
            [option.attributeName]: { call: "jsonencode", args: [value] },
          },
        ],
      });
    }
  });

  test("a filter carrying every option writes each one, in the provider's order", () => {
    const [filter] = exportedFilters([
      {
        checkOn: "Result Value",
        filterType: "Equal To",
        value: "UP",
        customCodeMonitorOptions: { resultValuePath: "status" },
        databaseMonitorOptions: { metricType: "connections" },
        snmpMonitorOptions: { oid: "1.3.6.1" },
        metricMonitorOptions: { metricAlias: "m1" },
      },
    ]);

    expect(Object.keys(filter!)).toEqual([
      "check_on",
      "filter_type",
      "value",
      "metric_monitor_options",
      "snmp_monitor_options",
      "database_monitor_options",
      "custom_code_monitor_options",
    ]);
  });

  test("the printed configuration reads as written by hand", () => {
    const printed: string = printHclExpression(
      monitorStepsToHcl(
        customCodeMonitor([
          resultValueFilter({ resultValuePath: "status" }),
          {
            checkOn: "Result Value",
            filterType: "Greater Than",
            value: 500,
            customCodeMonitorOptions: { resultValuePath: "checks[0].latency" },
          },
          resultValueFilter(),
        ]),
        context(),
      )!,
    );

    expect(printed).toContain(
      [
        "        filters = [",
        "          {",
        '            check_on    = "Result Value"',
        '            filter_type = "Not Equal To"',
        '            value       = "UP"',
        "            custom_code_monitor_options = jsonencode({",
        '              resultValuePath = "status"',
        "            })",
        "          },",
      ].join("\n"),
    );
    expect(printed).toContain('resultValuePath = "checks[0].latency"');
    // One option per filter that has a path: the third has none.
    expect(printed.split("custom_code_monitor_options").length - 1).toBe(2);
    // The server's step id stays out, as everywhere else.
    expect(printed).not.toContain("server-generated-step-id");
  });
});

/*
 * The three settings the provider writes since #10984: a Security Events
 * step's query, what a template's monitors keep when it syncs, and the
 * people an incident template gives a role. Without them the export left
 * them out, and the configuration it wrote would have removed them.
 */
describe("settings the provider writes since #10984", () => {
  test("a Security Events step's query is written with jsonencode, exactly as stored", () => {
    const query: Record<string, unknown> = {
      attributes: {},
      messageContains: "Failed password",
      severityNames: ["High"],
      classNames: ["Authentication"],
      telemetryServiceIds: [],
      lastXSecondsOfEvents: 300,
      watchlistFilters: [],
    };

    expect(convert(envelope([step({ securityEventsMonitor: query })]))).toEqual(
      [{ security_events_monitor: { call: "jsonencode", args: [query] } }],
    );
  });

  test("a template's sync fields are written as a list, and none as no attribute", () => {
    expect(
      convert(
        envelope([
          step({
            requestType: "GET",
            doNotSyncFields: ["monitorDestination", "requestHeaders"],
          }),
        ]),
      ),
    ).toEqual([
      {
        request_type: "GET",
        do_not_sync_fields: ["monitorDestination", "requestHeaders"],
      },
    ]);
    expect(
      convert(envelope([step({ requestType: "GET", doNotSyncFields: [] })])),
    ).toEqual([{ request_type: "GET" }]);
  });

  test("an incident's roles are written one { role_id, user_id } per person and role, from strings or ObjectID wrappers", () => {
    const converted: HclTestValue = convert(
      envelope([
        step({
          monitorCriteria: criteriaEnvelope([
            {
              name: "Offline",
              incidents: [
                {
                  title: "Down",
                  description: "The site is down.",
                  incidentMemberRoles: [
                    {
                      roleId: "a1000000-0000-4000-8000-000000000001",
                      userId: "a1000000-0000-4000-8000-000000000002",
                    },
                    {
                      roleId: {
                        _type: "ObjectID",
                        value: "a1000000-0000-4000-8000-000000000001",
                      },
                      userId: {
                        _type: "ObjectID",
                        value: "a1000000-0000-4000-8000-000000000003",
                      },
                    },
                    // Without its user: left out, as the provider leaves it.
                    { roleId: "a1000000-0000-4000-8000-000000000001" },
                  ],
                },
              ],
              alerts: [
                {
                  title: "Down",
                  description: "The site is down.",
                  incidentMemberRoles: [
                    {
                      roleId: "a1000000-0000-4000-8000-000000000001",
                      userId: "a1000000-0000-4000-8000-000000000002",
                    },
                  ],
                },
              ],
            },
          ]),
        }),
      ]),
    );

    expect(converted).toEqual([
      {
        criteria: [
          {
            name: "Offline",
            incidents: [
              {
                title: "Down",
                description: "The site is down.",
                incident_member_roles: [
                  {
                    role_id: "a1000000-0000-4000-8000-000000000001",
                    user_id: "a1000000-0000-4000-8000-000000000002",
                  },
                  {
                    role_id: "a1000000-0000-4000-8000-000000000001",
                    user_id: "a1000000-0000-4000-8000-000000000003",
                  },
                ],
              },
            ],
            // An alert has no roles: the provider has no such attribute on one.
            alerts: [{ title: "Down", description: "The site is down." }],
          },
        ],
      },
    ]);
  });

  test("an incident whose roles are all incomplete writes none", () => {
    expect(
      convert(
        envelope([
          step({
            monitorCriteria: criteriaEnvelope([
              {
                name: "Offline",
                incidents: [
                  {
                    title: "Down",
                    description: "The site is down.",
                    incidentMemberRoles: [{ userId: "u" }, "not a role"],
                  },
                ],
              },
            ]),
          }),
        ]),
      ),
    ).toEqual([
      {
        criteria: [
          {
            name: "Offline",
            incidents: [{ title: "Down", description: "The site is down." }],
          },
        ],
      },
    ]);
  });

  test("each role names its role and person in a comment when the page knows them", () => {
    const printed: string = printHclExpression(
      monitorStepsToHcl(
        envelope([
          step({
            monitorCriteria: criteriaEnvelope([
              {
                name: "Offline",
                incidents: [
                  {
                    title: "Down",
                    description: "The site is down.",
                    incidentMemberRoles: [
                      { roleId: "role-1", userId: "user-1" },
                    ],
                  },
                ],
              },
            ]),
          }),
        ]),
        {
          ...context(),
          describeId: (id: string): string | undefined => {
            return { "role-1": "Incident Commander", "user-1": "Ada" }[id];
          },
        },
      )!,
    );

    expect(printed).toContain('role_id = "role-1" # Incident Commander');
    expect(printed).toContain('user_id = "user-1" # Ada');
  });
});

describe("secrets never reach the page", () => {
  test("the TLS client key and passphrase are read from variables", () => {
    const data: MonitorStepsHclContext = context();

    expect(
      convert(
        envelope([
          step({
            tlsClientCertificate: "-----BEGIN CERTIFICATE-----",
            tlsClientKey: "-----BEGIN PRIVATE KEY-----",
            tlsClientKeyPassphrase: "hunter2",
          }),
        ]),
        data,
      ),
    ).toEqual([
      {
        tls_client_certificate: "-----BEGIN CERTIFICATE-----",
        tls_client_key: { ref: "var.api_health_tls_client_key" },
        tls_client_key_passphrase: {
          ref: "var.api_health_tls_client_key_passphrase",
        },
      },
    ]);

    expect(
      data.variables.variables.map((variable: TerraformSecretVariable) => {
        return variable.name;
      }),
    ).toEqual([
      "api_health_tls_client_key",
      "api_health_tls_client_key_passphrase",
    ]);
  });

  test("credential headers are read from variables; others and monitor secret references stay", () => {
    expect(
      convert(
        envelope([
          step({
            requestHeaders: {
              Authorization: "Bearer abc123",
              Accept: "application/json",
              "X-Api-Key": "{{monitorSecrets.apiKey}}",
              Cookie: "session=1",
              "X-Empty": "",
            },
          }),
        ]),
      ),
    ).toEqual([
      {
        request_headers: {
          Authorization: { ref: "var.api_health_header_authorization" },
          Accept: "application/json",
          "X-Api-Key": "{{monitorSecrets.apiKey}}",
          Cookie: { ref: "var.api_health_header_cookie" },
          "X-Empty": "",
        },
      },
    ]);
  });

  test("a password inside a database monitor's settings is read from a variable", () => {
    const data: MonitorStepsHclContext = context();
    const converted: HclTestValue = convert(
      envelope([
        step({
          databaseMonitor: {
            host: "db.internal",
            port: 5432,
            username: "monitor",
            password: "s3cret",
          },
        }),
      ]),
      data,
    );

    expect(converted).toEqual([
      {
        database_monitor: {
          call: "jsonencode",
          args: [
            {
              host: "db.internal",
              port: 5432,
              username: "monitor",
              password: { ref: "var.api_health_database_monitor_password" },
            },
          ],
        },
      },
    ]);
    expect(JSON.stringify(converted)).not.toContain("s3cret");
    expect(data.variables.variables[0]?.description).toBe(
      'The password in the database_monitor settings of monitor "API Health".',
    );
  });

  test("the printed configuration never contains a secret", () => {
    const printed: string = printHclExpression(
      monitorStepsToHcl(
        envelope([
          step({
            tlsClientKey: "PRIVATE-KEY-VALUE",
            requestHeaders: { Authorization: "Bearer TOKEN-VALUE" },
            sqlMonitor: { query: "select 1", password: "SQL-PASSWORD" },
          }),
        ]),
        context(),
      )!,
    );

    for (const secret of ["PRIVATE-KEY-VALUE", "TOKEN-VALUE", "SQL-PASSWORD"]) {
      expect(printed).not.toContain(secret);
    }
    expect(printed).toContain('query    = "select 1"');
  });
});
