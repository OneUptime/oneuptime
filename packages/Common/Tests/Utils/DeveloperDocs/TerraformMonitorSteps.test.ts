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
