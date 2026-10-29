import { afterEach, describe, expect, test } from "@jest/globals";
import {
  LIVE_ROWS_ARRIVED_IN_MS,
  LIVE_ROWS_HOLDING_ELEMENTS_SELECTOR,
  LIVE_ROWS_HOLD_RECHECK_IN_MS,
  LIVE_ROWS_MIN_INTERVAL_IN_MS,
  LIVE_ROWS_POINTER_REST_IN_MS,
  LiveRowsHold,
  getArrivedRowIds,
  getLiveRowEventTypes,
  isDialogOrMenuOpen,
  isLiveRowsHeld,
  isPointerAtWorkOnRows,
} from "../../../../UI/Components/ModelTable/LiveRows";
import * as fs from "fs";
import * as path from "path";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import Log from "../../../../Models/AnalyticsModels/Log";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";

/*
 * Which lists keep themselves current, and when a change they hear has to
 * wait for the reader (UI/Components/ModelTable/LiveRows.ts).
 */

const ALL_EVENTS: Array<ModelEventType> = [
  ModelEventType.Create,
  ModelEventType.Update,
  ModelEventType.Delete,
];

describe("which lists keep themselves current", () => {
  test("the lists people watch during an outage hear every change", () => {
    for (const model of [
      new Incident(),
      new Alert(),
      new IncidentEpisode(),
      new AlertEpisode(),
    ]) {
      expect(getLiveRowEventTypes(model)).toEqual(ALL_EVENTS);
    }
  });

  test("an SLO's list hears its updates: its status and budget move", () => {
    expect(getLiveRowEventTypes(new ServiceLevelObjective())).toEqual([
      ModelEventType.Update,
    ]);
  });

  test("a table whose changes the server does not announce stays as loaded", () => {
    expect(getLiveRowEventTypes(new Monitor())).toEqual([]);
    expect(getLiveRowEventTypes(new StatusPage())).toEqual([]);
  });

  test("an analytics table pages through its own time range, even one that announces", () => {
    expect(getLiveRowEventTypes(new Log())).toEqual([]);
    // ExceptionInstance announces its rows, but a list of them is a log.
    expect(new ExceptionInstance().enableRealtimeEventsOn).toBeTruthy();
    expect(getLiveRowEventTypes(new ExceptionInstance())).toEqual([]);
  });

  test("nothing is heard without a model", () => {
    expect(getLiveRowEventTypes(null)).toEqual([]);
    expect(getLiveRowEventTypes(undefined)).toEqual([]);
  });

  test("a table hears exactly the changes its model announces, in a fixed order", () => {
    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();
      const announced: BaseModel["enableRealtimeEventsOn"] =
        model.enableRealtimeEventsOn;
      const expected: Array<ModelEventType> = [];

      if (announced?.create) {
        expected.push(ModelEventType.Create);
      }

      if (announced?.update) {
        expected.push(ModelEventType.Update);
      }

      if (announced?.delete) {
        expected.push(ModelEventType.Delete);
      }

      expect({
        table: model.tableName,
        events: getLiveRowEventTypes(model),
      }).toEqual({ table: model.tableName, events: expected });
    }
  });

  /*
   * A new table that announces its changes makes its lists live. Say so
   * here, so whoever adds one looks at the lists it shows up in.
   */
  test("the tables whose lists are live", () => {
    const live: Array<string> = AllModelTypes.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return getLiveRowEventTypes(new modelType()).length > 0;
      },
    )
      .map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName as string;
      })
      .sort();

    expect(live).toEqual(
      [
        "AIConversationMessage",
        "AIInsight",
        "AIRun",
        "AIRunEvent",
        "Alert",
        "AlertEpisode",
        "Incident",
        "IncidentEpisode",
        "SecurityCase",
        "SecurityCaseTask",
        "SecurityPlaybookRun",
        "ServiceLevelObjective",
      ].sort(),
    );
  });
});

describe("how often a list reads again", () => {
  test("at the header's pace, and looks again for a busy reader more often than it reads", () => {
    const header: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../../App/FeatureSet/Dashboard/src/Components/Header/Header.tsx",
      ),
      "utf8",
    );

    expect(header).toContain(
      `HEADER_COUNT_REFRESH_INTERVAL_IN_MS: number = ${LIVE_ROWS_MIN_INTERVAL_IN_MS};`,
    );
    expect(LIVE_ROWS_MIN_INTERVAL_IN_MS).toBe(5000);
    expect(LIVE_ROWS_HOLD_RECHECK_IN_MS).toBeGreaterThan(0);
    expect(LIVE_ROWS_HOLD_RECHECK_IN_MS).toBeLessThan(
      LIVE_ROWS_MIN_INTERVAL_IN_MS,
    );
  });
});

describe("when a change waits for the reader", () => {
  const idle: LiveRowsHold = {
    isLoading: false,
    hasSelection: false,
    isReordering: false,
    isDialogOrMenuOpen: false,
    hasTextSelection: false,
  };

  test("a list nobody is busy with reads at once", () => {
    expect(isLiveRowsHeld(idle)).toBe(false);
  });

  test.each([
    ["the page is being read", { isLoading: true }],
    ["rows are ticked for a bulk action", { hasSelection: true }],
    ["a row is being dragged", { isReordering: true }],
    ["a dialog or a menu is open", { isDialogOrMenuOpen: true }],
    ["text is being selected", { hasTextSelection: true }],
  ] as Array<[string, Partial<LiveRowsHold>]>)(
    "it waits while %s",
    (_reason: string, busy: Partial<LiveRowsHold>) => {
      expect(isLiveRowsHeld({ ...idle, ...busy })).toBe(true);
    },
  );
});

describe("what counts as a dialog or a menu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("nothing open", () => {
    document.body.innerHTML =
      "<main><table><tr><td>INC-1</td></tr></table></main>";
    expect(isDialogOrMenuOpen()).toBe(false);
  });

  test("a modal dialog holds the rows", () => {
    document.body.innerHTML =
      '<div role="dialog" aria-modal="true"><h2>Edit Incident</h2></div>';
    expect(isDialogOrMenuOpen()).toBe(true);
  });

  test("a side panel does not: it is not modal", () => {
    document.body.innerHTML = '<div role="dialog"><h2>Investigation</h2></div>';
    expect(isDialogOrMenuOpen()).toBe(false);
  });

  test("an open menu holds the rows: a row's ⋯ or the Products menu", () => {
    document.body.innerHTML =
      '<div role="menu"><button role="menuitem">Acknowledge</button></div>';
    expect(isDialogOrMenuOpen()).toBe(true);
  });

  test("it can look inside one part of the page", () => {
    document.body.innerHTML =
      '<section id="a"></section><section id="b"><div role="menu"></div></section>';
    expect(isDialogOrMenuOpen(document.getElementById("a")!)).toBe(false);
    expect(isDialogOrMenuOpen(document.getElementById("b")!)).toBe(true);
  });

  test("the selector names exactly those two", () => {
    expect(LIVE_ROWS_HOLDING_ELEMENTS_SELECTOR).toBe(
      '[role="dialog"][aria-modal="true"], [role="menu"]',
    );
  });
});

/*
 * A row read in above the one under the pointer moves it as it is clicked,
 * and the click opens the next incident. While the pointer is at work on
 * the rows the list waits; a pointer left lying on them holds nothing once
 * it has rested.
 */
describe("when the pointer holds the rows", () => {
  const now: number = 1_000_000;

  test("a pointer that moved over the rows a moment ago holds them", () => {
    expect(isPointerAtWorkOnRows(now, now)).toBe(true);
    expect(
      isPointerAtWorkOnRows(now - (LIVE_ROWS_POINTER_REST_IN_MS - 1), now),
    ).toBe(true);
  });

  test("a pointer that has rested for the rest time holds nothing", () => {
    expect(isPointerAtWorkOnRows(now - LIVE_ROWS_POINTER_REST_IN_MS, now)).toBe(
      false,
    );
    expect(isPointerAtWorkOnRows(now - 60_000, now)).toBe(false);
  });

  test("a pointer that is off the rows holds nothing", () => {
    expect(isPointerAtWorkOnRows(null, now)).toBe(false);
  });

  test("the rest can be set for a test", () => {
    expect(isPointerAtWorkOnRows(now - 50, now, 100)).toBe(true);
    expect(isPointerAtWorkOnRows(now - 100, now, 100)).toBe(false);
  });

  test("a click follows a pointer's arrival within the rest; a wall screen's pointer is let go", () => {
    expect(LIVE_ROWS_POINTER_REST_IN_MS).toBe(3000);
    // The list looks again while it waits more often than the pointer rests.
    expect(LIVE_ROWS_HOLD_RECHECK_IN_MS).toBeLessThan(
      LIVE_ROWS_POINTER_REST_IN_MS,
    );
  });
});

/*
 * The rows a live read brings in are tinted for a moment, so the eye finds
 * the new incident among the rows that moved down for it.
 */
describe("which rows a live read brought in", () => {
  test("the rows on the page now that were not before", () => {
    expect(
      getArrivedRowIds(["inc-2", "inc-1"], ["inc-3", "inc-2", "inc-1"]),
    ).toEqual(["inc-3"]);
    expect(
      getArrivedRowIds(["inc-2", "inc-1"], ["inc-5", "inc-4", "inc-2"]),
    ).toEqual(["inc-5", "inc-4"]);
  });

  test("a row that only changed, moved or left brings in nothing", () => {
    expect(getArrivedRowIds(["inc-2", "inc-1"], ["inc-1", "inc-2"])).toEqual(
      [],
    );
    expect(getArrivedRowIds(["inc-2", "inc-1"], ["inc-1"])).toEqual([]);
  });

  test("the first rows into an empty list are new", () => {
    expect(getArrivedRowIds([], ["inc-1"])).toEqual(["inc-1"]);
  });

  test("a burst that fills the page tints the whole page", () => {
    expect(getArrivedRowIds(["inc-1"], ["inc-3", "inc-2"])).toEqual([
      "inc-3",
      "inc-2",
    ]);
  });

  test("nothing before the first page is drawn, and no row without an id", () => {
    expect(getArrivedRowIds(null, ["inc-1", "inc-2"])).toEqual([]);
    expect(getArrivedRowIds(["inc-1"], ["", "inc-1"])).toEqual([]);
  });

  test("the tint lasts as long as its fade in Theme.css", () => {
    const theme: string = fs.readFileSync(
      path.join(__dirname, "../../../../UI/Styles/Theme.css"),
      "utf8",
    );

    expect(LIVE_ROWS_ARRIVED_IN_MS).toBe(2400);
    expect(theme).toContain(
      `animation: ou-row-arrived ${LIVE_ROWS_ARRIVED_IN_MS / 1000}s ease-out;`,
    );
    expect(theme).toContain(
      `animation: ou-row-arrived-card ${LIVE_ROWS_ARRIVED_IN_MS / 1000}s ease-out;`,
    );
  });
});
