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
  SECURITY_LOG_FORMAT_GROUPS_CLASS_NAME,
  SECURITY_LOG_FORMAT_HEALTH_DOT_CLASS_NAMES,
  getSecurityLogFormatHealth,
  readFoundByFormat,
  readScanProgress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsSourceCard";
import {
  SECURITY_LOGS_CASE_SEVERITY_TEST_ID,
  getYourLogsCaseSeverityChoice,
  getYourLogsCaseSeverityOptions,
  getYourLogsCaseSeverityWrite,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsCaseSeverity";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
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

// A column count keyed to the window's width (sm:, md:, lg:, xl:, 2xl:).
const WINDOW_COLUMNS: RegExp = /(?:^|\s)(?:sm|md|lg|xl|2xl):grid-cols-/;

// Any column count at all, of a grid of tiles.
const GRID_COLUMNS: RegExp = /grid-cols-/;

// A kind's health line, or the dot in front of it.
const HEALTH_TEST_ID: RegExp = /^security-log-format-health-/;

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
      "Windows events",
      "AWS CloudTrail",
      "Google Cloud audit logs",
      "Azure activity and Entra ID logs",
      "CEF",
      "LEEF",
      "Palo Alto Networks",
      "Fortinet FortiGate",
      "Cisco ASA",
      "Kubernetes audit logs",
      "Web attacks",
    ]);
    // Off, no kind says what was found of it.
    expect(
      within(card).queryByTestId("security-log-format-health-cef"),
    ).toBeNull();
  });

  test("the kinds are grouped by where they come from, each group under its name", async () => {
    await renderCard();

    const groups: Array<[string, Array<string>]> = [
      ["servers", ["ssh-sign-in", "sudo", "windows-events"]],
      ["cloud", ["aws-cloudtrail", "google-cloud-audit", "azure-activity"]],
      [
        "security-devices",
        ["cef", "leef", "palo-alto", "fortigate", "cisco-asa"],
      ],
      ["applications", ["kubernetes-audit", "web-attack"]],
    ];

    expect(
      groups.map(([group, formats]: [string, Array<string>]) => {
        const section: HTMLElement = screen.getByTestId(
          `security-log-format-group-${group}`,
        );

        return [
          within(section).getByRole("heading").textContent,
          formats.every((format: string): boolean => {
            return section.contains(
              screen.getByTestId(`security-log-format-${format}`),
            );
          }),
        ];
      }),
    ).toEqual([
      ["Servers", true],
      ["Cloud", true],
      ["Security devices", true],
      ["Applications", true],
    ]);
    expect(
      screen.getByRole("region", { name: "Security devices" }),
    ).toBeInTheDocument();
  });

  /*
   * Each group is one list, a kind a row, as Your OneUptime data lists its
   * sources: ten bordered tiles in rows of three left two groups with an
   * empty third of a row, and made the card the page's longest. The groups
   * pair up side by side from 44rem of the card's own width - beside the
   * side menu the card is about 370px wide at a 768 window, whatever the
   * window says. The browser suite measures them.
   */
  test("each group is one list, a kind a row, and the groups take their columns from the card's width", async () => {
    await renderCard();

    const groups: HTMLElement = screen.getByTestId(
      "security-log-format-groups",
    );
    expect(groups.parentElement).toHaveClass("[container-type:inline-size]");
    expect(groups).toHaveClass(
      "grid",
      "grid-cols-1",
      "[@container(min-width:44rem)]:grid-cols-2",
    );
    expect(groups.className).toBe(SECURITY_LOG_FORMAT_GROUPS_CLASS_NAME);
    // No column count from the window: md and xl are the window's widths.
    expect(groups.className).not.toMatch(WINDOW_COLUMNS);

    expect(
      Array.from(groups.children).map((child: Element): string | null => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual([
      "security-log-format-group-servers",
      "security-log-format-group-cloud",
      "security-log-format-group-security-devices",
      "security-log-format-group-applications",
    ]);

    for (const group of [
      "servers",
      "cloud",
      "security-devices",
      "applications",
    ]) {
      const kinds: HTMLElement = screen.getByTestId(
        `security-log-format-group-${group}-kinds`,
      );
      // One bordered list, its rows divided: never a grid of tiles.
      expect(kinds.tagName).toBe("UL");
      expect(kinds).toHaveClass(
        "divide-y",
        "divide-gray-100",
        "rounded-lg",
        "border",
        "border-gray-200",
      );
      expect(kinds.className).not.toMatch(GRID_COLUMNS);

      for (const kind of Array.from(kinds.children)) {
        expect(kind.tagName).toBe("LI");
        // A row draws no box of its own: its list does.
        expect(kind).not.toHaveClass("border");
        expect(kind).not.toHaveClass("rounded-lg");
      }
    }
  });

  test("on: each kind says what the last check found of it, when one was last found, or that none has been", async () => {
    stored = [
      source({
        lastScannedAt: new Date(NOW.getTime() - 60_000),
        lastEventFoundAt: new Date(NOW.getTime() - 60_000),
        lastScanResult: {
          logsRead: 400,
          eventsFound: 2,
          byFormat: { cef: 2 },
          lastFoundAtByFormat: {
            cef: new Date(NOW.getTime() - 60_000).toISOString(),
            "windows-events": new Date(
              NOW.getTime() - 26 * 60 * 60_000,
            ).toISOString(),
          },
        },
      }),
    ];
    await renderCard();

    expect(
      screen.getByTestId("security-log-format-health-cef"),
    ).toHaveTextContent("Found in the last check: 2");
    expect(
      screen.getByTestId("security-log-format-health-windows-events"),
    ).toHaveTextContent("Last found 1 day ago");
    expect(
      screen.getByTestId("security-log-format-health-leef"),
    ).toHaveTextContent("None found yet");
  });

  /*
   * A dot in front of each health line reads down the list at a glance:
   * green while the last check found some, grey once some were found
   * before, an empty ring while none has been. The words say the same, so
   * the dot is hidden from screen readers; "None found yet" is gray-500, as
   * readable as the rest of the card's small text (gray-400 on white is
   * 2.5:1).
   */
  test("on: a dot in front of each kind's health says found now, found before or never", async () => {
    stored = [
      source({
        lastScannedAt: new Date(NOW.getTime() - 60_000),
        lastScanResult: {
          byFormat: { cef: 2 },
          lastFoundAtByFormat: {
            cef: new Date(NOW.getTime() - 60_000).toISOString(),
            "windows-events": new Date(
              NOW.getTime() - 26 * 60 * 60_000,
            ).toISOString(),
          },
        },
      }),
    ];
    await renderCard();

    const expected: Array<[string, string, string, string]> = [
      ["cef", "found-now", "bg-emerald-500", "text-emerald-700"],
      ["windows-events", "found-before", "bg-gray-300", "text-gray-600"],
      ["leef", "not-yet", "border-gray-300", "text-gray-500"],
    ];

    for (const [format, health, dot, text] of expected) {
      const line: HTMLElement = screen.getByTestId(
        `security-log-format-health-${format}`,
      );
      const mark: HTMLElement = screen.getByTestId(
        `security-log-format-health-dot-${format}`,
      );

      expect([format, line.getAttribute("data-health")]).toEqual([
        format,
        health,
      ]);
      expect(line).toHaveClass(text);
      expect(line).not.toHaveClass("text-gray-400");
      expect(line.firstElementChild).toBe(mark);
      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(mark).toHaveClass("rounded-full", dot);
      expect(mark.className).toContain(
        SECURITY_LOG_FORMAT_HEALTH_DOT_CLASS_NAMES[
          health as "found-now" | "found-before" | "not-yet"
        ],
      );
    }
  });

  test("off: no kind says anything of its health", async () => {
    await renderCard();

    expect(screen.queryAllByTestId(HEALTH_TEST_ID)).toHaveLength(0);
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

  test("a check that stopped part way through a busy stretch says the next goes on from there", async () => {
    stored = [
      source({
        lastScannedAt: new Date(NOW.getTime() - 60_000),
        lastScanResult: {
          logsRead: 50000,
          eventsFound: 0,
          byFormat: {},
          partialWindowStart: "2026-10-19T11:40:00.000Z",
          partialWindowProcessed: 50000,
        },
      }),
    ];
    await renderCard();

    expect(screen.getByTestId("security-logs-source-status")).toHaveTextContent(
      "Catching up on a busy stretch of logs: the next check goes on where this one stopped.",
    );
    expect(screen.queryByTestId("security-logs-source-skipped")).toBeNull();
  });

  test("a check that fell more than a day behind names the logs it skipped", async () => {
    const from: string = "2026-10-17T06:00:00.000Z";
    const to: string = "2026-10-18T12:00:00.000Z";
    stored = [
      source({
        lastScannedAt: new Date(NOW.getTime() - 60_000),
        lastScanResult: {
          logsRead: 10,
          eventsFound: 0,
          byFormat: {},
          skippedBacklog: true,
          skippedFrom: from,
          skippedTo: to,
        },
      }),
    ];
    await renderCard();

    expect(
      screen.getByTestId("security-logs-source-skipped"),
    ).toHaveTextContent(
      `The checks fell more than a day behind and skipped the logs that arrived between ${OneUptimeDate.getDateAsLocalFormattedString(
        new Date(from),
      )} and ${OneUptimeDate.getDateAsLocalFormattedString(new Date(to))}.`,
    );
    // It caught up to the present: nothing left part way.
    expect(
      screen.getByTestId("security-logs-source-status"),
    ).not.toHaveTextContent("Catching up");
  });

  test("a project that turned it off is not told about logs skipped while it was on", async () => {
    stored = [
      source({
        isEnabled: false,
        lastScanResult: {
          skippedBacklog: true,
          skippedFrom: "2026-10-17T06:00:00.000Z",
          skippedTo: "2026-10-18T12:00:00.000Z",
        },
      }),
    ];
    await renderCard();

    expect(screen.queryByTestId("security-logs-source-skipped")).toBeNull();
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

describe("getSecurityLogFormatHealth", () => {
  const at: Date = new Date("2026-10-19T08:00:00Z");

  test("what the last check found comes first, then when one was last found, then none yet", () => {
    expect(
      getSecurityLogFormatHealth({
        format: SecurityLogFormat.Cef,
        foundByFormat: { cef: 3 },
        lastFoundAtByFormat: { [SecurityLogFormat.Cef]: at },
      }),
    ).toEqual({ kind: "found-now", count: 3 });
    expect(
      getSecurityLogFormatHealth({
        format: SecurityLogFormat.Cef,
        foundByFormat: { leef: 3 },
        lastFoundAtByFormat: { [SecurityLogFormat.Cef]: at },
      }),
    ).toEqual({ kind: "found-before", at });
    expect(
      getSecurityLogFormatHealth({
        format: SecurityLogFormat.Cef,
        foundByFormat: {},
        lastFoundAtByFormat: {},
      }),
    ).toEqual({ kind: "not-yet" });
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

describe("readScanProgress", () => {
  test("a check that stopped part way through a window is catching up", () => {
    expect(
      readScanProgress({ partialWindowStart: "2026-10-19T11:40:00.000Z" }),
    ).toEqual({ isCatchingUp: true, skipped: null });
    expect(readScanProgress({ partialWindowStart: "" })).toEqual({
      isCatchingUp: false,
      skipped: null,
    });
    expect(readScanProgress(undefined)).toEqual({
      isCatchingUp: false,
      skipped: null,
    });
  });

  test("only a skip with both ends readable is told", () => {
    expect(
      readScanProgress({
        skippedBacklog: true,
        skippedFrom: "2026-10-17T06:00:00.000Z",
        skippedTo: "2026-10-18T12:00:00.000Z",
      }).skipped,
    ).toEqual({
      from: new Date("2026-10-17T06:00:00.000Z"),
      to: new Date("2026-10-18T12:00:00.000Z"),
    });
    expect(
      readScanProgress({
        skippedBacklog: true,
        skippedFrom: "yesterday",
        skippedTo: "2026-10-18T12:00:00.000Z",
      }).skipped,
    ).toBeNull();
    expect(
      readScanProgress({
        skippedBacklog: false,
        skippedFrom: "2026-10-17T06:00:00.000Z",
        skippedTo: "2026-10-18T12:00:00.000Z",
      }).skipped,
    ).toBeNull();
  });
});

/*
 * "Open cases from" on Your logs: which threats security products write in
 * the logs open a case, as a connection's Open Cases From says for its
 * alerts. Shown while Your logs is on; it saves the moment it is picked.
 */
describe("Your logs - Open cases from", () => {
  function row(): HTMLElement {
    return screen.getByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-row`);
  }

  function box(): HTMLElement {
    return within(row()).getByRole("combobox", { hidden: true });
  }

  function shown(): string {
    return row().querySelector(".ou-select__single-value")?.textContent || "";
  }

  function offered(): Array<string> {
    fireEvent.keyDown(box(), { key: "ArrowDown", code: "ArrowDown" });

    const labels: Array<string> = screen
      .queryAllByRole("option")
      .map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      });

    fireEvent.keyDown(box(), { key: "Escape", code: "Escape" });

    return labels;
  }

  async function pick(label: string): Promise<void> {
    fireEvent.keyDown(box(), { key: "ArrowDown", code: "ArrowDown" });

    const option: HTMLElement = screen.getByRole("option", { name: label });

    await act(async () => {
      fireEvent.mouseDown(option);
      fireEvent.click(option);
    });
  }

  function writes(): Array<unknown> {
    return (ModelAPI.updateById as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>): unknown => {
        return (call[0] as { data: unknown }).data;
      },
    );
  }

  test("off, or never turned on, it is not shown: there is nothing to open cases from", async () => {
    await renderCard();

    expect(
      screen.queryByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-row`),
    ).toBeNull();

    cleanup();
    stored = [source({ isEnabled: false, caseMinimumSeverity: "High" })];
    await renderCard();

    expect(
      screen.queryByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-row`),
    ).toBeNull();
  });

  test("on: it shows what Your logs has, named for the reader, with what it does", async () => {
    stored = [source({ caseMinimumSeverity: "High" })];
    await renderCard();

    expect(
      screen.getByRole("combobox", { name: "Open cases from" }),
    ).toBeInTheDocument();
    expect(shown()).toBe("High and above");
    expect(offered()).toEqual([
      "Critical only",
      "High and above",
      "Medium and above",
      "Low and above",
      "Never - keep them as events only",
    ]);
    expect(
      screen.getByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-description`),
    ).toHaveTextContent(
      "Threats your firewalls and security products write in your logs - in CEF, LEEF, or Palo Alto Networks, FortiGate and Cisco ASA syslog - open security cases from this severity, grouped by user, host or address.",
    );
    // The card reads the threshold with the rest of Your logs.
    expect(
      (
        (ModelAPI.getList as unknown as jest.Mock).mock.calls[0]![0] as {
          select: Record<string, boolean>;
        }
      ).select["caseMinimumSeverity"],
    ).toBe(true);
  });

  test("an empty threshold is Never; Critical is Critical only", async () => {
    stored = [source({ caseMinimumSeverity: "" })];
    await renderCard();

    expect(shown()).toBe("Never - keep them as events only");

    cleanup();
    stored = [source({ caseMinimumSeverity: "Critical" })];
    await renderCard();

    expect(shown()).toBe("Critical only");
  });

  test("picking a severity saves that column alone, at once, and says Saved", async () => {
    stored = [source({ caseMinimumSeverity: "High" })];
    await renderCard();

    await pick("Medium and above");

    await waitFor(() => {
      expect(
        screen.getByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-status`),
      ).toHaveTextContent("Saved");
    });
    expect(writes()).toEqual([{ caseMinimumSeverity: "Medium" }]);
    expect(
      (
        (ModelAPI.updateById as unknown as jest.Mock).mock.calls[0]![0] as {
          id: ObjectID;
        }
      ).id.toString(),
    ).toBe(SOURCE_ID.toString());
    expect(shown()).toBe("Medium and above");
  });

  test("Never saves the empty value: the threats stay events", async () => {
    stored = [source({ caseMinimumSeverity: "High" })];
    await renderCard();

    await pick("Never - keep them as events only");

    await waitFor(() => {
      expect(writes()).toEqual([{ caseMinimumSeverity: "" }]);
    });
  });

  test("a pick the server refuses goes back to what Your logs has, with the reason", async () => {
    stored = [source({ caseMinimumSeverity: "High" })];
    await renderCard();
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(new Error("You need Security Admin to change this."));

    await pick("Low and above");

    expect(
      await screen.findByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-error`),
    ).toHaveTextContent("You need Security Admin to change this.");
    expect(shown()).toBe("High and above");
  });

  test("whoever may not change it sees it locked, still showing the value, and nothing is saved", async () => {
    stored = [source({ caseMinimumSeverity: "High" })];
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need Security Admin to change this.",
    });
    await act(async () => {
      render(<SecurityLogsSourceCard />);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-row`),
      ).toBeInTheDocument();
    });

    expect(box()).toBeDisabled();
    expect(shown()).toBe("High and above");
    expect(offered()).toEqual([]);
    expect(
      screen.getAllByText("You need Security Admin to change this.").length,
    ).toBeGreaterThan(0);
    expect(ModelAPI.updateById).not.toHaveBeenCalled();
  });

  test("turned on for the first time, it shows the High the new record starts with", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockImplementation(async (data: { model: unknown }) => {
        const created: SecurityLogSource = data.model as SecurityLogSource;
        // The column's default, as Postgres writes it.
        stored = [
          source({
            isEnabled: created.isEnabled === true,
            caseMinimumSeverity: "High",
          }),
        ];
        return new HTTPResponse(200, {}, {}) as never;
      });
    await renderCard();

    expect(
      screen.queryByTestId(`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-row`),
    ).toBeNull();

    await flip();

    await waitFor(() => {
      expect(shown()).toBe("High and above");
    });
    // The switch's create sends no threshold of its own.
    expect(
      (
        (ModelAPI.create as unknown as jest.Mock).mock.calls[0]![0] as {
          model: SecurityLogSource;
        }
      ).model.caseMinimumSeverity,
    ).toBeUndefined();
  });
});

describe("Your logs - Open cases from, as read and written", () => {
  test("the stored value is the choice; empty is Never, and Never writes empty", () => {
    expect(getYourLogsCaseSeverityChoice("High")).toBe("High");
    expect(getYourLogsCaseSeverityChoice("")).toBe("Never");
    expect(getYourLogsCaseSeverityChoice(null)).toBe("Never");
    expect(getYourLogsCaseSeverityChoice(undefined)).toBe("Never");
    expect(getYourLogsCaseSeverityChoice("  ")).toBe("Never");
    expect(getYourLogsCaseSeverityWrite("Never")).toBe("");
    expect(getYourLogsCaseSeverityWrite("Low")).toBe("Low");
  });

  test("a value written through the API stays offered, as it is, while Your logs has it", () => {
    expect(
      getYourLogsCaseSeverityOptions("Informational").map(
        (option: { label: string; isUserContent?: boolean | undefined }) => {
          return [option.label, Boolean(option.isUserContent)];
        },
      ),
    ).toEqual([
      ["Critical only", false],
      ["High and above", false],
      ["Medium and above", false],
      ["Low and above", false],
      ["Never - keep them as events only", false],
      ["Informational", true],
    ]);
    expect(getYourLogsCaseSeverityOptions("High")).toHaveLength(5);
  });
});
