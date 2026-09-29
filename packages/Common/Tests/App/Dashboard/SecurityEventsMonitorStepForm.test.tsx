import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import SecurityEventsMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm";
import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";

/*
 * The step form's field gating IS the feature here: Event Class and — as
 * of issue #3398 — Event Severity live outside the "Show Advanced
 * Options" toggle, because hiding them read as "monitors cannot filter
 * by class/severity" to anyone who did not know the toggle existed.
 * Only the service and attribute filters stay behind it. No other test
 * renders this form (the view-model and type tests cover different
 * layers), so without this one a refactor could quietly put a field
 * back behind the toggle and nothing would fail.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const TELEMETRY_SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function renderForm(config?: Partial<MonitorStepSecurityEventsMonitor>): void {
  render(
    <SecurityEventsMonitorStepForm
      monitorStepSecurityEventsMonitor={{
        ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
        ...(config || {}),
      }}
      onMonitorStepSecurityEventsMonitorChanged={() => {
        // no-op
      }}
      telemetryServices={[]}
    />,
  );
}

describe("SecurityEventsMonitorStepForm field gating", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    // The live preview polls the event count; keep it quiet and offline.
    jest.spyOn(AnalyticsModelAPI, "count").mockResolvedValue(0 as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("severity and class are visible without opening advanced options", async () => {
    renderForm();

    // findBy: lets the preview's initial async count resolve inside act.
    expect(await screen.findByText("Event Severity")).toBeInTheDocument();
    expect(screen.getByText("Event Class")).toBeInTheDocument();
    expect(screen.getByText("Show Advanced Options")).toBeInTheDocument();
  });

  test("service and attribute filters stay behind the toggle", async () => {
    renderForm();

    await screen.findByText("Event Class");

    expect(
      screen.queryByText("Filter by Telemetry Service"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Filter by Attributes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Show Advanced Options"));

    expect(screen.getByText("Filter by Telemetry Service")).toBeInTheDocument();
    expect(screen.getByText("Filter by Attributes")).toBeInTheDocument();
  });

  test("a stored severity filter alone no longer forces the advanced section open", async () => {
    /*
     * severityNames left the auto-open heuristic together with the
     * toggle: the field is always on screen now, so a monitor that only
     * filters by severity has nothing hidden worth revealing.
     */
    renderForm({ severityNames: ["High" as never] });

    expect(await screen.findByText("Event Severity")).toBeInTheDocument();
    expect(
      screen.queryByText("Filter by Telemetry Service"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Show Advanced Options")).toBeInTheDocument();
  });

  test("a stored class filter alone does not force the advanced section open", async () => {
    renderForm({ classNames: ["Detection Finding"] });

    expect(await screen.findByText("Event Class")).toBeInTheDocument();
    expect(
      screen.queryByText("Filter by Telemetry Service"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Show Advanced Options")).toBeInTheDocument();
  });

  test("a stored telemetry-service filter still opens the advanced section by itself", async () => {
    /*
     * Editing a monitor whose config uses a filter that IS still
     * advanced must show that filter immediately — the auto-open
     * behaviour severityNames used to share before it stopped being
     * advanced.
     */
    renderForm({ telemetryServiceIds: [TELEMETRY_SERVICE_ID] });

    expect(
      await screen.findByText("Filter by Telemetry Service"),
    ).toBeInTheDocument();
    expect(screen.getByText("Hide Advanced Options")).toBeInTheDocument();
  });

  test("a stored attribute filter still opens the advanced section by itself", async () => {
    renderForm({ attributes: { "user.name": "root" } });

    expect(await screen.findByText("Filter by Attributes")).toBeInTheDocument();
    expect(screen.getByText("Hide Advanced Options")).toBeInTheDocument();

    /*
     * The stored entry hydrates a dictionary row, and that row must
     * carry the operator dropdown — the same operator restore the
     * Log/Trace monitors rely on.
     */
    expect(screen.getByText("Operator")).toBeInTheDocument();
  });

  test("the attributes filter offers an operator on every new entry", async () => {
    /*
     * dictionaryEnableOperators is the other half of #3398: without it
     * the dictionary renders a fixed "=" between key and value; with it
     * each row gets an "Operator" dropdown (contains, is any of, ...).
     */
    renderForm();

    await screen.findByText("Event Class");

    fireEvent.click(screen.getByText("Show Advanced Options"));

    // No rows yet, so no per-row controls either.
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Add Filter by Attributes"));

    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("Key")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });
});
