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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A SKIP, AS THE FINAL SCHEDULE AND THE SCHEDULE TIMELINE DRAW IT (task
 * oncall-skip-user-until).
 *
 * A user override that names nobody to cover skips the person away: their
 * turn goes to the next person in the rotation who is not away. Every surface
 * that names who is on call has to say so - not "covered by an override" with
 * nobody named, and not "Unknown user":
 *
 *   - the calendar block names whoever has the turn, covering for the person
 *     away, and its tooltip says why it is them;
 *   - the overrides card shows the person away and "Next person in the
 *     rotation", with the rotation's icon where an avatar would be;
 *   - "on call right now" says the person is "Next in the rotation" -
 *     never "Skipped", which read as if they had been skipped - with the time
 *     away, and the hand-off rows carry the skip icon;
 *   - with everybody in the layer away, nobody is drawn on call;
 *   - the Schedule Timeline's bars say "Next in the rotation while ... is
 *     away" and "(away)".
 *
 * These drive the real LayersPreview against a stubbed API, as the override
 * clarity suite does.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers matter: jest.mock is hoisted above the compiled requires,
 * so the consts above are still in their temporal dead zone when the factory
 * body runs.
 */
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

// The calendar as a list that keeps each event's label, class and tooltip.
jest.mock("../../../UI/Components/Calendar/Calendar", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      return (
        <ul data-testid="calendar-events">
          {(props.events || []).map((event: any, index: number) => {
            return (
              <li
                key={index}
                data-testid="calendar-event"
                data-event-class={event.className || ""}
                data-event-desc={event.desc || ""}
                data-event-start={new Date(event.start).toISOString()}
                data-event-end={new Date(event.end).toISOString()}
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

import LayersPreview from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersPreview";
import FinalScheduleSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary";
import { formatShiftInstant } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import {
  OVERRIDE_EVENT_CLASS_NAME,
  OverrideSummaryRow,
  buildOverrideEventTooltip,
  buildOverrideSummaryRows,
  describeOverrideScope,
  describeShiftOverride,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import {
  OverriddenSegment,
  ShiftBar,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineBar";
import { TimelineShift } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineModel";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleShiftUtil, {
  OnCallShift,
  ScheduleCoverageState,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import { OverrideEventMeta } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID: string = "22222222-2222-4222-8222-222222222222";
const LAYER_ID: string = "33333333-3333-4333-8333-333333333333";

const ALICE_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const CAROL_ID: string = "cccccccc-3333-4333-8333-333333333333";

const ALICE: string = "Alice Scheduled";
const CAROL: string = "Carol Rotation";

const TIMEOUT_MS: number = 10000;

const USERS: Dictionary<{ name: string; email: string }> = {
  [ALICE_ID]: { name: ALICE, email: "alice@example.com" },
  [CAROL_ID]: { name: CAROL, email: "carol@example.com" },
};

function makeUser(id: string): User {
  const user: User = new User();
  user.id = new ObjectID(id);
  user.name = USERS[id]!.name as any;
  user.email = USERS[id]!.email as any;
  return user;
}

/*
 * Daily turns, Alice then Carol, handing off six hours off the current time of
 * day, 30 days in: Alice's turn began six hours ago, Carol's begins in
 * eighteen.
 */
function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  layer.id = new ObjectID(LAYER_ID);
  layer.projectId = new ObjectID(PROJECT_ID);
  layer.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
  layer.order = 1;
  layer.name = "Primary" as any;

  const anchor: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -30),
    -6,
  );
  layer.startsAt = anchor;
  layer.handOffTime = anchor;

  layer.rotation = Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: EventInterval.Day,
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
    [LAYER_ID]: [ALICE_ID, CAROL_ID].map((id: string, index: number) => {
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
      layerUser.user = makeUser(id);
      return layerUser;
    }),
  };
}

interface Away {
  who: string;
  startsAt: Date;
  endsAt: Date;
}

// A global skip: nobody named to cover.
function toModel(away: Away, index: number): OnCallDutyPolicyUserOverride {
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  model.id = new ObjectID(`7777777${index}-7777-4777-8777-777777777777`);
  model.projectId = new ObjectID(PROJECT_ID);
  model.overrideUserId = new ObjectID(away.who);
  model.overrideUser = makeUser(away.who);
  model.startsAt = away.startsAt;
  model.endsAt = away.endsAt;
  model.onCallDutyPolicyId = null as any;
  return model;
}

function setupApi(aways: Array<Away>): void {
  getListMock.mockImplementation((args: any) => {
    const modelName: string = args?.modelType?.name || "";

    if (modelName === "OnCallDutyPolicyUserOverride") {
      const data: Array<OnCallDutyPolicyUserOverride> = aways.map(toModel);
      return Promise.resolve({
        data,
        count: data.length,
        skip: 0,
        limit: data.length,
      });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
}

function renderPreview(): void {
  render(
    <LayersPreview
      layers={[makeLayer()]}
      allLayerUsers={makeLayerUsers()}
      timezone="UTC"
      onCallDutyPolicyScheduleId={new ObjectID(SCHEDULE_ID)}
    />,
  );
}

// To the whole second, as the calendar draws its blocks.
function hoursFromNow(hours: number): Date {
  const at: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.getCurrentDate(),
    hours,
  );
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

async function findSkipBlock(): Promise<HTMLElement> {
  let found: HTMLElement | null = null;

  await waitFor(
    () => {
      const match: HTMLElement | undefined = screen
        .getAllByTestId("calendar-event")
        .find((node: HTMLElement) => {
          return (
            node.getAttribute("data-event-class") ===
              OVERRIDE_EVENT_CLASS_NAME &&
            (node.getAttribute("data-event-desc") || "").startsWith("Skipped")
          );
        });
      if (!match) {
        throw new Error("no skip block yet");
      }
      found = match;
    },
    { timeout: TIMEOUT_MS },
  );

  return found!;
}

describe("the final schedule, with Alice skipped", () => {
  let aliceAway: Away;

  beforeEach(() => {
    getListMock.mockReset();
    aliceAway = {
      who: ALICE_ID,
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(3),
    };
    setupApi([aliceAway]);
  });

  afterEach(() => {
    cleanup();
  });

  test("the calendar block names Carol, covering for Alice, for exactly her time away", async () => {
    renderPreview();

    const block: HTMLElement = await findSkipBlock();

    expect(block.textContent).toContain(CAROL);
    expect(block.textContent).toContain(`covering ${ALICE}`);
    expect(block.getAttribute("data-event-start")).toBe(
      aliceAway.startsAt.toISOString(),
    );
    expect(block.getAttribute("data-event-end")).toBe(
      aliceAway.endsAt.toISOString(),
    );
  });

  test("its tooltip says why it is Carol, and for how long", async () => {
    renderPreview();

    const block: HTMLElement = await findSkipBlock();
    const lines: Array<string> = (
      block.getAttribute("data-event-desc") || ""
    ).split("\n");

    expect(lines[0]).toBe(`Skipped: ${ALICE} is away`);
    expect(lines[1]).toBe(
      `${CAROL} is next in the rotation, so this turn is theirs.`,
    );
    expect(lines[2]).toBe(
      `Away: ${formatShiftInstant(aliceAway.startsAt, "UTC")} → ${formatShiftInstant(aliceAway.endsAt, "UTC")}`,
    );
    expect(lines.join("\n")).not.toContain("Alerts that would page");
  });

  test("the overrides card: Alice away, the next person in the rotation covering", async () => {
    renderPreview();

    const card: HTMLElement = await screen.findByTestId(
      "active-overrides-card",
      undefined,
      { timeout: TIMEOUT_MS },
    );
    const row: HTMLElement = within(card).getByTestId("active-override-row");

    expect(row).toHaveTextContent(ALICE);
    expect(row).toHaveTextContent("Next person in the rotation");
    expect(
      within(row).getByTestId("active-override-rotation-avatar"),
    ).toBeInTheDocument();
    expect(row).not.toHaveTextContent("Unknown user");
  });

  test("'on call right now' says Carol is there because Alice is skipped", async () => {
    renderPreview();

    const strip: HTMLElement = await screen.findByTestId(
      "on-call-now-override",
      undefined,
      { timeout: TIMEOUT_MS },
    );

    expect(strip).toHaveAttribute("data-skip", "true");
    // Why it is Carol: she is next in the rotation, covering for Alice.
    expect(strip.firstElementChild).toHaveTextContent("Next in the rotation");
    expect(strip).toHaveTextContent(`Covering for ${ALICE}`);
    // Not "Skipped": next to Carol's name it read as if Carol was skipped.
    expect(strip).not.toHaveTextContent("Skipped");
    expect(strip).toHaveTextContent(
      `Away ${formatShiftInstant(aliceAway.startsAt, "UTC")} → ${formatShiftInstant(aliceAway.endsAt, "UTC")}`,
    );
    expect(strip).not.toHaveTextContent("Override runs");
  });

  test("the legend names no substitute: nobody was named", async () => {
    renderPreview();

    await findSkipBlock();

    expect(screen.queryByTestId("legend-covering-label")).toBeNull();
    // Still says what the striped blocks are.
    expect(screen.getByTestId("legend-override-key")).toBeInTheDocument();
  });
});

describe("the final schedule, with everybody in the layer skipped", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("nobody is drawn on call while they are all away", async () => {
    const from: Date = hoursFromNow(-1);
    const until: Date = hoursFromNow(30);

    setupApi([
      { who: ALICE_ID, startsAt: from, endsAt: until },
      { who: CAROL_ID, startsAt: from, endsAt: until },
    ]);
    renderPreview();

    await screen.findByText(
      "No one is currently on call in this schedule.",
      {
        exact: false,
      },
      { timeout: TIMEOUT_MS },
    );

    /*
     * No block puts anybody on call inside the time they are all away. The
     * calendar draws the rotation first and redraws once the overrides land,
     * so this waits for the drawing it ends on.
     */
    await waitFor(
      () => {
        const blocks: Array<HTMLElement> =
          screen.getAllByTestId("calendar-event");

        expect(blocks.length).toBeGreaterThan(0);

        for (const block of blocks) {
          const start: number = Date.parse(
            block.getAttribute("data-event-start") || "",
          );
          const end: number = Date.parse(
            block.getAttribute("data-event-end") || "",
          );

          const overlaps: boolean =
            start < until.getTime() - 1000 && end > from.getTime() + 1000;

          expect({ block: block.textContent, overlaps }).toEqual({
            block: block.textContent,
            overlaps: false,
          });
        }
      },
      { timeout: TIMEOUT_MS },
    );

    // Before and after it, they are on call as the rotation says.
    const names: Array<string> = screen
      .getAllByTestId("calendar-event")
      .map((block: HTMLElement) => {
        return block.textContent || "";
      });
    expect(
      names.some((name: string) => {
        return name.includes(ALICE);
      }),
    ).toBe(true);
    expect(
      names.some((name: string) => {
        return name.includes(CAROL);
      }),
    ).toBe(true);
  });
});

describe("the hand-off rows and the overrides card, from their inputs", () => {
  afterEach(() => {
    cleanup();
  });

  const userInfoById: Dictionary<{ name: string; email: string }> = USERS;

  function meta(isSkip: boolean): OverrideEventMeta {
    return {
      isOverride: true,
      originalUserId: ALICE_ID,
      overrideUserId: CAROL_ID,
      overrideStartsAt: hoursFromNow(10),
      overrideEndsAt: hoursFromNow(20),
      onCallDutyPolicyId: null,
      ...(isSkip ? { isSkip: true as const } : {}),
    };
  }

  test("describeShiftOverride says whether it is a skip", () => {
    expect(
      describeShiftOverride({
        override: meta(true),
        userInfoById,
        policyNameById: {},
      }),
    ).toMatchObject({
      originalName: ALICE,
      coveringLabel: `Covering for ${ALICE}`,
      isSkip: true,
    });

    expect(
      describeShiftOverride({
        override: meta(false),
        userInfoById,
        policyNameById: {},
      }).isSkip,
    ).toBe(false);
  });

  test("a hand-off row of a skip carries the skip mark; a cover's does not", () => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const shifts: Array<OnCallShift> = [
      {
        userId: ALICE_ID,
        start: hoursFromNow(-2),
        end: hoursFromNow(2),
        coverageSeconds: 4 * 3600,
      },
      {
        userId: CAROL_ID,
        start: hoursFromNow(2),
        end: hoursFromNow(10),
        coverageSeconds: 8 * 3600,
      },
      {
        userId: CAROL_ID,
        start: hoursFromNow(10),
        end: hoursFromNow(20),
        coverageSeconds: 10 * 3600,
        override: meta(true),
      },
      {
        userId: CAROL_ID,
        start: hoursFromNow(20),
        end: hoursFromNow(30),
        coverageSeconds: 10 * 3600,
        override: meta(false),
      },
    ];
    const windowEnd: Date = hoursFromNow(30);
    const coverage: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
      layerCount: 1,
      assignedUserCount: 2,
      shifts,
      now,
      windowEnd,
    });

    render(
      <FinalScheduleSummary
        shifts={shifts}
        now={now}
        windowEnd={windowEnd}
        timezone="UTC"
        userById={userInfoById}
        coverage={coverage}
      />,
    );

    const pills: Array<HTMLElement> = screen.getAllByTestId(
      "upcoming-override-pill",
    );

    expect(
      pills.map((pill: HTMLElement) => {
        return pill.getAttribute("data-skip");
      }),
    ).toEqual(["true", "false"]);
    for (const pill of pills) {
      expect(pill).toHaveTextContent(`Covering for ${ALICE}`);
    }
  });

  test("buildOverrideSummaryRows: a skip's row names the rotation, with no substitute id", () => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [
        {
          overrideUserId: ALICE_ID,
          routeAlertsToUserId: null,
          startsAt: hoursFromNow(-1),
          endsAt: hoursFromNow(5),
          onCallDutyPolicyId: null,
        },
        {
          overrideUserId: ALICE_ID,
          routeAlertsToUserId: CAROL_ID,
          startsAt: hoursFromNow(24),
          endsAt: hoursFromNow(30),
          onCallDutyPolicyId: null,
        },
      ],
      userInfoById,
      policyNameById: {},
      now,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      originalName: ALICE,
      substituteUserId: "",
      substituteName: "Next person in the rotation",
      isSkip: true,
      isActiveNow: true,
    });
    expect(rows[1]).toMatchObject({
      substituteUserId: CAROL_ID,
      substituteName: CAROL,
      isSkip: false,
      isActiveNow: false,
    });
    // Two rows, two keys: the skip's key does not borrow a substitute.
    expect(rows[0]!.key).not.toBe(rows[1]!.key);
    expect(rows[0]!.key).toContain("rotation");
  });

  test("buildOverrideEventTooltip: a cover's tooltip is as it was", () => {
    const tooltip: string = buildOverrideEventTooltip({
      substituteName: CAROL,
      originalName: ALICE,
      overrideStartsAt: hoursFromNow(1),
      overrideEndsAt: hoursFromNow(2),
      scope: describeOverrideScope({ onCallDutyPolicyId: null }),
      timezone: "UTC",
    });

    expect(tooltip.split("\n")[0]).toBe(`Override: ${ALICE} → ${CAROL}`);
    expect(tooltip).toContain(
      `Alerts that would page ${ALICE} go to ${CAROL}.`,
    );
    expect(tooltip).not.toContain("Skipped");
  });
});

describe("the Schedule Timeline's bars, for a skip", () => {
  afterEach(() => {
    cleanup();
  });

  const noop: () => void = (): void => {
    return undefined;
  };

  function shift(isSkip: boolean): TimelineShift {
    const now: Date = OneUptimeDate.getCurrentDate();
    const start: Date = OneUptimeDate.addRemoveHours(now, -2);
    const end: Date = OneUptimeDate.addRemoveHours(now, 2);

    return {
      key: `${CAROL_ID}:${start.toISOString()}`,
      userId: CAROL_ID,
      userName: CAROL,
      start,
      end,
      layerName: "Primary",
      override: {
        originalUserId: ALICE_ID,
        originalUserName: ALICE,
        start,
        end,
        isPolicyScoped: false,
        isSkip,
      },
    };
  }

  function renderBars(isSkip: boolean): void {
    const item: TimelineShift = shift(isSkip);
    const positioned: any = {
      item,
      left: 0,
      width: 50,
      continuesBefore: false,
      continuesAfter: false,
    };

    render(
      <div>
        <ShiftBar
          positioned={positioned}
          widthPx={400}
          scheduleName="Primary"
          timezone="UTC"
          use12HourFormat={false}
          now={OneUptimeDate.getCurrentDate()}
          highlightedUserId={null}
          onToggleHighlight={noop}
        />
        <OverriddenSegment
          positioned={positioned}
          widthPx={400}
          timezone="UTC"
          use12HourFormat={false}
          highlightedUserId={null}
        />
      </div>,
    );
  }

  // Everything the two bars say, their tooltips included once opened.
  async function allText(): Promise<string> {
    for (const trigger of Array.from(
      document.querySelectorAll("[tabindex], button"),
    )) {
      fireEvent.mouseEnter(trigger);
      fireEvent.focus(trigger);
    }

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });

    return document.body.textContent || "";
  }

  test("a skip: next in the rotation while Alice is away, and Alice '(away)'", async () => {
    renderBars(true);

    const text: string = await allText();

    expect(text).toContain(`Next in the rotation while ${ALICE} is away.`);
    expect(text).toContain("(away)");
    expect(text).not.toContain("(overridden)");
    expect(text).not.toContain("through an override");
  });

  test("a cover still reads as an override", async () => {
    renderBars(false);

    const text: string = await allText();

    expect(text).toContain(`Covering for ${ALICE} through an override.`);
    expect(text).toContain("(overridden)");
    expect(text).not.toContain("(away)");
  });
});
