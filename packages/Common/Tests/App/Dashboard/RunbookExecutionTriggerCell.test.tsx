import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import RunbookExecutionTriggerCell, {
  RUNBOOK_EXECUTION_TRIGGER_CELL_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookExecutionTriggerCell";
import RunbookRunInputs, {
  RUNBOOK_RUN_INPUTS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookRunInputs";
import Incident from "../../../Models/DatabaseModels/Incident";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import RunbookTriggerType from "../../../Types/Runbook/RunbookTriggerType";
import Timezone from "../../../Types/Timezone";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * WHAT STARTED A RUN, ON BOTH EXECUTIONS LISTS - AND WHAT A WEBHOOK SENT.
 *
 * Before triggers were recorded, a run nobody started by hand and no rule
 * started for an incident read "Manual / unknown". A run started by its
 * schedule now says Schedule and when it was due; one started by its
 * webhook says Webhook and the address that called it. The rest read as
 * they did. A run's page shows the values its webhook call sent, as JSON
 * text - they came from outside, so nothing in them is ever markup.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4b3a2c10-8d7e-4f6a-9b5c-1d2e3f4a5b01",
);

beforeEach(() => {
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(OneUptimeDate, "getCurrentTimezone").mockReturnValue(
    "UTC" as Timezone,
  );
  getJestSpyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(
    false,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function run(data: {
  triggerType?: RunbookTriggerType;
  triggerDetails?: JSONObject;
  incident?: Incident;
  triggeredByUser?: User;
}): RunbookExecution {
  const execution: RunbookExecution = new RunbookExecution();
  execution._id = "4b3a2c10-8d7e-4f6a-9b5c-1d2e3f4a5b02";

  if (data.triggerType) {
    execution.triggerType = data.triggerType;
  }

  if (data.triggerDetails) {
    execution.triggerDetails = data.triggerDetails;
  }

  if (data.incident) {
    execution.incident = data.incident;
  }

  if (data.triggeredByUser) {
    execution.triggeredByUser = data.triggeredByUser;
  }

  return execution;
}

function cell(execution: RunbookExecution): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <RunbookExecutionTriggerCell execution={execution} />
    </MemoryRouter>,
  );

  return container;
}

describe("the Triggered by column", () => {
  test("reads what it shows: the incident, alert, maintenance event and person, and the trigger", () => {
    expect(RUNBOOK_EXECUTION_TRIGGER_CELL_SELECT).toEqual({
      incident: { _id: true, title: true },
      alert: { _id: true, title: true },
      scheduledMaintenance: { _id: true, title: true },
      triggeredByUser: {
        _id: true,
        name: true,
        email: true,
        profilePictureId: true,
      },
      triggerType: true,
      triggerDetails: true,
    });
  });

  test("a scheduled run says Schedule and when it was due", () => {
    const container: HTMLElement = cell(
      run({
        triggerType: RunbookTriggerType.Schedule,
        triggerDetails: { scheduledFor: "2026-10-15T09:00:00.000Z" },
      }),
    );

    const root: HTMLElement = container.querySelector(
      "[data-trigger]",
    ) as HTMLElement;
    expect(root).toHaveAttribute("data-trigger", RunbookTriggerType.Schedule);
    expect(within(root).getByText("Schedule")).toBeInTheDocument();
    expect(
      within(root).getByText("Due at Oct 15 2026, 09:00 UTC"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Manual / unknown")).not.toBeInTheDocument();
  });

  test("a scheduled run that made up for missed times says so under its time", () => {
    cell(
      run({
        triggerType: RunbookTriggerType.Schedule,
        triggerDetails: {
          scheduledFor: "2026-10-15T09:00:00.000Z",
          isCatchUp: true,
        },
      }),
    );

    expect(
      screen.getByText("Run once to make up for times OneUptime missed"),
    ).toBeInTheDocument();
  });

  test("a scheduled run with no time recorded still says Schedule", () => {
    cell(run({ triggerType: RunbookTriggerType.Schedule }));

    expect(screen.getByText("Trigger")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
  });

  test("a webhook run says Webhook and the address that called it", () => {
    cell(
      run({
        triggerType: RunbookTriggerType.Webhook,
        triggerDetails: { callerIp: "198.51.100.23" },
      }),
    );

    expect(screen.getByText("Webhook")).toBeInTheDocument();
    expect(screen.getByText("From 198.51.100.23")).toBeInTheDocument();
  });

  test("a rule's run still names its incident, and a person's run the person", () => {
    const incident: Incident = new Incident();
    incident._id = "4b3a2c10-8d7e-4f6a-9b5c-1d2e3f4a5b03";
    incident.title = "Checkout is down";

    cell(run({ triggerType: RunbookTriggerType.Rule, incident }));
    expect(screen.getByText("Incident")).toBeInTheDocument();
    expect(screen.getByText("Checkout is down")).toBeInTheDocument();

    cleanup();

    const user: User = new User();
    user._id = "4b3a2c10-8d7e-4f6a-9b5c-1d2e3f4a5b04";
    user.name = new Name("Ada Lovelace");
    user.email = new Email("ada@example.com");

    cell(
      run({ triggerType: RunbookTriggerType.Manual, triggeredByUser: user }),
    );
    expect(screen.getByText("Manual run by")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  test("a run from before triggers were recorded reads as it did", () => {
    cell(run({}));

    expect(screen.getByText("Manual / unknown")).toBeInTheDocument();
  });
});

describe("the Inputs a webhook sent, on the run's page", () => {
  test("are shown as JSON text, with how the steps read them", () => {
    render(
      <RunbookRunInputs
        inputs={{
          host: "web-1",
          "<b>bold</b>": "<img src=x onerror=alert(1)>",
        }}
      />,
    );

    const box: HTMLElement = screen.getByTestId(RUNBOOK_RUN_INPUTS_TEST_ID);
    expect(within(box).getByText("Inputs")).toBeInTheDocument();
    expect(
      within(box).getByText(
        "The values the webhook call sent. The steps read them as data: a Bash step as environment variables such as ONEUPTIME_INPUT_HOST, a JavaScript step as args.inputs.",
      ),
    ).toBeInTheDocument();

    const code: HTMLElement = box.querySelector("pre code") as HTMLElement;
    expect(JSON.parse(code.textContent || "")).toEqual({
      host: "web-1",
      "<b>bold</b>": "<img src=x onerror=alert(1)>",
    });

    // Text, never markup.
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelector("b")).toBeNull();
  });
});
