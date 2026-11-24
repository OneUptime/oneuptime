import { JSONObject } from "Common/Types/JSON";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";
import WorkingHours from "Common/Types/OnCallDutyPolicy/WorkingHours";
import MetricQueryCloudAggregation from "Common/Utils/Metrics/MetricQueryCloudAggregation";
import MonitorStepsIdentityUtil from "Common/Utils/Monitor/MonitorStepsIdentityUtil";

/*
 * THE STEPS ONEUPTIME ANSWERS FOR STEPS A CONFIGURATION WRITES SPARSELY
 * (OneUptime/oneuptime#10907).
 *
 * The provider's monitor_steps tells what OneUptime writes of its own - a
 * criteria's is_enabled = true, a step's GET - from a setting someone added
 * in the Dashboard: the first is no change, the second is
 * (StaticFiles/monitorstepsdrift.go, monitorStepsUnsetValues). If OneUptime
 * ever wrote a default the provider does not know, every apply of a monitor
 * would fail as "Provider produced inconsistent result after apply"; if the
 * provider let pass more than OneUptime writes, a Dashboard setting would
 * hide again.
 *
 * So the generator writes, for steps a configuration writes with every
 * setting it can leave out left out - as the provider sends them - what the
 * server's own code answers for them: MonitorSteps.fromJSON, the ids
 * MonitorStepsIdentityUtil gives, the aggregations MetricQueryCloudAggregation
 * fills in, kept as the database keeps them and read back
 * (internal/provider/testdata/monitor_steps_server_defaults.json). The
 * provider's Go test (monitorstepsdrift_test.go) reads each answer back and
 * fails unless it is the same steps as the ones sent.
 */

export interface MonitorStepsServerDefaultsCase {
  name: string;
  // The steps as the provider sends them (MonitorStepsToAPI).
  sent: JSONObject;
  // What OneUptime keeps of them and answers when they are read back.
  answered: JSONObject;
}

export interface MonitorStepsServerDefaultsCases {
  about: string;
  cases: Array<MonitorStepsServerDefaultsCase>;
}

// A default status, as MonitorService fills in for steps sent without one.
const DEFAULT_MONITOR_STATUS_ID: string =
  "a1000000-0000-4000-8000-0000000109b1";
const OFFLINE_STATUS_ID: string = "a1000000-0000-4000-8000-0000000109b2";
const SEVERITY_ID: string = "a1000000-0000-4000-8000-0000000109b3";
const ON_CALL_POLICY_ID: string = "a1000000-0000-4000-8000-0000000109b4";

function stepsEnvelope(steps: Array<JSONObject>): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: steps.map((step: JSONObject): JSONObject => {
        return { _type: "MonitorStep", value: step };
      }),
    },
  };
}

function withCriteria(
  step: JSONObject,
  criteria: Array<JSONObject>,
): JSONObject {
  return {
    ...step,
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: {
        monitorCriteriaInstanceArray: criteria.map(
          (instance: JSONObject): JSONObject => {
            return { _type: "MonitorCriteriaInstance", value: instance };
          },
        ),
      },
    },
  };
}

const WEBSITE: JSONObject = {
  monitorDestination: { _type: "URL", value: "https://example.com" },
};

const OFFLINE: JSONObject = {
  name: "Offline",
  filterCondition: "All",
  filters: [{ checkOn: "Is Online", filterType: "False" }],
  monitorStatusId: OFFLINE_STATUS_ID,
  changeMonitorStatus: true,
};

// Steps as a configuration writes them: every setting it may leave out left out.
const SENT: Array<{ name: string; sent: JSONObject }> = [
  {
    name: "a page checked for being online, every setting but its destination and criteria left out",
    sent: stepsEnvelope([
      withCriteria(WEBSITE, [
        {
          name: "Online",
          filterCondition: "All",
          filters: [{ checkOn: "Is Online", filterType: "True" }],
        },
      ]),
    ]),
  },
  {
    name: "an API request with a method, headers and a body, its body's format and redirects left out",
    sent: stepsEnvelope([
      withCriteria(
        {
          monitorDestination: {
            _type: "URL",
            value: "https://api.example.com/health",
          },
          requestType: "POST",
          requestHeaders: { Authorization: "Bearer token" },
          requestBody: '{"ping":true}',
        },
        [OFFLINE],
      ),
    ]),
  },
  {
    name: "a criteria that opens an incident and an alert, the templates' flags left out",
    sent: stepsEnvelope([
      withCriteria(WEBSITE, [
        {
          ...OFFLINE,
          createIncidents: true,
          createAlerts: true,
          incidents: [
            {
              title: "The shop is down",
              description: "The shop does not answer.",
              incidentSeverityId: SEVERITY_ID,
              onCallPolicyIds: [ON_CALL_POLICY_ID],
            },
          ],
          alerts: [
            {
              title: "The shop is down",
              description: "The shop does not answer.",
              alertSeverityId: SEVERITY_ID,
            },
          ],
        },
      ]),
    ]),
  },
  {
    name: "a recovery condition written without its condition",
    sent: stepsEnvelope([
      withCriteria(WEBSITE, [
        {
          ...OFFLINE,
          recoveryFilters: [
            {
              checkOn: "Is Online",
              filterType: "True",
              evaluateOverTime: true,
              evaluateOverTimeOptions: {
                timeValueInMinutes: 10,
                evaluateOverTimeType: "All Values",
              },
            },
          ],
        },
      ]),
    ]),
  },
  {
    name: "active hours on weekdays in Oslo",
    sent: stepsEnvelope([
      withCriteria(WEBSITE, [
        {
          ...OFFLINE,
          activeHours: WorkingHours.fromSimpleHours({
            days: [0, 1, 2, 3, 4],
            from: "08:00",
            to: "18:00",
            timezone: "Europe/Oslo",
          }).toJSON(),
          activeHoursTimezone: "Europe/Oslo",
        },
      ]),
    ]),
  },
  {
    name: "windows that count, a percentile and a previous check, each one's no-data setting left out",
    sent: stepsEnvelope([
      withCriteria(WEBSITE, [
        {
          name: "Flapping",
          filterCondition: "Any",
          filters: [
            {
              checkOn: "Is Online",
              filterType: "False",
              evaluateOverTime: true,
              evaluateOverTimeOptions: {
                timeValueInMinutes: 60,
                evaluateOverTimeType: "Status Changes",
                countFilterType: "Greater Than",
                countValue: 4,
              },
            },
            {
              checkOn: "Response Time (in ms)",
              filterType: "Greater Than",
              value: 500,
              evaluateOverTime: true,
              evaluateOverTimeOptions: {
                timeValueInMinutes: 15,
                evaluateOverTimeType: "Percentile",
                percentile: 90,
              },
            },
            {
              checkOn: "Response Time (in ms)",
              filterType: "Greater Than",
              evaluateOverTime: true,
              evaluateOverTimeOptions: {
                timeValueInMinutes: 5,
                evaluateOverTimeType: "Previous Check",
                changeType: "Percentage",
                changeValue: 50,
              },
            },
          ],
          monitorStatusId: OFFLINE_STATUS_ID,
          changeMonitorStatus: true,
        },
      ]),
    ]),
  },
  {
    name: "a server's disk and a criteria that is turned off",
    sent: stepsEnvelope([
      withCriteria({}, [
        {
          name: "Disk full",
          filterCondition: "All",
          filters: [
            {
              checkOn: "Disk Usage (in %)",
              filterType: "Greater Than",
              value: 90,
              serverMonitorOptions: { diskPath: "*" },
            },
          ],
          isEnabled: false,
        },
      ]),
    ]),
  },
  {
    name: "a synthetic step: browsers, screen sizes, its code, retries and a timeout",
    sent: stepsEnvelope([
      withCriteria(
        {
          customCode: "await page.goto('https://example.com');",
          browserTypes: ["Chromium", "Firefox"],
          screenSizeTypes: ["Desktop", "Mobile"],
          retryCountOnError: 2,
          requestTimeoutInMs: 30000,
          retryCount: 1,
        },
        [
          {
            name: "Script failed",
            filterCondition: "All",
            filters: [{ checkOn: "Error", filterType: "Is Not Empty" }],
          },
        ],
      ),
    ]),
  },
  {
    name: "a metrics step whose query names no aggregation, and a filter's metric options",
    sent: stepsEnvelope([
      withCriteria(
        {
          metricMonitor: {
            metricViewConfig: {
              queryConfigs: [
                {
                  metricAliasData: { metricVariable: "a", title: "Errors" },
                  metricQueryData: {
                    filterData: { metricName: "http_errors_total" },
                  },
                },
              ],
              formulaConfigs: [],
            },
            rollingTime: "Past 5 Minutes",
          },
        },
        [
          {
            name: "Errors",
            filterCondition: "All",
            filters: [
              {
                checkOn: "Metric Value",
                filterType: "Greater Than",
                value: 10,
                metricMonitorOptions: {
                  metricAlias: "a",
                  metricAggregationType: "Average",
                },
              },
            ],
          },
        ],
      ),
    ]),
  },
  {
    name: "two steps, the second a port",
    sent: stepsEnvelope([
      withCriteria(WEBSITE, [OFFLINE]),
      withCriteria(
        {
          monitorDestination: { _type: "Hostname", value: "db.example.com" },
          monitorDestinationPort: { _type: "Port", value: 5432 },
        },
        [OFFLINE],
      ),
    ]),
  },
];

function clone(value: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

/*
 * What OneUptime answers for steps written to it: read (MonitorSteps.fromJSON),
 * given their ids and a default status (MonitorStepsIdentityUtil), a Metrics
 * query's aggregation filled in (MetricQueryCloudAggregation) - as
 * MonitorService does on a write - kept as the database keeps them, and read
 * back.
 */
export function answerFor(sent: JSONObject): JSONObject {
  const monitorSteps: MonitorSteps = MonitorSteps.fromJSON(clone(sent));

  MonitorStepsIdentityUtil.assignIds({
    monitorSteps: monitorSteps,
    defaultMonitorStatusId: new ObjectID(DEFAULT_MONITOR_STATUS_ID),
  });

  MetricQueryCloudAggregation.fillMissingAggregationsOfSteps(monitorSteps);

  const kept: JSONObject = MonitorSteps.toDatabaseJSON(
    clone(monitorSteps.toJSON()),
  );

  return clone(MonitorSteps.fromJSON(kept).toJSON());
}

export function buildMonitorStepsServerDefaultsCases(): MonitorStepsServerDefaultsCases {
  return {
    about:
      "Written by Scripts/TerraformProvider/Core/MonitorStepsServerDefaultsCases.ts from the server's own MonitorSteps, MonitorStepsIdentityUtil and MetricQueryCloudAggregation (OneUptime/oneuptime#10907). Do not edit.",
    cases: SENT.map(
      (sent: {
        name: string;
        sent: JSONObject;
      }): MonitorStepsServerDefaultsCase => {
        return {
          name: sent.name,
          sent: clone(sent.sent),
          answered: answerFor(sent.sent),
        };
      },
    ),
  };
}

// The file's name, in the provider's internal/provider/testdata.
export const MONITOR_STEPS_SERVER_DEFAULTS_CASES_FILE: string =
  "monitor_steps_server_defaults.json";

// The file the provider's Go test reads, as the generator writes it.
export function monitorStepsServerDefaultsCasesFile(): string {
  return `${JSON.stringify(buildMonitorStepsServerDefaultsCases(), null, 2)}\n`;
}
