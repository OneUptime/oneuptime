import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A Logs, Traces, Exceptions or Metrics monitor's Criteria page, read the
 * way the monitor was set up: When to alert in one sentence, What happens
 * (the alert or incident it opens, and the monitor's status while it
 * matches and otherwise), and the criteria behind it folded under
 * Criteria details. The rows the sentence already says (the time window)
 * are not said twice.
 *
 * Criteria that are more than one rule, and every other monitor type, read
 * as their criteria, as before - the default status below them.
 */

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStepMetricPreview",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="metric-preview-stub" />;
      },
    };
  },
);

import MonitorStepsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorSteps";
import {
  applyRecipe,
  getRecipe,
  TelemetryRuleRecipeKey,
  TelemetryRuleSeeds,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Color from "../../../Types/Color";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

const ENGLISH: Translator = createTranslator(undefined, "en");

// What a rule opens, as its line reads: the label, then the title.
const ALERT_LINE: RegExp = /^Creates an alert:\s*Checkout: too many errors/;
const REQUESTS_STOPPED_LINE: RegExp =
  /^Declares an incident:\s*Checkout: requests stopped/;
const OFFLINE_LINE: RegExp = /^Declares an incident:\s*Checkout is offline/;

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const OPERATIONAL: string = "11111111-1111-4111-8111-111111111111";
const DEGRADED: string = "22222222-2222-4222-8222-222222222222";
const OFFLINE: string = "33333333-3333-4333-8333-333333333333";
const INCIDENT_SEVERITY: string = "44444444-4444-4444-8444-444444444444";
const ALERT_SEVERITY: string = "55555555-5555-4555-8555-555555555555";

const SEEDS: TelemetryRuleSeeds = {
  monitorName: "Checkout",
  operationalStatusId: new ObjectID(OPERATIONAL),
  degradedStatusId: new ObjectID(DEGRADED),
  offlineStatusId: new ObjectID(OFFLINE),
  incidentSeverityId: new ObjectID(INCIDENT_SEVERITY),
  alertSeverityId: new ObjectID(ALERT_SEVERITY),
};

function listOf<T>(data: Array<T>): unknown {
  return { data, count: data.length, skip: 0, limit: 50 };
}

function status(
  id: string,
  name: string,
  flags: Partial<MonitorStatus>,
): MonitorStatus {
  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus._id = id;
  monitorStatus.name = name;
  monitorStatus.color = new Color("#16a34a");
  Object.assign(monitorStatus, flags);
  return monitorStatus;
}

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((request: { modelType: unknown }): never => {
      if (request.modelType === MonitorStatus) {
        return Promise.resolve(
          listOf([
            status(OPERATIONAL, "Operational", { isOperationalState: true }),
            status(DEGRADED, "Degraded", {}),
            status(OFFLINE, "Offline", { isOfflineState: true }),
          ]),
        ) as never;
      }

      if (request.modelType === IncidentSeverity) {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = INCIDENT_SEVERITY;
        severity.name = "Critical";
        severity.color = new Color("#dc2626");
        return Promise.resolve(listOf([severity])) as never;
      }

      if (request.modelType === AlertSeverity) {
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = ALERT_SEVERITY;
        severity.name = "High";
        severity.color = new Color("#ea580c");
        return Promise.resolve(listOf([severity])) as never;
      }

      return Promise.resolve(listOf([])) as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function stepsOf(step: MonitorStep): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.setMonitorStepsInstanceArray([step]);
  steps.setDefaultMonitorStatusId(new ObjectID(OPERATIONAL));
  return steps;
}

function recipeStep(key: TelemetryRuleRecipeKey): MonitorStep {
  return applyRecipe({
    monitorStep: new MonitorStep(),
    recipe: getRecipe(key)!,
    seeds: SEEDS,
    translator: ENGLISH,
  });
}

async function renderPage(
  monitorType: MonitorType,
  steps: MonitorSteps,
): Promise<void> {
  render(<MonitorStepsView monitorType={monitorType} monitorSteps={steps} />);

  await act(async () => {
    for (let i: number = 0; i < 30; i++) {
      await Promise.resolve();
    }
  });
}

describe("a monitor whose criteria are one rule", () => {
  test("reads as the rule: its sentence, what it opens, and the monitor's status both ways", async () => {
    await renderPage(
      MonitorType.Logs,
      stepsOf(recipeStep(TelemetryRuleRecipeKey.ErrorLogs)),
    );

    expect(
      screen.getByTestId("telemetry-rule-summary-sentence"),
    ).toHaveTextContent(
      "Alerts when the number of matching logs in 5 minutes is more than 10.",
    );
    expect(
      screen.getByTestId("telemetry-rule-summary-alert"),
    ).toHaveTextContent(ALERT_LINE);
    expect(
      screen.getByTestId("telemetry-rule-summary-alert"),
    ).toHaveTextContent("High");
    expect(
      screen.queryByTestId("telemetry-rule-summary-incident"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("telemetry-rule-summary-status"),
    ).toHaveTextContent(
      "Monitor status: Degraded while the rule matches, Operational otherwise.",
    );
    // The default status is said in the rule's summary, not again below.
    expect(
      screen.queryByTestId("monitor-default-status-summary"),
    ).not.toBeInTheDocument();
  });

  test("its criteria wait, folded, under Criteria details", async () => {
    await renderPage(
      MonitorType.Logs,
      stepsOf(recipeStep(TelemetryRuleRecipeKey.ErrorLogs)),
    );

    const details: HTMLElement = screen.getByRole("button", {
      name: "Criteria details",
    });

    expect(details).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(details);

    expect(details).toHaveAttribute("aria-expanded", "true");
  });

  test("the filters are listed in the form's words, and the window only in the sentence", async () => {
    const step: MonitorStep = recipeStep(TelemetryRuleRecipeKey.ErrorLogs);
    step.setLogMonitor({
      ...step.data!.logMonitor!,
      body: "payment declined",
    });

    await renderPage(MonitorType.Logs, stepsOf(step));

    expect(screen.getByText("Message contains")).toBeInTheDocument();
    expect(screen.getByText("payment declined")).toBeInTheDocument();
    expect(screen.getByText("Log Severity")).toBeInTheDocument();
    expect(screen.queryByText("Time window")).not.toBeInTheDocument();
  });

  test("an incident rule says what it declares, at its severity", async () => {
    await renderPage(
      MonitorType.Traces,
      stepsOf(recipeStep(TelemetryRuleRecipeKey.SpansStop)),
    );

    expect(
      screen.getByTestId("telemetry-rule-summary-sentence"),
    ).toHaveTextContent("Alerts when no matching spans arrive in 10 minutes.");
    expect(
      screen.getByTestId("telemetry-rule-summary-incident"),
    ).toHaveTextContent(REQUESTS_STOPPED_LINE);
    expect(
      screen.getByTestId("telemetry-rule-summary-incident"),
    ).toHaveTextContent("Critical");
    expect(
      screen.getByTestId("telemetry-rule-summary-status"),
    ).toHaveTextContent(
      "Monitor status: Offline while the rule matches, Operational otherwise.",
    );
  });

  test("a monitor made before the rule editor reads as its rule too: out-of-the-box criteria and all", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setLogMonitor(MonitorStepLogMonitorUtil.getDefault());
    step.setMonitorCriteria(
      MonitorCriteria.getDefaultMonitorCriteria({
        monitorType: MonitorType.Logs,
        monitorName: "Checkout",
        onlineMonitorStatusId: new ObjectID(OPERATIONAL),
        offlineMonitorStatusId: new ObjectID(OFFLINE),
        defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY),
        defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY),
      }),
    );

    await renderPage(MonitorType.Logs, stepsOf(step));

    expect(
      screen.getByTestId("telemetry-rule-summary-sentence"),
    ).toHaveTextContent("Alerts when no matching logs arrive in 1 minute.");
    expect(
      screen.getByTestId("telemetry-rule-summary-incident"),
    ).toHaveTextContent(OFFLINE_LINE);
  });

  test("a rule that only changes the status says so", async () => {
    const step: MonitorStep = recipeStep(TelemetryRuleRecipeKey.ErrorLogs);
    const rule: TelemetryAlertRule = TelemetryAlertRuleUtil.read({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      defaultMonitorStatusId: new ObjectID(OPERATIONAL),
    }).rule!;

    await renderPage(
      MonitorType.Logs,
      stepsOf(
        TelemetryAlertRuleUtil.write({
          monitorType: MonitorType.Logs,
          monitorStep: step,
          rule: { ...rule, action: TelemetryAlertRuleAction.StatusOnly },
        }),
      ),
    );

    expect(
      screen.getByTestId("telemetry-rule-summary-status-only"),
    ).toHaveTextContent(
      "Changes the monitor's status, and opens no alert or incident.",
    );
  });
});

describe("criteria that are not one rule, and other monitor types", () => {
  test("several rules read as their criteria, with the default status below", async () => {
    const step: MonitorStep = recipeStep(TelemetryRuleRecipeKey.ErrorLogs);
    const all: Array<MonitorCriteriaInstance> = [
      TelemetryRuleRecipeKey.ErrorLogs,
      TelemetryRuleRecipeKey.LogsStop,
      TelemetryRuleRecipeKey.LogMessage,
    ].map((key: TelemetryRuleRecipeKey) => {
      return recipeStep(key).data!.monitorCriteria!.data!
        .monitorCriteriaInstanceArray[0]!;
    });
    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: all };
    step.setMonitorCriteria(criteria);

    await renderPage(MonitorType.Logs, stepsOf(step));

    expect(
      screen.queryByTestId("telemetry-rule-summary"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Criteria")).toBeInTheDocument();
    expect(
      screen.getByTestId("monitor-default-status-summary"),
    ).toBeInTheDocument();
    // The window is a row of its own then: no sentence says it.
    expect(screen.getByText("Time window")).toBeInTheDocument();
  });

  test("a Website monitor reads as its criteria, as before", async () => {
    const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
      monitorType: MonitorType.Website,
      monitorName: "Checkout",
      defaultMonitorStatusId: new ObjectID(OPERATIONAL),
      onlineMonitorStatusId: new ObjectID(OPERATIONAL),
      offlineMonitorStatusId: new ObjectID(OFFLINE),
      defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY),
      defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY),
    });

    await renderPage(MonitorType.Website, steps);

    expect(
      screen.queryByTestId("telemetry-rule-summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("monitor-default-status-summary"),
    ).toBeInTheDocument();
  });
});
