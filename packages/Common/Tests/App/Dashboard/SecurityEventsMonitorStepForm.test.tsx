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
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import SecurityEventsMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm";
import SecurityEventAttributeUtil from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeUtil";
import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import Service from "../../../Models/DatabaseModels/Service";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";
import {
  getByTextOutsideFoldedHeaders,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * The step form's field gating IS the feature here. Event Class and - as of
 * issue #3398 - Event Severity are always on screen, because hiding them
 * behind the old "Show Advanced Options" link read as "monitors cannot
 * filter by class/severity" to anyone who did not know the link existed.
 * The service, attribute and watchlist filters fold under More fields, the
 * section every form folds its rarely needed fields into: folded on a new
 * monitor and an edited one alike, its header naming them and showing the
 * ones a monitor uses as chips. No other test renders this form (the view-model
 * and type tests cover different layers), so without this one a refactor
 * could quietly hide a field, or bring the old link back, and nothing
 * would fail.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const TELEMETRY_SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const DETECTION_RULE_ID: string = "12121212-3434-4545-8567-787878787878";

// The keys the project's security events carry, as the API lists them.
const ATTRIBUTE_KEYS: Array<string> = ["threat.matched", "device.hostname"];

// The project's watchlists, as the API lists them for the watchlist filters.
function watchlist(
  name: string,
  entityType: SecurityEntityType,
): SecurityWatchlist {
  const item: SecurityWatchlist = new SecurityWatchlist();
  item.name = name;
  item.entityType = entityType;
  return item;
}

const WATCHLISTS: Array<SecurityWatchlist> = [
  watchlist("admin_addresses", SecurityEntityType.IpAddress),
  watchlist("vip_users", SecurityEntityType.User),
];

// Picks an option of a react-select, the way a pointer does.
function pick(combobox: HTMLElement, optionText: string): void {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(optionText);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function checkoutService(): Service {
  const service: Service = new Service();
  service.id = TELEMETRY_SERVICE_ID;
  service.name = "checkout";
  return service;
}

interface Recorder {
  latest: MonitorStepSecurityEventsMonitor | null;
}

function renderForm(
  config?: Partial<MonitorStepSecurityEventsMonitor>,
): Recorder {
  const recorder: Recorder = { latest: null };

  render(
    <SecurityEventsMonitorStepForm
      monitorStepSecurityEventsMonitor={{
        ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
        ...(config || {}),
      }}
      onMonitorStepSecurityEventsMonitorChanged={(
        value: MonitorStepSecurityEventsMonitor,
      ) => {
        recorder.latest = value;
      }}
      telemetryServices={[checkoutService()]}
    />,
  );

  return recorder;
}

// findBy: lets the preview's first count and the key lookup land inside act.
async function renderSettled(
  config?: Partial<MonitorStepSecurityEventsMonitor>,
): Promise<Recorder> {
  const recorder: Recorder = renderForm(config);

  await screen.findByText("Event Class");

  return recorder;
}

function moreFields(): HTMLElement {
  return screen.getByRole("button", { name: "More fields" });
}

// A field's own label, not the name the folded header lists it by.
function fieldLabel(title: string): HTMLElement {
  return getByTextOutsideFoldedHeaders(document.body, title);
}

function keyInput(): HTMLInputElement {
  const input: HTMLInputElement | undefined = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[aria-controls^="autocomplete-suggestions-"]',
    ),
  ).find((candidate: HTMLInputElement): boolean => {
    return candidate.getAttribute("placeholder") !== "Value";
  });

  if (!input) {
    throw new Error("No attribute key box in the attributes filter.");
  }

  return input;
}

function valueInput(): HTMLInputElement {
  const input: HTMLInputElement | null =
    document.querySelector<HTMLInputElement>('input[placeholder="Value"]');

  if (!input) {
    throw new Error("No attribute value box in the attributes filter.");
  }

  return input;
}

describe("SecurityEventsMonitorStepForm field gating", () => {
  let getAttributeKeys: SpyInstance<() => Promise<Array<string>>>;
  let getWatchlists: SpyInstance;

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    // The watchlist filters list the project's lists by name.
    getWatchlists = jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: WATCHLISTS,
      count: WATCHLISTS.length,
      skip: 0,
      limit: 200,
    } as never) as unknown as SpyInstance;
    // The live preview polls the event count; keep it quiet and offline.
    jest.spyOn(AnalyticsModelAPI, "count").mockResolvedValue(0 as never);
    getAttributeKeys = jest
      .spyOn(SecurityEventAttributeUtil, "getAttributeKeys")
      .mockResolvedValue(ATTRIBUTE_KEYS as never) as unknown as SpyInstance<
      () => Promise<Array<string>>
    >;
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("severity and class are on screen, never folded under More fields", async () => {
    await renderSettled();

    expect(fieldLabel("Event Severity")).toBeVisible();
    expect(fieldLabel("Event Class")).toBeVisible();
    expect(fieldLabel("Monitor events that include this text")).toBeVisible();
    expect(fieldLabel("Monitor Security Events for (time)")).toBeVisible();

    // The folded header does not name them: they are not in it.
    expect(listedNames(moreFields())).not.toContain("Event Severity");
    expect(listedNames(moreFields())).not.toContain("Event Class");
  });

  test("a new monitor's service, attribute and watchlist filters wait folded under More fields, named on its header", async () => {
    await renderSettled();

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFields())).toEqual([
      "Filter by Telemetry Service",
      "Filter by Attributes",
      "Filter by Watchlists",
    ]);
    // Nothing set on a new monitor.
    expect(setChips(moreFields())).toEqual([]);

    // Mounted, so they keep their values, but out of sight until opened.
    expect(fieldLabel("Filter by Telemetry Service")).not.toBeVisible();
    expect(fieldLabel("Filter by Attributes")).not.toBeVisible();
    expect(fieldLabel("Filter by Watchlists")).not.toBeVisible();

    fireEvent.click(moreFields());

    expect(moreFields()).toHaveAttribute("aria-expanded", "true");
    expect(fieldLabel("Filter by Telemetry Service")).toBeVisible();
    expect(fieldLabel("Filter by Attributes")).toBeVisible();
    expect(fieldLabel("Filter by Watchlists")).toBeVisible();
  });

  test("an edited monitor's watchlist filters stay folded, shown as a chip", async () => {
    await renderSettled({
      watchlistFilters: [
        { field: "principalUser", watchlist: "vip_users" },
        {
          field: "principalIp",
          watchlist: "admin_addresses",
          isNotOnList: true,
        },
      ],
    });

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual(["Filter by Watchlists: 2"]);

    fireEvent.click(moreFields());

    // Each row says its field, whether the field is on the list, and the list.
    await waitFor(() => {
      expect(
        screen.getAllByTestId("security-events-watchlist-filter"),
      ).toHaveLength(2);
    });
    expect(screen.getByText("vip_users")).toBeInTheDocument();
    expect(screen.getByText("Is not on the list")).toBeInTheDocument();
    expect(getWatchlists).toHaveBeenCalledTimes(1);
  });

  test("a row's choices are changed by picking another, never emptied: its own remove button, beside them, takes it away", async () => {
    await renderSettled({
      watchlistFilters: [{ field: "principalUser", watchlist: "vip_users" }],
    });

    fireEvent.click(moreFields());

    const row: HTMLElement = await screen.findByTestId(
      "security-events-watchlist-filter",
    );

    // A dropdown that may be emptied draws react-select's clear button: the window's does.
    expect(
      document.querySelectorAll(".ou-select__clear-indicator").length,
    ).toBeGreaterThan(0);
    // None of the row's three choices does.
    expect(row.querySelectorAll(".ou-select__clear-indicator")).toHaveLength(0);
    expect(within(row).getAllByRole("combobox")).toHaveLength(3);
    // The row's remove button is the row's own.
    expect(
      within(row).getByTestId("security-events-watchlist-filter-remove"),
    ).toBeInTheDocument();
  });

  test("a watchlist filter added under More fields reaches the step, on the field its list's kind is usually in", async () => {
    const recorder: Recorder = await renderSettled({
      classNames: ["Authentication"],
    });

    fireEvent.click(moreFields());

    await act(async () => {
      fireEvent.click(await screen.findByText("Add a Watchlist Filter"));
    });

    expect(recorder.latest?.watchlistFilters).toEqual([
      { field: "", watchlist: "", isNotOnList: false },
    ]);

    pick(screen.getByLabelText("Watchlist"), "vip_users");

    expect(recorder.latest).toMatchObject({
      classNames: ["Authentication"],
      watchlistFilters: [
        { field: "principalUser", watchlist: "vip_users", isNotOnList: false },
      ],
    });

    // Not on the list: an allow list.
    pick(screen.getByLabelText("Match"), "Is not on the list");

    expect(recorder.latest?.watchlistFilters).toEqual([
      { field: "principalUser", watchlist: "vip_users", isNotOnList: true },
    ]);

    // Removed, the monitor reads no list.
    fireEvent.click(
      screen.getByTestId("security-events-watchlist-filter-remove"),
    );

    expect(recorder.latest?.watchlistFilters).toEqual([]);
  });

  test("a project with no watchlist is sent to make one, and offered no filter to add", async () => {
    getWatchlists.mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 200,
    } as never);

    await renderSettled();
    fireEvent.click(moreFields());

    expect(
      await screen.findByText(
        "No watchlists yet. Create one under Security Events > Detections > Watchlists.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Open Watchlists").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("/security-events/watchlists"),
    );
    expect(
      screen.queryByText("Add a Watchlist Filter"),
    ).not.toBeInTheDocument();
  });

  test("lists that could not be read say so, and a filter can still be added", async () => {
    getWatchlists.mockRejectedValue(new Error("offline") as never);

    await renderSettled();
    fireEvent.click(moreFields());

    expect(
      await screen.findByText("Couldn't load the watchlists."),
    ).toBeInTheDocument();
    expect(screen.getByText("Add a Watchlist Filter")).toBeInTheDocument();
  });

  test("the old Show / Hide Advanced Options link is gone", async () => {
    await renderSettled({ telemetryServiceIds: [TELEMETRY_SERVICE_ID] });

    expect(screen.queryByText("Show Advanced Options")).not.toBeInTheDocument();
    expect(screen.queryByText("Hide Advanced Options")).not.toBeInTheDocument();

    fireEvent.click(moreFields());

    expect(screen.queryByText("Hide Advanced Options")).not.toBeInTheDocument();
  });

  test("a stored severity or class filter leaves More fields folded, with nothing in it set", async () => {
    /*
     * Severity and class are not in the fold, so a monitor that only
     * filters by them has nothing folded worth calling out.
     */
    await renderSettled({
      severityNames: ["High" as never],
      classNames: ["Detection Finding"],
    });

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual([]);
  });

  test("an edited monitor's service filter stays folded, shown as a chip", async () => {
    /*
     * The old link opened by itself for a stored service filter. A More
     * fields section stays folded on an edit too: its header says what is
     * set, so nothing in force is hidden.
     */
    await renderSettled({ telemetryServiceIds: [TELEMETRY_SERVICE_ID] });

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual(["Filter by Telemetry Service: 1"]);
  });

  test("a detection rule's attribute filter stays folded as a chip, and opens to its row", async () => {
    // What Security Events → Detection Rules → Create Monitor prefills.
    await renderSettled({
      classNames: ["Detection Finding"],
      attributes: { "oneuptime.detection.rule_id": DETECTION_RULE_ID },
    });

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual(["Filter by Attributes: 1"]);

    fireEvent.click(moreFields());

    /*
     * The stored entry hydrates a dictionary row, and that row must carry
     * the operator dropdown — the same operator restore the Log/Trace
     * monitors rely on.
     */
    expect(keyInput().value).toBe("oneuptime.detection.rule_id");
    expect(screen.getByText("Operator")).toBeVisible();
  });

  test("the attributes filter offers an operator on every new entry", async () => {
    /*
     * dictionaryEnableOperators is the other half of #3398: without it
     * the dictionary renders a fixed "=" between key and value; with it
     * each row gets an "Operator" dropdown (contains, is any of, ...).
     */
    await renderSettled();

    fireEvent.click(moreFields());

    // No rows yet, so no per-row controls either.
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Add Filter by Attributes"));

    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("Key")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  test("a filter set under More fields reaches the step with every other filter", async () => {
    const recorder: Recorder = await renderSettled({
      messageContains: "failed",
      classNames: ["Authentication"],
    });

    fireEvent.click(moreFields());
    fireEvent.click(screen.getByText("Add Filter by Attributes"));
    fireEvent.change(keyInput(), { target: { value: "user.name" } });
    fireEvent.change(valueInput(), { target: { value: "root" } });

    expect(recorder.latest).toMatchObject({
      messageContains: "failed",
      classNames: ["Authentication"],
      attributes: { "user.name": "root" },
    });

    // Folded again, its header says what is now set.
    fireEvent.click(moreFields());

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual(["Filter by Attributes: 1"]);
  });

  test("fetches the project's attribute keys once, as the form opens, and suggests them", async () => {
    await renderSettled();

    expect(getAttributeKeys).toHaveBeenCalledTimes(1);

    fireEvent.click(moreFields());
    fireEvent.click(screen.getByText("Add Filter by Attributes"));
    fireEvent.focus(keyInput());

    expect(await screen.findByText("threat.matched")).toBeInTheDocument();
    expect(screen.getByText("device.hostname")).toBeInTheDocument();

    // Folding and opening again asks for nothing more.
    fireEvent.click(moreFields());
    fireEvent.click(moreFields());

    expect(getAttributeKeys).toHaveBeenCalledTimes(1);
  });

  test("a failed key lookup leaves the filter to keys typed by hand", async () => {
    getAttributeKeys.mockRejectedValue(new Error("offline") as never);

    const recorder: Recorder = await renderSettled();

    fireEvent.click(moreFields());
    fireEvent.click(screen.getByText("Add Filter by Attributes"));
    fireEvent.change(keyInput(), { target: { value: "device.hostname" } });
    fireEvent.change(valueInput(), { target: { value: "web-1" } });

    expect(recorder.latest?.attributes).toEqual({
      "device.hostname": "web-1",
    });
  });
});
