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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import SecurityLogsSourceCard, {
  SECURITY_LOGS_SOURCE_CARD_ID,
  readFoundByFormat,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsSourceCard";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ObjectID from "../../../Types/ObjectID";
import { SECURITY_LOG_FORMATS } from "../../../Types/SecurityEvent/SecurityLogFormat";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * "Your logs" on the Connections page: one switch that saves when it is
 * flipped - creating the project's record the first time, updating it after
 * - what the last check found, and every log format OneUptime recognizes.
 * ModelAPI is the card's only door to the server, so it is what is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const NOW: Date = new Date("2026-10-19T12:00:00Z");

function source(overrides: Partial<SecurityLogSource> = {}): SecurityLogSource {
  const value: SecurityLogSource = new SecurityLogSource();
  value.id = SOURCE_ID;
  value.projectId = PROJECT_ID;
  value.isEnabled = true;
  Object.assign(value, overrides);
  return value;
}

let stored: Array<SecurityLogSource> = [];

beforeEach(() => {
  stored = [];
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(ModelAPI, "getList").mockImplementation(async () => {
    return {
      data: [...stored],
      count: stored.length,
      skip: 0,
      limit: 1,
    } as never;
  });
  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (data: { model: unknown }) => {
      const created: SecurityLogSource = data.model as SecurityLogSource;
      stored = [source({ isEnabled: created.isEnabled === true })];
      return new HTTPResponse(200, {}, {}) as never;
    });
  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (data: { data: unknown }) => {
      stored = [
        source({
          ...stored[0],
          ...(data.data as Partial<SecurityLogSource>),
        } as Partial<SecurityLogSource>),
      ];
      return new HTTPResponse(200, {}, {}) as never;
    });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async () => {
    render(<SecurityLogsSourceCard />);
  });
  await waitFor(() => {
    expect(theSwitch()).not.toHaveAttribute("aria-disabled", "true");
  });
}

function theSwitch(): HTMLElement {
  return screen.getByRole("switch", {
    name: "Find security events in your logs",
  });
}

async function flip(): Promise<void> {
  await act(async () => {
    fireEvent.click(theSwitch());
  });
}

describe("Your logs", () => {
  test("a project that never turned it on: off, with every format OneUptime recognizes listed", async () => {
    await renderCard();

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("security-logs-source-status")).toBeNull();

    const card: HTMLElement = screen.getByTestId(SECURITY_LOGS_SOURCE_CARD_ID);

    expect(
      SECURITY_LOG_FORMATS.map((format: { format: string }) => {
        return (
          within(card)
            .getByTestId(`security-log-format-${format.format}`)
            .querySelector("p")?.textContent || ""
        );
      }),
    ).toEqual([
      "SSH sign-ins",
      "sudo",
      "Kubernetes audit logs",
      "AWS CloudTrail",
      "Web attacks",
    ]);
  });

  test("the first flip creates the project's record, on, and says it saved", async () => {
    await renderCard();
    await flip();

    expect(ModelAPI.create).toHaveBeenCalledTimes(1);

    const created: SecurityLogSource = jest.mocked(ModelAPI.create).mock
      .calls[0]![0].model as SecurityLogSource;

    expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created.isEnabled).toBe(true);
    expect(ModelAPI.updateById).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.getByTestId("security-logs-source-saving")).toHaveTextContent(
      "Saved",
    );
    expect(screen.getByTestId("security-logs-source-status")).toHaveTextContent(
      "The first check runs within a minute. No security event found yet.",
    );
  });

  test("a later flip updates the record it has, by id, and nothing else", async () => {
    stored = [source({ isEnabled: true })];
    await renderCard();

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");

    await flip();

    expect(ModelAPI.create).not.toHaveBeenCalled();
    expect(ModelAPI.updateById).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityLogSource,
        id: SOURCE_ID,
        data: { isEnabled: false },
      }),
    );
    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.queryByTestId("security-logs-source-status")).toBeNull();
  });

  test("on: when it last checked, when it last found something, and what the last check found by format", async () => {
    stored = [
      source({
        lastScannedAt: new Date(NOW.getTime() - 2 * 60_000),
        lastEventFoundAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
        lastScanResult: {
          logsRead: 40,
          eventsFound: 3,
          byFormat: { "ssh-sign-in": 3, sudo: 0 },
        },
      }),
    ];
    await renderCard();

    expect(screen.getByTestId("security-logs-source-status")).toHaveTextContent(
      "Checked 2 minutes ago. Last security event found 3 hours ago.",
    );
    expect(
      screen.getByTestId("security-log-format-ssh-sign-in"),
    ).toHaveTextContent("Found in the last check: 3");
    expect(
      screen.getByTestId("security-log-format-sudo"),
    ).not.toHaveTextContent("Found in the last check");
  });

  test("a check that failed says so, with the reason", async () => {
    stored = [source({ lastError: "ClickHouse did not answer in time." })];
    await renderCard();

    expect(
      screen.getByTestId("security-logs-source-last-error"),
    ).toHaveTextContent(
      "The last check failed: ClickHouse did not answer in time.",
    );
  });

  test("a save the server refuses keeps the switch where it was and says why", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(new Error("Your plan does not include this."));
    await renderCard();
    await flip();

    expect(
      await screen.findByTestId("security-logs-source-error"),
    ).toHaveTextContent("Your plan does not include this.");
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("whoever may not turn it on finds the switch locked, and pressing it saves nothing", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need Security Admin to change this.",
    });
    await act(async () => {
      render(<SecurityLogsSourceCard />);
    });

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");

    await flip();

    expect(ModelAPI.create).not.toHaveBeenCalled();
  });
});

describe("readFoundByFormat", () => {
  test("keeps the formats that found something, whatever else the result holds", () => {
    expect(
      readFoundByFormat({
        byFormat: { "ssh-sign-in": 2, sudo: 0, "web-attack": -1, x: "y" },
      }),
    ).toEqual({ "ssh-sign-in": 2 });
    expect(readFoundByFormat(undefined)).toEqual({});
    expect(readFoundByFormat({ byFormat: [1, 2] })).toEqual({});
  });
});
