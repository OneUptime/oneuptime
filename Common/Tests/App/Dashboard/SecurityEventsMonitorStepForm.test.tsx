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
 * The step form's field gating IS the feature here: Event Class was moved
 * out from behind the "Show Advanced Options" toggle so that watching
 * Detection Findings — the single most useful class filter — no longer
 * requires knowing the toggle exists. No other test renders this form
 * (the view-model and type tests cover different layers), so without
 * this one a refactor could quietly put the field back behind the toggle
 * and nothing would fail.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
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

  test("Event Class is visible without opening advanced options", async () => {
    renderForm();

    // findBy: lets the preview's initial async count resolve inside act.
    expect(await screen.findByText("Event Class")).toBeInTheDocument();
    expect(screen.getByText("Show Advanced Options")).toBeInTheDocument();
  });

  test("severity, service and attribute filters stay behind the toggle", async () => {
    renderForm();

    await screen.findByText("Event Class");

    expect(screen.queryByText("Event Severity")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Filter by Telemetry Service"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Filter by Attributes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Show Advanced Options"));

    expect(screen.getByText("Event Severity")).toBeInTheDocument();
    expect(screen.getByText("Filter by Telemetry Service")).toBeInTheDocument();
    expect(screen.getByText("Filter by Attributes")).toBeInTheDocument();
  });

  test("a stored severity filter still opens the advanced section by itself", async () => {
    /*
     * Editing a monitor whose config uses an advanced filter must show
     * that filter immediately — the auto-open behaviour classNames used
     * to share before it stopped being advanced.
     */
    renderForm({ severityNames: ["High" as never] });

    expect(await screen.findByText("Event Severity")).toBeInTheDocument();
    expect(screen.getByText("Hide Advanced Options")).toBeInTheDocument();
  });

  test("a stored class filter alone no longer forces the advanced section open", async () => {
    renderForm({ classNames: ["Detection Finding"] });

    expect(await screen.findByText("Event Class")).toBeInTheDocument();
    expect(screen.queryByText("Event Severity")).not.toBeInTheDocument();
    expect(screen.getByText("Show Advanced Options")).toBeInTheDocument();
  });
});
