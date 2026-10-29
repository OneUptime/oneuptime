import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import LogSeverity from "../../../Types/Log/LogSeverity";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * What a new Logs, Traces, Exceptions or Metrics monitor's criteria start
 * as in Create Monitor, through the criteria form itself (MonitorSteps),
 * and what they become when the person changes their mind.
 *
 * Monitor type and criteria are on different steps of Create Monitor, and
 * the criteria form is unmounted while the person is on another step: when
 * they come back it is mounted again, handed the criteria it seeded the
 * first time. Criteria nobody has worked on - a recipe's rule, untouched;
 * the empty criteria a metric chart's "Create monitor" hands in with only
 * its queries; another type's out-of-the-box criteria - start afresh for
 * the type now picked: a telemetry monitor on its own recipe, anything
 * else on its out-of-the-box criteria. Criteria somebody worked on are
 * kept (and only repaired where the new type cannot draw them), and a
 * monitor made from a template, or edited, is never set up afresh.
 *
 * MonitorStep is mocked out: what is under test is what the form seeds and
 * hands back to Create Monitor through onChange - what would be saved.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([]);
      },
    },
  };
});

import MonitorStepsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps";
import { TelemetryMonitorLinkSeed } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryMonitorLink";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OPERATIONAL_ID: string = "22222222-2222-4222-8222-222222222222";
const DEGRADED_ID: string = "33333333-3333-4333-8333-333333333333";
const OFFLINE_ID: string = "44444444-4444-4444-8444-444444444444";
const INCIDENT_SEVERITY_ID: string = "55555555-5555-4555-8555-555555555555";
const ALERT_SEVERITY_ID: string = "66666666-6666-4666-8666-666666666666";
const MONITOR_NAME: string = "Checkout";

function listOf<T>(data: Array<T>): unknown {
  return { data, count: data.length, skip: 0, limit: 50 };
}

function monitorStatus(data: {
  id: string;
  name: string;
  priority: number;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = data.id;
  status.name = data.name;
  status.priority = data.priority;
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

function mockModelApi(): void {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((request: { modelType: unknown }): never => {
      if (request.modelType === MonitorStatus) {
        return listOf([
          monitorStatus({
            id: OPERATIONAL_ID,
            name: "Operational",
            priority: 1,
            isOperationalState: true,
            isOfflineState: false,
          }),
          monitorStatus({
            id: DEGRADED_ID,
            name: "Degraded",
            priority: 2,
            isOperationalState: false,
            isOfflineState: false,
          }),
          monitorStatus({
            id: OFFLINE_ID,
            name: "Offline",
            priority: 3,
            isOperationalState: false,
            isOfflineState: true,
          }),
        ]) as never;
      }

      if (request.modelType === IncidentSeverity) {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = INCIDENT_SEVERITY_ID;
        severity.name = "Critical";
        return listOf([severity]) as never;
      }

      if (request.modelType === AlertSeverity) {
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = ALERT_SEVERITY_ID;
        severity.name = "High";
        return listOf([severity]) as never;
      }

      return listOf([]) as never;
    });
}

interface MountedForm {
  changes: Array<MonitorSteps>;
  latest: () => MonitorSteps;
}

async function mount(data: {
  monitorType: MonitorType;
  initialValue?: MonitorSteps | undefined;
  isCreating?: boolean | undefined;
  seedQuery?: TelemetryMonitorLinkSeed | undefined;
}): Promise<MountedForm> {
  const changes: Array<MonitorSteps> = [];

  render(
    <MonitorStepsElement
      monitorType={data.monitorType}
      monitorName={MONITOR_NAME}
      {...(data.initialValue ? { initialValue: data.initialValue } : {})}
      {...(data.isCreating !== undefined
        ? { isCreating: data.isCreating }
        : {})}
      {...(data.seedQuery ? { seedQuery: data.seedQuery } : {})}
      onChange={(value: MonitorSteps) => {
        changes.push(value);
      }}
    />,
  );

  await waitFor(() => {
    expect(screen.getByText("Default Monitor Status")).toBeInTheDocument();
  });

  return {
    changes,
    latest: () => {
      return changes[changes.length - 1]!;
    },
  };
}

function firstStep(monitorSteps: MonitorSteps): MonitorStep {
  const step: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (!step) {
    throw new Error("No step");
  }

  return step;
}

function instances(monitorSteps: MonitorSteps): Array<MonitorCriteriaInstance> {
  return (
    firstStep(monitorSteps).data?.monitorCriteria?.data
      ?.monitorCriteriaInstanceArray || []
  );
}

function ruleOf(
  monitorType: MonitorType,
  monitorSteps: MonitorSteps,
): TelemetryAlertRule | null {
  return TelemetryAlertRuleUtil.read({
    monitorType,
    monitorStep: firstStep(monitorSteps),
    defaultMonitorStatusId: monitorSteps.data?.defaultMonitorStatusId,
  }).rule;
}

function onlyFilter(monitorSteps: MonitorSteps): CriteriaFilter {
  const all: Array<MonitorCriteriaInstance> = instances(monitorSteps);
  expect(all).toHaveLength(1);
  expect(all[0]!.data!.filters).toHaveLength(1);
  return all[0]!.data!.filters[0]!;
}

// What the criteria form hands back for a new monitor of this type.
async function seededFor(monitorType: MonitorType): Promise<MonitorSteps> {
  const form: MountedForm = await mount({ monitorType });
  const seeded: MonitorSteps = form.latest();
  cleanup();
  return MonitorSteps.fromJSON(seeded.toJSON());
}

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  mockModelApi();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a new telemetry monitor's criteria start on its first recipe", () => {
  test("Logs: more than 10 error and fatal logs in 5 minutes creates an alert, Degraded while it lasts", async () => {
    const form: MountedForm = await mount({ monitorType: MonitorType.Logs });

    await waitFor(() => {
      expect(onlyFilter(form.latest()).checkOn).toBe(CheckOn.LogCount);
    });

    const steps: MonitorSteps = form.latest();
    expect(onlyFilter(steps)).toMatchObject({
      filterType: FilterType.GreaterThan,
      value: 10,
    });
    expect(firstStep(steps).data?.logMonitor).toMatchObject({
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      lastXSecondsOfLogs: 300,
    });

    const instance: MonitorCriteriaInstance = instances(steps)[0]!;
    expect(instance.data).toMatchObject({
      createAlerts: true,
      createIncidents: false,
      changeMonitorStatus: true,
    });
    expect(instance.data!.monitorStatusId?.toString()).toBe(DEGRADED_ID);
    expect(instance.data!.alerts[0]!.title).toBe("Checkout: too many errors");
    expect(instance.data!.alerts[0]!.alertSeverityId?.toString()).toBe(
      ALERT_SEVERITY_ID,
    );
    // Healthy again when it stops matching: the monitor's default status.
    expect(steps.data?.defaultMonitorStatusId?.toString()).toBe(OPERATIONAL_ID);
  });

  test("Traces: more than 10 failed spans in 5 minutes", async () => {
    const form: MountedForm = await mount({ monitorType: MonitorType.Traces });

    await waitFor(() => {
      expect(onlyFilter(form.latest()).checkOn).toBe(CheckOn.SpanCount);
    });

    expect(firstStep(form.latest()).data?.traceMonitor?.spanStatuses).toEqual([
      SpanStatus.Error,
    ]);
  });

  test("Exceptions: any exception in 5 minutes", async () => {
    const form: MountedForm = await mount({
      monitorType: MonitorType.Exceptions,
    });

    await waitFor(() => {
      expect(onlyFilter(form.latest())).toMatchObject({
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      });
    });
  });

  test("Metrics: the average over 5 minutes above a value the person enters", async () => {
    const form: MountedForm = await mount({ monitorType: MonitorType.Metrics });

    await waitFor(() => {
      expect(onlyFilter(form.latest()).checkOn).toBe(CheckOn.MetricValue);
    });

    const rule: TelemetryAlertRule | null = ruleOf(
      MonitorType.Metrics,
      form.latest(),
    );
    expect(rule).toMatchObject({
      filterType: FilterType.GreaterThan,
      threshold: undefined,
      rollingTime: RollingTime.Past5Minutes,
      metricAggregationType: EvaluateOverTimeType.Average,
    });
  });

  test("any other type starts on its out-of-the-box criteria, as before", async () => {
    const form: MountedForm = await mount({ monitorType: MonitorType.Website });

    await waitFor(() => {
      expect(instances(form.latest()).length).toBeGreaterThan(1);
    });

    expect(
      instances(form.latest()).map((instance: MonitorCriteriaInstance) => {
        return instance.data!.name;
      }),
    ).toContain(`Check if ${MONITOR_NAME} is offline`);
  });
});

describe("a link's query: what the logs or traces explorer, or an exception, showed", () => {
  test("a search for words starts on 'A message appears', watching those words", async () => {
    const form: MountedForm = await mount({
      monitorType: MonitorType.Logs,
      seedQuery: {
        monitorType: MonitorType.Logs,
        query: { messageContains: "payment declined" },
      },
    });

    await waitFor(() => {
      expect(firstStep(form.latest()).data?.logMonitor?.body).toBe(
        "payment declined",
      );
    });

    expect(onlyFilter(form.latest())).toMatchObject({
      filterType: FilterType.GreaterThan,
      value: 0,
    });
    expect(firstStep(form.latest()).data?.logMonitor?.severityTexts).toEqual(
      [],
    );
  });

  test("a Logs link's query is not put on a Traces monitor picked after following it", async () => {
    const form: MountedForm = await mount({
      monitorType: MonitorType.Traces,
      seedQuery: {
        monitorType: MonitorType.Logs,
        query: {
          messageContains: "payment declined",
          attributes: { tenant: "acme" },
        },
      },
    });

    await waitFor(() => {
      expect(onlyFilter(form.latest()).checkOn).toBe(CheckOn.SpanCount);
    });

    expect(firstStep(form.latest()).data?.traceMonitor?.attributes).toEqual({});
    expect(firstStep(form.latest()).data?.traceMonitor?.spanStatuses).toEqual([
      SpanStatus.Error,
    ]);
  });
});

describe("Create Monitor, after a walk back to Monitor Info and another type", () => {
  test("Logs, then Traces: the untouched Too many errors becomes Too many failed requests", async () => {
    const logs: MonitorSteps = await seededFor(MonitorType.Logs);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Traces,
      initialValue: logs,
      isCreating: true,
    });

    await waitFor(() => {
      expect(onlyFilter(form.latest()).checkOn).toBe(CheckOn.SpanCount);
    });

    expect(onlyFilter(form.latest())).toMatchObject({
      filterType: FilterType.GreaterThan,
      value: 10,
    });
    expect(firstStep(form.latest()).data?.traceMonitor?.spanStatuses).toEqual([
      SpanStatus.Error,
    ]);
    expect(instances(form.latest())[0]!.data!.alerts[0]!.title).toBe(
      "Checkout: too many failed requests",
    );
  });

  test("Website, then Logs: the out-of-the-box Website criteria become Too many errors, not 'no logs is offline'", async () => {
    const website: MonitorSteps = await seededFor(MonitorType.Website);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Logs,
      initialValue: website,
      isCreating: true,
    });

    await waitFor(() => {
      expect(onlyFilter(form.latest()).checkOn).toBe(CheckOn.LogCount);
    });

    expect(onlyFilter(form.latest())).toMatchObject({
      filterType: FilterType.GreaterThan,
      value: 10,
    });
    expect(
      instances(form.latest()).map((instance: MonitorCriteriaInstance) => {
        return instance.data!.name;
      }),
    ).not.toContain(`Check if ${MONITOR_NAME} is offline`);
  });

  test("Logs, then Website: the untouched rule gives way to Website's out-of-the-box criteria", async () => {
    const logs: MonitorSteps = await seededFor(MonitorType.Logs);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Website,
      initialValue: logs,
      isCreating: true,
    });

    await waitFor(() => {
      expect(
        instances(form.latest()).map((instance: MonitorCriteriaInstance) => {
          return instance.data!.name;
        }),
      ).toContain(`Check if ${MONITOR_NAME} is offline`);
    });
  });

  test("a rule somebody worked on is kept: only what the new type cannot draw is repaired", async () => {
    const logs: MonitorSteps = await seededFor(MonitorType.Logs);
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, logs)!;
    const worked: MonitorSteps = MonitorSteps.fromJSON(logs.toJSON());
    worked.setMonitorStepsInstanceArray([
      TelemetryAlertRuleUtil.write({
        monitorType: MonitorType.Logs,
        monitorStep: firstStep(logs),
        rule: {
          ...rule,
          threshold: 50,
          alert: { ...rule.alert!, title: "Checkout is throwing" },
        },
      }),
    ]);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Traces,
      initialValue: worked,
      isCreating: true,
    });

    await waitFor(() => {
      expect(form.changes.length).toBeGreaterThan(0);
    });

    // Not set up afresh: the person's title is still there.
    expect(
      instances(form.latest()).some((instance: MonitorCriteriaInstance) => {
        return instance.data!.alerts.some((alert: { title: string }) => {
          return alert.title === "Checkout is throwing";
        });
      }),
    ).toBe(true);
    expect(
      firstStep(form.latest()).data?.traceMonitor?.spanStatuses,
    ).not.toEqual([SpanStatus.Error]);
  });

  test("the same type again hands the untouched rule back as it was", async () => {
    const logs: MonitorSteps = await seededFor(MonitorType.Logs);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Logs,
      initialValue: logs,
      isCreating: true,
    });

    await waitFor(() => {
      expect(form.changes.length).toBeGreaterThan(0);
    });

    expect(ruleOf(MonitorType.Logs, form.latest())).toMatchObject({
      filterType: FilterType.GreaterThan,
      threshold: 10,
      windowInSeconds: 300,
    });
  });
});

describe("a metric chart's Create monitor, which hands in only its queries", () => {
  test("starts on the average above a value, over the chart's queries", async () => {
    // As Create Monitor builds it from the metricQueries link: no criteria.
    const handedIn: MonitorSteps = new MonitorSteps();
    const step: MonitorStep = firstStep(handedIn);
    step.setMetricMonitor({
      ...MonitorStepMetricMonitorUtil.getDefault(),
      rollingTime: RollingTime.Past1Hour,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "a",
              title: "",
              description: "",
              legend: "",
              legendUnit: "",
            },
            metricQueryData: {
              filterData: { metricName: "shop.queue.depth" },
            },
          },
        ],
        formulaConfigs: [],
      },
    });
    handedIn.setDefaultMonitorStatusId(new ObjectID(OPERATIONAL_ID));

    const form: MountedForm = await mount({
      monitorType: MonitorType.Metrics,
      initialValue: handedIn,
      isCreating: true,
    });

    await waitFor(() => {
      expect(onlyFilter(form.latest()).checkOn).toBe(CheckOn.MetricValue);
    });

    const rule: TelemetryAlertRule | null = ruleOf(
      MonitorType.Metrics,
      form.latest(),
    );

    expect(rule).toMatchObject({
      filterType: FilterType.GreaterThan,
      threshold: undefined,
      rollingTime: RollingTime.Past5Minutes,
      metricAggregationType: EvaluateOverTimeType.Average,
    });
    expect(
      firstStep(form.latest()).data?.metricMonitor?.metricViewConfig
        .queryConfigs[0]?.metricQueryData.filterData.metricName,
    ).toBe("shop.queue.depth");
  });

  test("a chart's threshold criteria are kept: they are what the link asked for", async () => {
    const handedIn: MonitorSteps = await seededFor(MonitorType.Metrics);
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Metrics, handedIn)!;
    const withValue: MonitorSteps = MonitorSteps.fromJSON(handedIn.toJSON());
    withValue.setMonitorStepsInstanceArray([
      TelemetryAlertRuleUtil.write({
        monitorType: MonitorType.Metrics,
        monitorStep: firstStep(handedIn),
        rule: {
          ...rule,
          threshold: 10000,
          metricAggregationType: EvaluateOverTimeType.AnyValue,
        },
      }),
    ]);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Metrics,
      initialValue: withValue,
      isCreating: true,
    });

    await waitFor(() => {
      expect(form.changes.length).toBeGreaterThan(0);
    });

    expect(ruleOf(MonitorType.Metrics, form.latest())).toMatchObject({
      threshold: 10000,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    });
  });
});

describe("a monitor that is not being created from scratch", () => {
  test("an edited monitor's criteria are handed back as they were", async () => {
    const logs: MonitorSteps = await seededFor(MonitorType.Logs);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Logs,
      initialValue: logs,
    });

    expect(form.latest().toJSON()).toEqual(logs.toJSON());
    expect(form.changes).toHaveLength(1);
  });

  test("a template's monitor keeps the old path: another type's defaults are re-seeded as defaults", async () => {
    const website: MonitorSteps = await seededFor(MonitorType.Website);

    const form: MountedForm = await mount({
      monitorType: MonitorType.Logs,
      initialValue: website,
      isCreating: false,
    });

    await waitFor(() => {
      expect(
        instances(form.latest()).map((instance: MonitorCriteriaInstance) => {
          return instance.data!.name;
        }),
      ).toContain(`Check if ${MONITOR_NAME} is offline`);
    });
  });
});
