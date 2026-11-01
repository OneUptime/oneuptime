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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A DESIGN PASS OVER THE FINAL SCHEDULE'S FINE PRINT (#4972, #5282).
 *
 * A schedule's Final Schedule card said its timezone three times (the
 * card's description, the "View as" note, every time's own zone), put two
 * sentences about overrides under every schedule - including the many with
 * none ("this preview reflects global user overrides only. No on-call
 * policy escalates to this schedule yet, so there are no policy-scoped
 * overrides to apply") - labelled its parts in letter-spaced capitals,
 * framed each of six hand-offs as a card of its own, boxed its legend above
 * the "View as" row, away from the grid it explains, wrote every block of
 * the grid as "Name (email)" - which broke inside a week's narrow column -
 * and opened that week on a phone, seven columns in 300 pixels.
 *
 * Now: the description says what the card is, once, and the note beside
 * "View as" is the one place for the zone; the overrides' fine print shows
 * only when there are overrides; the labels are in the reading's own case;
 * the hand-offs are one list; the legend sits plainly right above the grid;
 * a block names its person (the address is in its tooltip); and a phone
 * opens on a day.
 *
 * Driven through the real LayersPreview (and FinalScheduleSummary inside
 * it) with only ModelAPI and the calendar grid stubbed, as
 * OnCallSchedulePreviewOverrides does.
 */

const getListMock: MockFunction = getJestMockFunction();
const calendarProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: (): string => {
            return PROJECT_ID;
          },
        };
      },
    },
  };
});

// The grid: a list of its events' titles and tooltips, and what it was told.
jest.mock("../../../UI/Components/Calendar/Calendar", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      calendarProps.push(props);
      return (
        <ul data-testid="calendar-events">
          {(props.events || []).map((event: any, index: number) => {
            return (
              <li
                key={index}
                data-testid="calendar-event"
                data-tooltip={String(event.desc || "")}
              >
                {event.title}
              </li>
            );
          })}
        </ul>
      );
    },
    DefaultCalendarView: {
      Month: "month",
      Week: "week",
      Day: "day",
      Agenda: "agenda",
    },
  };
});

import LayersPreview, {
  FINAL_SCHEDULE_DAY_VIEW_BELOW_WIDTH_IN_PX,
  FINAL_SCHEDULE_WEEK_VIEW_MIN_WIDTH_IN_PX,
  VIEW_AS_CONTROL_CLASS_NAME,
  VIEW_AS_LABEL_CLASS_NAME,
  VIEW_AS_NOTE_CLASS_NAME,
  VIEW_AS_ROW_CLASS_NAME,
  getFinalScheduleCalendarView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersPreview";
import {
  SECTION_LABEL_CLASS_NAME,
  UPCOMING_HAND_OFFS_LIST_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary";
import { OVERRIDE_PARTY_CAPTION_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard";
import LayerRotationSummary, {
  LAYER_TURNS_LIST_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerRotationSummary";
import { getLayerPreviewEvents } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerShiftPreview";
import { SCHEDULE_FINAL_SCHEDULE_DESCRIPTION } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ScheduleOverviewCopy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID: string = "22222222-2222-4222-8222-222222222222";
const LAYER_ID: string = "33333333-3333-4333-8333-333333333333";
const POLICY_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_POLICY_ID: string = "55555555-5555-4555-8555-555555555555";

const USER_IDS: Array<string> = [
  "aaaaaaaa-1111-4111-8111-111111111111",
  "bbbbbbbb-2222-4222-8222-222222222222",
  "cccccccc-3333-4333-8333-333333333333",
];
const USER_NAMES: Array<string> = ["Nina Patel", "Bob Rivera", "Chen Wei"];

// What a letter-spaced, upper-case label is drawn with.
const SHOUTING_CLASSES: Array<string> = ["uppercase", "tracking-wide"];

// A class that goes by the window's width (sm:, md:, max-lg: and the rest).
const WINDOW_BREAKPOINT: RegExp = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;

function makeUser(index: number): User {
  const user: User = new User();
  user.id = new ObjectID(USER_IDS[index]!);
  user.name = USER_NAMES[index] as any;
  user.email =
    `${USER_NAMES[index]!.split(" ")[0]!.toLowerCase()}@example.com` as any;
  return user;
}

// A weekly rotation of three people, started four weeks ago.
function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  const now: Date = OneUptimeDate.getCurrentDate();

  layer.id = new ObjectID(LAYER_ID);
  layer.projectId = new ObjectID(PROJECT_ID);
  layer.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
  layer.order = 1;
  layer.name = "Primary" as any;
  layer.startsAt = OneUptimeDate.addRemoveDays(now, -28);
  layer.handOffTime = OneUptimeDate.addRemoveDays(now, -28);
  layer.rotation = Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: EventInterval.Week,
      intervalCount: { _type: "PositiveNumber", value: 1 },
    },
  } as any) as any;

  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  restrictionTimes.dayRestrictionTimes = null;
  layer.restrictionTimes = restrictionTimes as any;

  return layer;
}

function makeLayerUsers(): Dictionary<
  Array<OnCallDutyPolicyScheduleLayerUser>
> {
  return {
    [LAYER_ID]: USER_IDS.map(
      (id: string, index: number): OnCallDutyPolicyScheduleLayerUser => {
        const layerUser: OnCallDutyPolicyScheduleLayerUser =
          new OnCallDutyPolicyScheduleLayerUser();
        layerUser.id = new ObjectID(
          `6666666${index}-6666-4666-8666-666666666666`,
        );
        layerUser.onCallDutyPolicyScheduleLayerId = new ObjectID(LAYER_ID);
        layerUser.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
        layerUser.projectId = new ObjectID(PROJECT_ID);
        layerUser.order = index + 1;
        layerUser.userId = new ObjectID(id);
        layerUser.user = makeUser(index);
        return layerUser;
      },
    ),
  };
}

function anOverride(): OnCallDutyPolicyUserOverride {
  const now: Date = OneUptimeDate.getCurrentDate();
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  model.id = new ObjectID("77777777-7777-4777-8777-777777777777");
  model.projectId = new ObjectID(PROJECT_ID);
  model.overrideUserId = new ObjectID(USER_IDS[0]!);
  model.routeAlertsToUserId = new ObjectID(USER_IDS[2]!);
  model.startsAt = OneUptimeDate.addRemoveDays(now, 2);
  model.endsAt = OneUptimeDate.addRemoveDays(now, 3);
  model.onCallDutyPolicyId = null as any;
  model.overrideUser = makeUser(0);
  model.routeAlertsToUser = makeUser(2);
  return model;
}

function answerReads(data: {
  overrides: Array<OnCallDutyPolicyUserOverride>;
  attachedPolicyIds: Array<string>;
}): void {
  getListMock.mockImplementation((args: any) => {
    const modelName: string = args?.modelType?.name || "";

    if (modelName === "OnCallDutyPolicyUserOverride") {
      return Promise.resolve({
        data: data.overrides,
        count: data.overrides.length,
        skip: 0,
        limit: data.overrides.length,
      });
    }

    if (modelName === "OnCallDutyPolicyEscalationRuleSchedule") {
      const joins: Array<OnCallDutyPolicyEscalationRuleSchedule> =
        data.attachedPolicyIds.map((policyId: string) => {
          const join: OnCallDutyPolicyEscalationRuleSchedule =
            new OnCallDutyPolicyEscalationRuleSchedule();
          join.id = new ObjectID("88888888-8888-4888-8888-888888888888");
          join.projectId = new ObjectID(PROJECT_ID);
          join.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
          join.onCallDutyPolicyId = new ObjectID(policyId);
          return join;
        });

      return Promise.resolve({
        data: joins,
        count: joins.length,
        skip: 0,
        limit: joins.length,
      });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
}

// The layer form's preview passes showFieldLabel; a schedule's Overview leaves it out.
function renderPreview(showFieldLabel: boolean = false): void {
  render(
    <LayersPreview
      layers={[makeLayer()]}
      allLayerUsers={makeLayerUsers()}
      timezone="Europe/London"
      onCallDutyPolicyScheduleId={new ObjectID(SCHEDULE_ID)}
      showFieldLabel={showFieldLabel}
    />,
  );
}

// Every element of the preview, and the classes each draws with.
function everyClassName(): Array<string> {
  return Array.from(document.body.querySelectorAll("*")).map(
    (element: Element): string => {
      return element.getAttribute("class") || "";
    },
  );
}

async function waitForPreview(): Promise<void> {
  await screen.findByText("On call right now", {}, { timeout: 10000 });
  await waitFor(
    () => {
      expect(screen.getAllByTestId("calendar-event").length).toBeGreaterThan(0);
    },
    { timeout: 10000 },
  );
}

beforeEach(() => {
  getListMock.mockReset();
  calendarProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("what the card says it is, once", () => {
  test("the description says what the card shows, and no timezone", () => {
    expect(SCHEDULE_FINAL_SCHEDULE_DESCRIPTION).toBe(
      "Who is on call and when, with every layer applied.",
    );
  });

  test("the layer form's preview describes itself the same way, with no timezone", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview(true);
    await waitForPreview();

    expect(
      screen.getByText(SCHEDULE_FINAL_SCHEDULE_DESCRIPTION),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      "Times are in this schedule's timezone",
    );
    expect(document.body.textContent).not.toContain(
      "Times are in your timezone",
    );
  });

  test("the zone is said once, in the note beside View as", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview(true);
    await waitForPreview();

    const sentences: Array<string> = (document.body.textContent || "")
      .split(".")
      .filter((sentence: string): boolean => {
        return sentence.includes("timezone");
      });

    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain("Times below are shown");
  });

  test("the Overview's and the Layers page's cards take the same description, with no timezone in their source", () => {
    const folder: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "OnCallPolicy",
      "OnCallScheduleLayer",
    );

    for (const file of [
      "FinalPreview.tsx",
      "Layers.tsx",
      "LayersPreview.tsx",
    ]) {
      const source: string = fs.readFileSync(path.join(folder, file), "utf8");

      expect([
        file,
        source.includes("SCHEDULE_FINAL_SCHEDULE_DESCRIPTION"),
      ]).toEqual([file, true]);
      expect([
        file,
        source.includes("Times are in this schedule's timezone"),
      ]).toEqual([file, false]);
    }
  });
});

describe("the overrides' fine print", () => {
  test("with no override anywhere, nothing is said about which overrides apply", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [] });

    renderPreview();
    await waitForPreview();

    expect(document.body.textContent).not.toContain("this preview reflects");
    expect(document.body.textContent).not.toContain(
      "no policy-scoped overrides to apply",
    );
    expect(screen.queryByTestId("legend-override-key")).toBeNull();
  });

  test("with one policy escalating here and no override, nothing either - and the preview says its overrides are known", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    await waitForPreview();
    await waitFor(
      () => {
        expect(screen.getByTestId("layers-preview")).toHaveAttribute(
          "data-overrides",
          "resolved",
        );
      },
      { timeout: 10000 },
    );

    expect(document.body.textContent).not.toContain("this preview reflects");
    expect(document.body.textContent).not.toContain(
      "the same set used to route alerts",
    );
  });

  /*
   * With nothing written about overrides when there are none, the preview
   * still says - on data-overrides, for whatever waits on it - whether the
   * overrides in force are known yet.
   */
  test("the preview says its overrides are being read until they are", async () => {
    const pending: Array<(value: unknown) => void> = [];

    getListMock.mockImplementation((args: any) => {
      if (args?.modelType?.name === "OnCallDutyPolicyUserOverride") {
        return new Promise((resolve: (value: unknown) => void) => {
          pending.push(resolve);
        });
      }

      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    });

    renderPreview();

    await waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId("layers-preview")).toHaveAttribute(
      "data-overrides",
      "resolving",
    );

    await act(async () => {
      for (const resolve of pending) {
        resolve({ data: [], count: 0, skip: 0, limit: 0 });
      }
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("layers-preview")).toHaveAttribute(
          "data-overrides",
          "resolved",
        );
      },
      { timeout: 10000 },
    );
  });

  /*
   * Several policies escalating here is a caveat with or without an
   * override showing: each may scope overrides of its own, and this one
   * preview draws none of them.
   */
  test("with several policies escalating here, their caveat stays though no override shows", async () => {
    answerReads({
      overrides: [],
      attachedPolicyIds: [POLICY_ID, OTHER_POLICY_ID],
    });

    renderPreview();
    await waitFor(
      () => {
        expect(document.body.textContent).toContain(
          "2 on-call policies escalate to this schedule and each may scope its own overrides",
        );
      },
      { timeout: 10000 },
    );

    expect(screen.queryByTestId("legend-override-key")).toBeNull();
  });

  test("with an override, it is said which overrides the preview applied, and the legend names the striped block", async () => {
    answerReads({ overrides: [anOverride()], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    await waitFor(
      () => {
        expect(document.body.textContent).toContain("this preview reflects");
      },
      { timeout: 10000 },
    );

    expect(screen.getByTestId("legend-override-key")).toHaveTextContent(
      "Covered by an override",
    );
  });
});

describe("the labels and the hand-offs", () => {
  test("no part is labelled in letter-spaced capitals", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    await waitForPreview();

    for (const className of everyClassName()) {
      for (const shouting of SHOUTING_CLASSES) {
        expect([className, className.split(" ").includes(shouting)]).toEqual([
          className,
          false,
        ]);
      }
    }

    for (const label of [
      "On call right now",
      "Up next",
      "Upcoming hand-offs",
    ]) {
      const element: HTMLElement = screen.getByText(label);
      const holder: Element = element.closest("div") as Element;
      for (const className of SECTION_LABEL_CLASS_NAME.split(" ")) {
        expect([label, holder.classList.contains(className)]).toEqual([
          label,
          true,
        ]);
      }
    }
  });

  /*
   * The overrides in force are listed in the same card, between the
   * hand-offs and the grid: "1 user override on this schedule", then each
   * side of the swap with "Away" or "Covering" under its name. They were
   * letter-spaced capitals beside labels that no longer are.
   */
  test("with an override, the overrides it lists are labelled in the same case: no letter-spaced capitals there either", async () => {
    answerReads({ overrides: [anOverride()], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    const card: HTMLElement = await screen.findByTestId(
      "active-overrides-card",
      {},
      { timeout: 10000 },
    );

    for (const className of everyClassName()) {
      for (const shouting of SHOUTING_CLASSES) {
        expect([className, className.split(" ").includes(shouting)]).toEqual([
          className,
          false,
        ]);
      }
    }

    const label: HTMLElement = await screen.findByText(
      "1 user override on this schedule",
    );
    for (const className of SECTION_LABEL_CLASS_NAME.split(" ")) {
      expect([className, label.classList.contains(className)]).toEqual([
        className,
        true,
      ]);
    }

    for (const caption of ["Away", "Covering"]) {
      const element: HTMLElement = Array.from(
        card.querySelectorAll("div"),
      ).find((each: HTMLDivElement): boolean => {
        return each.textContent === caption;
      }) as HTMLElement;

      expect(element).toBeTruthy();
      for (const className of OVERRIDE_PARTY_CAPTION_CLASS_NAME.split(" ")) {
        expect([caption, element.classList.contains(className)]).toEqual([
          caption,
          true,
        ]);
      }
    }
  });

  test("the hand-offs are one list in one frame, each ruled off from the next - not a framed box each", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    await waitForPreview();

    const list: HTMLElement = screen.getByTestId("upcoming-hand-offs");

    expect(list.tagName).toBe("OL");
    expect(list.className).toBe(UPCOMING_HAND_OFFS_LIST_CLASS_NAME);
    expect(list.className).toContain("divide-y");

    const rows: Array<Element> = Array.from(list.children);

    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.classList.contains("border")).toBe(false);
      expect(row.classList.contains("rounded-lg")).toBe(false);
    }
  });
});

describe("the legend and the grid", () => {
  test("the legend is plain words right above the grid, after the View as row - no frame, no chip per person", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    await waitForPreview();

    const legend: HTMLElement = screen.getByTestId("final-schedule-legend");
    const viewAs: HTMLElement = screen.getByTestId("view-as-timezone-button");
    const grid: HTMLElement = screen.getByTestId("calendar-events");

    // View as, then the legend, then the grid.
    expect(
      viewAs.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      legend.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(legend.className).not.toContain("border");
    expect(legend.className).not.toContain("bg-gray-50");
    for (const name of USER_NAMES) {
      expect(legend.textContent).toContain(name);
    }
    for (const chip of Array.from(legend.children)) {
      expect(chip.className).not.toContain("ring-1");
    }
  });

  test("a block of the grid names its person; the address is in its tooltip", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    await waitForPreview();

    const events: Array<HTMLElement> = screen.getAllByTestId("calendar-event");

    for (const event of events) {
      const title: string = event.textContent || "";
      expect(USER_NAMES).toContain(title);
      expect(title).not.toContain("@");
      expect(event.getAttribute("data-tooltip") || "").toContain(
        "@example.com",
      );
    }
  });

  test("the grid opens on a week where the preview has room for seven columns, and on a day where it has not", () => {
    expect(FINAL_SCHEDULE_WEEK_VIEW_MIN_WIDTH_IN_PX).toBe(560);

    /*
     * The preview's own width decides: a phone's card (318), the card
     * beside the side menu at 768 (430), at 1024 (634) and at 1280 (890).
     */
    expect(getFinalScheduleCalendarView({ previewWidth: 318 })).toBe("day");
    expect(getFinalScheduleCalendarView({ previewWidth: 430 })).toBe("day");
    expect(getFinalScheduleCalendarView({ previewWidth: 559 })).toBe("day");
    expect(getFinalScheduleCalendarView({ previewWidth: 560 })).toBe("week");
    expect(getFinalScheduleCalendarView({ previewWidth: 634 })).toBe("week");
    expect(getFinalScheduleCalendarView({ previewWidth: 890 })).toBe("week");

    // ...whatever the window: a tablet's window, a phone's room.
    expect(
      getFinalScheduleCalendarView({ previewWidth: 430, windowWidth: 768 }),
    ).toBe("day");
    expect(
      getFinalScheduleCalendarView({ previewWidth: 634, windowWidth: 600 }),
    ).toBe("week");
  });

  test("with no width of its own to read, the window decides: a day under 640", () => {
    expect(FINAL_SCHEDULE_DAY_VIEW_BELOW_WIDTH_IN_PX).toBe(640);
    expect(getFinalScheduleCalendarView({ windowWidth: 390 })).toBe("day");
    expect(getFinalScheduleCalendarView({ windowWidth: 639 })).toBe("day");
    expect(getFinalScheduleCalendarView({ windowWidth: 640 })).toBe("week");
    expect(getFinalScheduleCalendarView({ windowWidth: 1280 })).toBe("week");
    // Nothing laid out yet (a width of 0) reads as no width.
    expect(
      getFinalScheduleCalendarView({ previewWidth: 0, windowWidth: 390 }),
    ).toBe("day");
    // No window to read either (a server render): the week.
    expect(getFinalScheduleCalendarView({})).toBe("week");
  });

  /*
   * Beside the side menu at 768 the window is a tablet's, but the card gives
   * the grid some 430 pixels: a week there broke every name ("Bob / Riv /
   * era"). The preview reads its own width before it is first drawn.
   */
  /*
   * Renders the preview in a window of windowWidth whose own layout width
   * (offsetWidth - jsdom lays nothing out) is previewWidth, and says which
   * view the grid was opened on.
   */
  async function openedViewFor(data: {
    previewWidth: number;
    windowWidth: number;
  }): Promise<unknown> {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    const width: number = window.innerWidth;
    const original: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: data.windowWidth,
      });
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get(this: HTMLElement): number {
          return this.getAttribute("data-testid") === "layers-preview"
            ? data.previewWidth
            : 0;
        },
      });

      renderPreview();
      await waitForPreview();

      return calendarProps[calendarProps.length - 1]!["defaultCalendarView"];
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", original);
      }
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: width,
      });
    }
  }

  test("the preview opens the grid for its own width, not the window's", async () => {
    expect(await openedViewFor({ previewWidth: 430, windowWidth: 768 })).toBe(
      "day",
    );
  });

  test("a wide preview opens on a week, though the window alone would say a day", async () => {
    expect(await openedViewFor({ previewWidth: 634, windowWidth: 600 })).toBe(
      "week",
    );
  });

  /*
   * "View as" and its control, then the note saying which zone the times are
   * in: beside them where both fit, else under them as one wrapping line -
   * never a narrow right-aligned column beside the control (four lines at
   * 768), and "View as" never broken into "View / as".
   */
  test("the View as row keeps its words whole and lets the note wrap under the control", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    renderPreview();
    await waitForPreview();

    const row: HTMLElement = screen.getByTestId("view-as-row");
    const note: HTMLElement = screen.getByTestId("view-as-note");
    const control: HTMLElement = screen.getByTestId("view-as-timezone-button")
      .parentElement as HTMLElement;

    expect(row.className).toBe(VIEW_AS_ROW_CLASS_NAME);
    expect(row.classList.contains("flex-wrap")).toBe(true);
    expect(control.className).toBe(VIEW_AS_CONTROL_CLASS_NAME);
    /*
     * The control may narrow to the row: the timezone dialog it holds is
     * drawn in place, and its words sit in the row until it is styled.
     */
    expect(control.classList.contains("shrink-0")).toBe(false);
    expect(control.classList.contains("max-w-full")).toBe(true);
    expect(control).toHaveTextContent("View as");

    // "View as" keeps to one line...
    const label: HTMLElement = within(control).getByText("View as");
    expect(label.className).toBe(VIEW_AS_LABEL_CLASS_NAME);
    expect(label.classList.contains("whitespace-nowrap")).toBe(true);
    /*
     * ...but nothing around the control does: the control holds the
     * timezone dialog, drawn in place, which would inherit it and run its
     * words off a phone's screen.
     */
    let ancestor: HTMLElement | null = control;
    while (ancestor) {
      expect([
        ancestor.tagName,
        ancestor.classList.contains("whitespace-nowrap"),
      ]).toEqual([ancestor.tagName, false]);
      ancestor = ancestor.parentElement;
    }
    expect(note.className).toBe(VIEW_AS_NOTE_CLASS_NAME);
    // Wrapped "pretty": never a last line of one word.
    expect(note.classList.contains("text-pretty")).toBe(true);
    expect(note).toHaveTextContent("Europe/London");

    // Nothing in the row goes by the window's width any more.
    for (const element of [row, control, note]) {
      for (const token of element.className.split(" ")) {
        expect(token).not.toMatch(WINDOW_BREAKPOINT);
      }
    }
  });

  test("the preview hands the grid the view for the window it is in", async () => {
    answerReads({ overrides: [], attachedPolicyIds: [POLICY_ID] });

    const width: number = window.innerWidth;

    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 390,
      });

      renderPreview();
      await waitForPreview();

      expect(
        calendarProps[calendarProps.length - 1]!["defaultCalendarView"],
      ).toBe("day");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: width,
      });
    }
  });
});

/*
 * THE LAYER CARD'S OWN "WHO IS ON CALL, AND WHEN".
 *
 * On the Layers page each layer's card shows its rotation above the Final
 * schedule: an "Order" row and its upcoming turns. They were labelled in
 * letter-spaced capitals ("ORDER", "UPCOMING SHIFTS", "ON CALL NOW") and
 * each turn was a framed box, one above the Final schedule that no longer
 * is either - and a weekly turn read "6d 23h" (a rotation's turns are a
 * second apart). The two read as one schedule now.
 */
describe("the layer card's own preview reads like the Final schedule", () => {
  /*
   * The weekly rotation, handing off 30 days less 5 hours ago: the turn on
   * call now is two days in, far from any hand-off (makeLayer's hand-off
   * falls on the moment of the test).
   */
  function makeMidTurnLayer(): OnCallDutyPolicyScheduleLayer {
    const layer: OnCallDutyPolicyScheduleLayer = makeLayer();
    const handOff: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -30),
      5,
    );

    layer.startsAt = handOff;
    layer.handOffTime = handOff;
    return layer;
  }

  function renderLayerSummary(): void {
    const layer: OnCallDutyPolicyScheduleLayer = makeMidTurnLayer();
    const users: Array<OnCallDutyPolicyScheduleLayerUser> =
      makeLayerUsers()[LAYER_ID]!;
    const preview: { events: Array<any>; now: Date } = getLayerPreviewEvents({
      layer: layer,
      users: users,
      timezone: "Europe/London",
      numberOfShifts: 5,
      overrides: [],
    });

    render(
      <LayerRotationSummary
        layer={layer}
        users={users}
        timezone="Europe/London"
        events={preview.events}
        now={preview.now}
        hasLowerPriorityLayer={false}
      />,
    );
  }

  test("no part is labelled in letter-spaced capitals: Order, Upcoming shifts and On call now are in the reading's own case", () => {
    renderLayerSummary();

    for (const className of everyClassName()) {
      for (const shouting of SHOUTING_CLASSES) {
        expect([className, className.split(" ").includes(shouting)]).toEqual([
          className,
          false,
        ]);
      }
    }

    for (const label of ["Order", "Upcoming shifts"]) {
      const element: HTMLElement = screen.getByText(label);
      for (const className of SECTION_LABEL_CLASS_NAME.split(" ")) {
        expect([label, element.classList.contains(className)]).toEqual([
          label,
          true,
        ]);
      }
    }

    expect(screen.getByText("On call now")).toBeInTheDocument();
  });

  test("the upcoming turns are one list in one frame, the current one tinted - not a framed box each", () => {
    renderLayerSummary();

    const list: HTMLElement = screen.getByTestId("layer-upcoming-turns");

    expect(list.tagName).toBe("OL");
    expect(list.className).toBe(LAYER_TURNS_LIST_CLASS_NAME);
    // The Final schedule's own frame, clipped to its corners.
    for (const className of UPCOMING_HAND_OFFS_LIST_CLASS_NAME.split(" ")) {
      expect([className, list.classList.contains(className)]).toEqual([
        className,
        true,
      ]);
    }
    expect(list.classList.contains("overflow-hidden")).toBe(true);

    const rows: Array<Element> = Array.from(list.children);

    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.classList.contains("border")).toBe(false);
      expect(row.classList.contains("rounded-lg")).toBe(false);
    }

    // The turn on call now is the tinted one.
    const current: Element = screen
      .getByText("On call now")
      .closest("li") as Element;

    expect(current).toBe(rows[0]);
    expect(current.classList.contains("bg-indigo-50/50")).toBe(true);
    for (const row of rows.slice(1)) {
      expect(row.classList.contains("bg-indigo-50/50")).toBe(false);
    }
  });

  test("a weekly rotation's turns last 7d, not 6d 23h", () => {
    renderLayerSummary();

    const text: string = screen.getByTestId("layer-upcoming-turns")
      .textContent as string;

    expect(text).toContain("7d");
    expect(text).not.toContain("6d 23h");
  });
});
