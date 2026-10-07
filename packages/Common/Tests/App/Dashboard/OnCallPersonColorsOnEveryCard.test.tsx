import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * One person, one colour, on every on-call card.
 *
 * The on-call screens draw a person in several places at once - the avatars
 * in a layer's header, its users list and the Add user dialog, the rotation
 * summary, the final schedule's "on call now" and hand-off rows, the
 * overrides card, and the Schedule Timeline's bars and legend - and a reader
 * follows a person from one to the next by colour. These tests render each
 * card for the same people and read the colours the DOM really paints:
 *
 *   - every avatar is its person's palette colour, with white initials given
 *     inline (never a theme class the dark theme could fade);
 *   - a person is the same colour on every card, and two people are not
 *     swapped;
 *   - a person the old palette drew black (one in twenty) now shows a palette
 *     colour everywhere.
 *
 * The users list and the Add user dialog load their people through the API,
 * which is stubbed here.
 */

const getListMock: MockFunction = getJestMockFunction();
const searchProjectUsersMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers matter: jest.mock is hoisted above the consts, so the
 * mocks are only dereferenced when a call happens.
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
            return "11111111-1111-4111-8111-111111111111";
          },
        };
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      searchProjectUsers: (...args: Array<any>) => {
        return searchProjectUsersMock(...args);
      },
    },
  };
});

import ActiveOverridesCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard";
import AddLayerUserModal from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/AddLayerUserModal";
import FinalScheduleSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary";
import LayerCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerCard";
import LayerRotationSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerRotationSummary";
import {
  LayerPreviewResult,
  getLayerPreviewEvents,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerShiftPreview";
import LayerUser from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUser";
import {
  getColorForUserId,
  getUserInitials,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUserColors";
import {
  OverrideSummaryRow,
  OverrideUserDisplayInfo,
  buildOverrideSummaryRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import {
  OverriddenSegment,
  ShiftBar,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineBar";
import TimelineLegend from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineLegend";
import TimelineModel, {
  TimelinePerson,
  TimelineShift,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineModel";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import * as BrandColors from "../../../Types/BrandColors";
import Color, { RGB } from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import EventInterval from "../../../Types/Events/EventInterval";
import HashCode from "../../../Types/HashCode";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleShiftUtil, {
  OnCallShift,
  ScheduleCoverageState,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import { TimelineViewMode } from "../../../Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import { UserOverrideRecord } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import { rgbToHex } from "../../../UI/Components/ColorPicker/ColorValue";
import { parseColor } from "../../../Utils/ColorContrast";
import { DISTINCT_COLORS } from "../../../Utils/DistinctColor";

interface Person {
  id: string;
  name: string;
  email: string;
  initials: string;
}

function person(id: string, name: string): Person {
  const email: string = `${name.split(" ")[0]!.toLowerCase()}@example.com`;

  return { id, name, email, initials: getUserInitials(name, email) };
}

/*
 * Four people, each a different palette colour, so a card that drew one
 * person in another's colour is caught. Dana is one of the people the old
 * palette (BrandColors.BrightColors) drew black.
 */
const ALICE: Person = person(
  "a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b",
  "Alice Andersson",
);
const BOB: Person = person("b7e2d3c4-6a5f-4e81-9b0c-1d2e3f4a5b6c", "Bob Berg");
const CAROL: Person = person(
  "c9d8e7f6-a5b4-4c3d-8e2f-1a0b9c8d7e6f",
  "Carol Chen",
);
const DANA: Person = person(
  "9f3b2c1d-7e6a-4b5c-8d9e-000000000005",
  "Dana Dark",
);

const PEOPLE: Array<Person> = [ALICE, BOB, CAROL, DANA];

const PALETTE: Array<string> = DISTINCT_COLORS.map((color: Color): string => {
  return color.toString();
});

const WHITE: string = "#ffffff";

const noop: () => void = (): void => {
  return undefined;
};

// A colour as the DOM reports it ("rgb(2, 132, 199)") as lowercase hex.
function toHex(cssColor: string): string {
  const rgb: RGB | null = parseColor(cssColor);

  if (!rgb) {
    throw new Error(`Not a colour: "${cssColor}"`);
  }

  return rgbToHex(rgb);
}

interface AvatarPaint {
  background: string;
  text: string;
}

function readPaint(element: HTMLElement): AvatarPaint {
  return {
    background: toHex(element.style.backgroundColor),
    text: toHex(element.style.color),
  };
}

// Every avatar on screen that shows this person's initials.
function avatarsOf(somebody: Person): Array<HTMLElement> {
  return screen.getAllByText(somebody.initials, { exact: true });
}

// Each of this person's avatars: their colour, white initials, no theme class.
function expectAvatarsPainted(somebody: Person, minimum: number = 1): void {
  const avatars: Array<HTMLElement> = avatarsOf(somebody);

  expect(avatars.length).toBeGreaterThanOrEqual(minimum);

  for (const avatar of avatars) {
    expect({ who: somebody.name, paint: readPaint(avatar) }).toEqual({
      who: somebody.name,
      paint: { background: getColorForUserId(somebody.id), text: WHITE },
    });
    // The initials' colour is inline, so the dark theme cannot fade it.
    expect(avatar.className).not.toMatch(/\btext-white\b/);
  }
}

function makeUser(somebody: Person): User {
  const user: User = new User();
  user.id = new ObjectID(somebody.id);
  user.name = somebody.name as any;
  user.email = somebody.email as any;
  return user;
}

function makeLayerUser(
  somebody: Person,
  order: number,
): OnCallDutyPolicyScheduleLayerUser {
  const layerUser: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  layerUser.id = new ObjectID(`6666666${order}-6666-4666-8666-666666666666`);
  layerUser.userId = new ObjectID(somebody.id);
  layerUser.user = makeUser(somebody);
  layerUser.order = order;
  return layerUser;
}

function layerUsers(): Array<OnCallDutyPolicyScheduleLayerUser> {
  return PEOPLE.map((somebody: Person, index: number) => {
    return makeLayerUser(somebody, index + 1);
  });
}

function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  /*
   * Hands off daily, six hours off the current time of day: a hand-off that
   * fell on "now" itself would leave the engine's one-second seam between
   * two people, with nobody on call at that instant.
   */
  const anchor: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -30),
    -6,
  );

  layer.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  layer.name = "Primary" as any;
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

function userInfoById(): Dictionary<OverrideUserDisplayInfo> {
  const info: Dictionary<OverrideUserDisplayInfo> = {};

  for (const somebody of PEOPLE) {
    info[somebody.id] = { name: somebody.name, email: somebody.email };
  }

  return info;
}

function hoursFromNow(now: Date, hours: number): Date {
  return OneUptimeDate.addRemoveHours(now, hours);
}

function renderLayerCard(): void {
  render(
    <LayerCard
      layer={makeLayer()}
      users={layerUsers()}
      timezone="UTC"
      index={0}
      total={1}
      isExpanded={false}
      actionsDisabled={false}
      isDeleteButtonLoading={false}
      overrides={[]}
      overridePolicyContextId=""
      overrideUserInfo={{}}
      onToggleExpand={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      onDeleteLayer={noop}
      onLayerChange={noop}
      onUsersChange={noop}
    />,
  );
}

function renderRotationSummary(): void {
  const preview: LayerPreviewResult = getLayerPreviewEvents({
    layer: makeLayer(),
    users: layerUsers(),
    timezone: "UTC",
    numberOfShifts: 8,
    overrides: [],
  });

  render(
    <LayerRotationSummary
      layer={makeLayer()}
      users={layerUsers()}
      timezone="UTC"
      events={preview.events}
      now={preview.now}
      numberOfShifts={8}
      hasLowerPriorityLayer={false}
      overrideUserInfo={{}}
    />,
  );
}

// Alice now, then Bob (up next), then Carol and Dana in the hand-off list.
function renderFinalScheduleSummary(): void {
  const now: Date = OneUptimeDate.getCurrentDate();
  const shifts: Array<OnCallShift> = PEOPLE.map(
    (somebody: Person, index: number): OnCallShift => {
      return {
        userId: somebody.id,
        start: hoursFromNow(now, index * 2 - 1),
        end: hoursFromNow(now, index * 2 + 1),
        coverageSeconds: 2 * 3600,
      };
    },
  );
  const windowEnd: Date = hoursFromNow(now, PEOPLE.length * 2);
  const coverage: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
    layerCount: 1,
    assignedUserCount: PEOPLE.length,
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
      userById={userInfoById()}
      coverage={coverage}
    />,
  );
}

// Alice away, covered by Bob now; Carol away, covered by Dana tomorrow.
function renderActiveOverridesCard(): void {
  const now: Date = OneUptimeDate.getCurrentDate();
  const records: Array<UserOverrideRecord> = [
    {
      overrideUserId: ALICE.id,
      routeAlertsToUserId: BOB.id,
      startsAt: hoursFromNow(now, -1),
      endsAt: hoursFromNow(now, 1),
      onCallDutyPolicyId: null,
    },
    {
      overrideUserId: CAROL.id,
      routeAlertsToUserId: DANA.id,
      startsAt: hoursFromNow(now, 24),
      endsAt: hoursFromNow(now, 30),
      onCallDutyPolicyId: null,
    },
  ];
  const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
    records,
    userInfoById: userInfoById(),
    policyNameById: {},
    now,
  });

  render(
    <ActiveOverridesCard
      rows={rows}
      userById={userInfoById()}
      timezone="UTC"
    />,
  );
}

async function renderAddUserDialog(): Promise<void> {
  searchProjectUsersMock.mockImplementation(async () => {
    return PEOPLE.map((somebody: Person) => {
      return {
        userId: somebody.id,
        name: somebody.name,
        email: somebody.email,
      };
    });
  });

  render(
    <AddLayerUserModal layer={makeLayer()} onClose={noop} onUserAdded={noop} />,
  );

  await screen.findByText(DANA.name);
}

async function renderUsersList(): Promise<void> {
  getListMock.mockImplementation(async () => {
    const data: Array<OnCallDutyPolicyScheduleLayerUser> = layerUsers();
    return { data, count: data.length, skip: 0, limit: data.length };
  });

  render(<LayerUser layer={makeLayer()} onUpdateUsers={noop} />);

  await screen.findByText(DANA.name);
}

function timelineShift(
  somebody: Person,
  start: Date,
  end: Date,
  override: Person | null = null,
): TimelineShift {
  return {
    key: `${somebody.id}:${start.toISOString()}`,
    userId: somebody.id,
    userName: somebody.name,
    start,
    end,
    layerName: "Primary",
    override: override
      ? {
          originalUserId: override.id,
          originalUserName: override.name,
          start,
          end,
          isPolicyScoped: false,
        }
      : null,
  };
}

// One wide bar per person, each in its own render, as the grid draws them.
function renderTimelineBar(somebody: Person, coveringFor?: Person): void {
  const now: Date = OneUptimeDate.getCurrentDate();
  const shift: TimelineShift = timelineShift(
    somebody,
    hoursFromNow(now, -2),
    hoursFromNow(now, 2),
    coveringFor || null,
  );

  render(
    <div>
      <ShiftBar
        positioned={{
          item: shift,
          left: 0,
          width: 50,
          continuesBefore: false,
          continuesAfter: false,
        }}
        widthPx={400}
        scheduleName="Primary"
        timezone="UTC"
        use12HourFormat={false}
        now={now}
        highlightedUserId={null}
        onToggleHighlight={noop}
      />
      {coveringFor ? (
        <OverriddenSegment
          positioned={{
            item: shift,
            left: 0,
            width: 50,
            continuesBefore: false,
            continuesAfter: false,
          }}
          widthPx={400}
          timezone="UTC"
          use12HourFormat={false}
          highlightedUserId={null}
        />
      ) : null}
    </div>,
  );
}

function renderTimelineLegend(): Array<TimelinePerson> {
  const now: Date = OneUptimeDate.getCurrentDate();
  const people: Array<TimelinePerson> = TimelineModel.collectPeople({
    schedules: [
      {
        id: "s-primary",
        name: "Primary",
        timezone: null,
        ownerTeamIds: [],
        isCurrentUserOnRoster: false,
        truncated: false,
        shifts: PEOPLE.map((somebody: Person, index: number) => {
          return timelineShift(
            somebody,
            hoursFromNow(now, index * 6),
            hoursFromNow(now, index * 6 + 6),
          );
        }),
      },
    ],
    window: { start: hoursFromNow(now, -24), end: hoursFromNow(now, 72) },
    now,
  });

  render(
    <TimelineLegend
      people={people}
      mode={TimelineViewMode.Week}
      timezone="UTC"
      highlightedUserId={null}
      onToggleHighlight={noop}
      showOverrideKey={false}
      showGapKey={false}
    />,
  );

  return people;
}

const RGB_CHANNELS: RegExp = /rgba?\((\d+),\s*(\d+),\s*(\d+)/;

// The rgb part of an rgba() border, as hex.
function rgbaToHex(cssColor: string): string {
  const match: RegExpExecArray | null = RGB_CHANNELS.exec(cssColor);

  if (!match) {
    throw new Error(`Not an rgb colour: "${cssColor}"`);
  }

  return rgbToHex({
    red: Number(match[1]),
    green: Number(match[2]),
    blue: Number(match[3]),
  });
}

beforeEach(() => {
  getListMock.mockReset();
  searchProjectUsersMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the people these tests draw", () => {
  test("are four different palette colours, and Dana is one the old palette drew black", () => {
    const colors: Array<string> = PEOPLE.map((somebody: Person): string => {
      return getColorForUserId(somebody.id);
    });

    expect(new Set(colors).size).toBe(PEOPLE.length);

    for (const color of colors) {
      expect(PALETTE).toContain(color);
    }

    const oldIndex: number =
      Math.abs(HashCode.fromString(DANA.id)) % BrandColors.BrightColors.length;

    expect(BrandColors.BrightColors[oldIndex]!.toString()).toBe(
      BrandColors.Black.toString(),
    );
  });

  test("have initials no two of them share", () => {
    expect(
      new Set(
        PEOPLE.map((somebody: Person): string => {
          return somebody.initials;
        }),
      ).size,
    ).toBe(PEOPLE.length);
  });
});

describe("the layer card's header", () => {
  test("draws each person's avatar in their colour, with white initials", () => {
    renderLayerCard();

    for (const somebody of PEOPLE) {
      expectAvatarsPainted(somebody, 1);
    }
  });

  test("marks whoever is on call now with their colour", () => {
    renderLayerCard();

    const label: HTMLElement = screen.getByText(/on call now/i);
    const line: HTMLElement = label.closest("div") as HTMLElement;
    const lineText: string = line.textContent || "";
    const onCall: Person | undefined = PEOPLE.find(
      (somebody: Person): boolean => {
        return lineText.includes(`${somebody.name} on call now`);
      },
    );

    expect(onCall).toBeDefined();

    const dot: HTMLElement = line.querySelector("span[style]") as HTMLElement;

    expect(toHex(dot.style.backgroundColor)).toBe(
      getColorForUserId(onCall!.id),
    );
  });
});

describe("the rotation summary", () => {
  test("draws each person's turn-order chip and shift rows in their colour", () => {
    renderRotationSummary();

    for (const somebody of PEOPLE) {
      // The turn-order chip, and at least one upcoming shift row each.
      expectAvatarsPainted(somebody, 2);
    }
  });
});

describe("the final schedule's summary", () => {
  test("draws who is on call now, who is next and each hand-off in their colour", () => {
    renderFinalScheduleSummary();

    expect(screen.getByText(ALICE.name)).toBeInTheDocument();

    for (const somebody of PEOPLE) {
      expectAvatarsPainted(somebody, 1);
    }
  });
});

describe("the overrides card", () => {
  test("draws the person away and the person covering, each in their own colour", () => {
    renderActiveOverridesCard();

    expect(screen.getAllByTestId("active-override-row")).toHaveLength(2);

    for (const somebody of PEOPLE) {
      expectAvatarsPainted(somebody, 1);
    }
  });
});

describe("the Add user dialog", () => {
  test("shows each project member in the colour they will have on the layer", async () => {
    await renderAddUserDialog();

    for (const somebody of PEOPLE) {
      expectAvatarsPainted(somebody, 1);
    }
  });
});

describe("the layer's users list", () => {
  test("draws each person in the list in their colour", async () => {
    await renderUsersList();

    for (const somebody of PEOPLE) {
      expectAvatarsPainted(somebody, 1);
    }
  });
});

describe("the Schedule Timeline", () => {
  test("draws a person's bar and its avatar in their colour", () => {
    for (const somebody of PEOPLE) {
      renderTimelineBar(somebody);

      expectAvatarsPainted(somebody, 1);

      const bar: HTMLElement = screen.getByTestId("timeline-shift-bar");

      expect(toHex(bar.style.borderLeftColor)).toBe(
        getColorForUserId(somebody.id),
      );

      cleanup();
    }
  });

  test("strikes through a covered person's shift in that person's colour", () => {
    renderTimelineBar(BOB, ALICE);

    const segment: HTMLElement = screen.getByTestId(
      "timeline-overridden-segment",
    );

    expect(rgbaToHex(segment.style.borderTopColor)).toBe(
      getColorForUserId(ALICE.id),
    );
    // The bar above it is the person covering, in their own colour.
    expect(
      toHex(screen.getByTestId("timeline-shift-bar").style.borderLeftColor),
    ).toBe(getColorForUserId(BOB.id));
  });

  test("lists each person under the grid with a dot in their colour", () => {
    const people: Array<TimelinePerson> = renderTimelineLegend();

    expect(people).toHaveLength(PEOPLE.length);

    for (const somebody of PEOPLE) {
      const chip: HTMLElement = screen
        .getAllByTestId("timeline-person")
        .find((element: HTMLElement): boolean => {
          return element.getAttribute("data-user-id") === somebody.id;
        }) as HTMLElement;

      expect(chip).toBeDefined();

      const dot: HTMLElement = chip.querySelector("span[style]") as HTMLElement;

      expect(toHex(dot.style.backgroundColor)).toBe(
        getColorForUserId(somebody.id),
      );
    }
  });
});

describe("one person, one colour", () => {
  /*
   * Every card, rendered one after another, read for the same person: the
   * colours collected must be one colour - theirs - and never another
   * person's.
   */
  async function collectColorsOf(somebody: Person): Promise<Set<string>> {
    const seen: Set<string> = new Set<string>();

    const collect: () => void = (): void => {
      for (const avatar of avatarsOf(somebody)) {
        seen.add(readPaint(avatar).background);
      }
    };

    const renders: Array<() => void | Promise<void>> = [
      renderLayerCard,
      renderRotationSummary,
      renderFinalScheduleSummary,
      renderActiveOverridesCard,
      renderAddUserDialog,
      renderUsersList,
      (): void => {
        renderTimelineBar(somebody);
      },
    ];

    for (const draw of renders) {
      await draw();
      await waitFor(() => {
        expect(avatarsOf(somebody).length).toBeGreaterThan(0);
      });
      collect();
      cleanup();
    }

    return seen;
  }

  const CASES: Array<[string, Person]> = PEOPLE.map(
    (somebody: Person): [string, Person] => {
      return [somebody.name, somebody];
    },
  );

  test.each(CASES)(
    "%s is the same colour on every card",
    async (_name: string, somebody: Person) => {
      const seen: Set<string> = await collectColorsOf(somebody);

      expect(Array.from(seen)).toEqual([getColorForUserId(somebody.id)]);
    },
  );

  test("Dana, whom the old palette drew black, is a palette colour on every card", async () => {
    const seen: Set<string> = await collectColorsOf(DANA);

    expect(seen.has(BrandColors.Black.toString())).toBe(false);
    expect(
      Array.from(seen).every((color: string): boolean => {
        return PALETTE.includes(color);
      }),
    ).toBe(true);
  });
});
