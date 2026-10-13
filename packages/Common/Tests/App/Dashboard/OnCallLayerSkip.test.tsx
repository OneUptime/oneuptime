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
 * SKIPPING SOMEBODY, AS A SCHEDULE'S LAYERS SHOW IT (task
 * oncall-skip-user-until).
 *
 * A user override that names nobody to cover skips the person away: each of
 * their turns goes to the next person in the rotation who is not away. The
 * Layers tab is where people look when somebody goes on holiday, so:
 *
 *   - the person's row says they are away - "Away until ..." while it is in
 *     force, "Away from ..." when it is booked - and its tooltip says who has
 *     their turns: the rotation, or the person named;
 *   - each row offers "Skip until..." (it hands the page the person, which
 *     opens SkipLayerUserModal);
 *   - the card's "on call now" line names whoever has the turn, covering for
 *     the person away, and says so when everybody in the layer is away;
 *   - the turns list never runs one person's turn across days that nobody in
 *     the layer is on call.
 *
 * The users list loads its people through the API, which is stubbed here.
 */

const getListMock: MockFunction = getJestMockFunction();

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

import LayerCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerCard";
import LayerRotationSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerRotationSummary";
import {
  LayerPreviewResult,
  getLayerPreviewEvents,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerShiftPreview";
import { formatShiftInstant } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import LayerUser from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUser";
import {
  LayerUserAway,
  getLayerUserAway,
  isEveryoneInLayerAway,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUserAway";
import { OverrideUserInfo } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ScheduleOverrides";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { UserOverrideRecord } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

interface Person {
  id: string;
  name: string;
}

const ALICE: Person = {
  id: "a1a1a1a1-1111-4111-8111-111111111111",
  name: "Alice Andersson",
};
const BOB: Person = {
  id: "b2b2b2b2-2222-4222-8222-222222222222",
  name: "Bob Berg",
};
const CAROL: Person = {
  id: "c3c3c3c3-3333-4333-8333-333333333333",
  name: "Carol Chen",
};
// Not in the layer: somebody named to cover.
const DANA: Person = {
  id: "d4d4d4d4-4444-4444-8444-444444444444",
  name: "Dana Dark",
};

const ROTATION: Array<Person> = [ALICE, BOB, CAROL];

const POLICY_ID: string = "e5e5e5e5-5555-4555-8555-555555555555";

const COVER_INFO: Dictionary<OverrideUserInfo> = {
  [DANA.id]: { name: DANA.name, email: "dana@example.com" },
};

const noop: () => void = (): void => {
  return undefined;
};

function makeUser(somebody: Person): User {
  const user: User = new User();
  user.id = new ObjectID(somebody.id);
  user.name = somebody.name as any;
  user.email =
    `${somebody.name.split(" ")[0]!.toLowerCase()}@example.com` as any;
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
  return ROTATION.map((somebody: Person, index: number) => {
    return makeLayerUser(somebody, index + 1);
  });
}

/*
 * Daily turns, Alice -> Bob -> Carol, handing off six hours off the current
 * time of day, 30 days in: Alice's turn began six hours ago and Bob's begins
 * in eighteen. (A hand-off on "now" itself would leave the engine's
 * one-second seam between two people.)
 */
function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
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

function hoursFromNow(hours: number): Date {
  return OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), hours);
}

// Time away for one person: a skip, unless somebody is named to cover.
function away(data: {
  who: Person;
  from: Date;
  until: Date;
  cover?: Person | undefined;
  policyId?: string | undefined;
}): UserOverrideRecord {
  return {
    overrideUserId: data.who.id,
    routeAlertsToUserId: data.cover ? data.cover.id : null,
    startsAt: data.from,
    endsAt: data.until,
    onCallDutyPolicyId: data.policyId || null,
  };
}

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("getLayerUserAway: is somebody in a layer away, now or soon", () => {
  const NOW: Date = OneUptimeDate.fromString("2026-03-03T12:00:00.000Z");
  const at: (iso: string) => Date = (iso: string): Date => {
    return OneUptimeDate.fromString(iso);
  };

  test("nobody away: no override, somebody else's, or one that has ended", () => {
    expect(
      getLayerUserAway({ userId: ALICE.id, overrides: [], now: NOW }),
    ).toBeNull();

    expect(
      getLayerUserAway({
        userId: ALICE.id,
        overrides: [
          away({
            who: BOB,
            from: at("2026-03-03T00:00:00Z"),
            until: at("2026-03-05T00:00:00Z"),
          }),
          away({
            who: ALICE,
            from: at("2026-03-01T00:00:00Z"),
            until: at("2026-03-03T12:00:00Z"),
          }),
        ],
        now: NOW,
      }),
    ).toBeNull();
  });

  test("away now, skipped: until when, and nobody named", () => {
    const found: LayerUserAway | null = getLayerUserAway({
      userId: ALICE.id,
      overrides: [
        away({
          who: ALICE,
          from: at("2026-03-03T09:00:00Z"),
          until: at("2026-03-06T12:00:00Z"),
        }),
      ],
      now: NOW,
    });

    expect(found).toEqual({
      startsAt: at("2026-03-03T09:00:00Z"),
      endsAt: at("2026-03-06T12:00:00Z"),
      isNow: true,
      isSkip: true,
      coverUserId: null,
    });
  });

  test("away now with somebody named: it is not a skip, and says who covers", () => {
    const found: LayerUserAway | null = getLayerUserAway({
      userId: ALICE.id,
      overrides: [
        away({
          who: ALICE,
          from: at("2026-03-03T09:00:00Z"),
          until: at("2026-03-04T09:00:00Z"),
          cover: DANA,
        }),
      ],
      now: NOW,
    });

    expect(found?.isNow).toBe(true);
    expect(found?.isSkip).toBe(false);
    expect(found?.coverUserId).toBe(DANA.id);
  });

  test("booked, not yet in force: the next one to start", () => {
    const found: LayerUserAway | null = getLayerUserAway({
      userId: ALICE.id,
      overrides: [
        away({
          who: ALICE,
          from: at("2026-03-20T09:00:00Z"),
          until: at("2026-03-27T09:00:00Z"),
        }),
        away({
          who: ALICE,
          from: at("2026-03-09T09:00:00Z"),
          until: at("2026-03-10T09:00:00Z"),
          cover: DANA,
        }),
      ],
      now: NOW,
    });

    expect(found).toEqual({
      startsAt: at("2026-03-09T09:00:00Z"),
      endsAt: at("2026-03-10T09:00:00Z"),
      isNow: false,
      isSkip: false,
      coverUserId: DANA.id,
    });
  });

  test("in force beats booked, however soon the booked one starts", () => {
    const found: LayerUserAway | null = getLayerUserAway({
      userId: ALICE.id,
      overrides: [
        away({
          who: ALICE,
          from: at("2026-03-03T12:30:00Z"),
          until: at("2026-03-03T13:00:00Z"),
          cover: DANA,
        }),
        away({
          who: ALICE,
          from: at("2026-03-01T00:00:00Z"),
          until: at("2026-03-08T00:00:00Z"),
        }),
      ],
      now: NOW,
    });

    expect(found?.isNow).toBe(true);
    expect(found?.isSkip).toBe(true);
    expect(found?.endsAt).toEqual(at("2026-03-08T00:00:00Z"));
  });

  test("of two in force, the one the schedules follow: a policy's cover outranks a global skip", () => {
    const found: LayerUserAway | null = getLayerUserAway({
      userId: ALICE.id,
      overrides: [
        away({
          who: ALICE,
          from: at("2026-03-01T00:00:00Z"),
          until: at("2026-03-10T00:00:00Z"),
        }),
        away({
          who: ALICE,
          from: at("2026-03-03T00:00:00Z"),
          until: at("2026-03-04T00:00:00Z"),
          cover: DANA,
          policyId: POLICY_ID,
        }),
      ],
      now: NOW,
    });

    expect(found?.isSkip).toBe(false);
    expect(found?.coverUserId).toBe(DANA.id);
  });

  test("of two in force alike, the one that ends last", () => {
    const found: LayerUserAway | null = getLayerUserAway({
      userId: ALICE.id,
      overrides: [
        away({
          who: ALICE,
          from: at("2026-03-02T00:00:00Z"),
          until: at("2026-03-04T00:00:00Z"),
        }),
        away({
          who: ALICE,
          from: at("2026-03-03T00:00:00Z"),
          until: at("2026-03-09T00:00:00Z"),
        }),
      ],
      now: NOW,
    });

    expect(found?.endsAt).toEqual(at("2026-03-09T00:00:00Z"));
  });

  test("an override that ends before it starts is no time away at all", () => {
    expect(
      getLayerUserAway({
        userId: ALICE.id,
        overrides: [
          away({
            who: ALICE,
            from: at("2026-03-09T00:00:00Z"),
            until: at("2026-03-08T00:00:00Z"),
          }),
        ],
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("isEveryoneInLayerAway", () => {
  const NOW: Date = OneUptimeDate.fromString("2026-03-03T12:00:00.000Z");
  const FROM: Date = OneUptimeDate.fromString("2026-03-03T00:00:00.000Z");
  const UNTIL: Date = OneUptimeDate.fromString("2026-03-05T00:00:00.000Z");
  const ids: Array<string> = ROTATION.map((somebody: Person) => {
    return somebody.id;
  });

  test("true when every person in it is away right now, skipped or covered", () => {
    expect(
      isEveryoneInLayerAway({
        userIds: ids,
        overrides: [
          away({ who: ALICE, from: FROM, until: UNTIL }),
          away({ who: BOB, from: FROM, until: UNTIL, cover: DANA }),
          away({ who: CAROL, from: FROM, until: UNTIL }),
        ],
        now: NOW,
      }),
    ).toBe(true);
  });

  test("false while anybody in it is not away - or is only booked to be", () => {
    expect(
      isEveryoneInLayerAway({
        userIds: ids,
        overrides: [
          away({ who: ALICE, from: FROM, until: UNTIL }),
          away({ who: BOB, from: FROM, until: UNTIL }),
        ],
        now: NOW,
      }),
    ).toBe(false);

    expect(
      isEveryoneInLayerAway({
        userIds: ids,
        overrides: [
          away({ who: ALICE, from: FROM, until: UNTIL }),
          away({ who: BOB, from: FROM, until: UNTIL }),
          away({
            who: CAROL,
            from: OneUptimeDate.fromString("2026-03-04T00:00:00.000Z"),
            until: UNTIL,
          }),
        ],
        now: NOW,
      }),
    ).toBe(false);
  });

  test("false for a layer with nobody in it: that is a different problem", () => {
    expect(
      isEveryoneInLayerAway({ userIds: [], overrides: [], now: NOW }),
    ).toBe(false);
  });
});

function renderCard(options: {
  overrides: Array<UserOverrideRecord>;
  overrideUserInfo?: Dictionary<OverrideUserInfo> | undefined;
}): void {
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
      overrides={options.overrides}
      overridePolicyContextId=""
      overrideUserInfo={options.overrideUserInfo || {}}
      onToggleExpand={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      onDeleteLayer={noop}
      onLayerChange={noop}
      onUsersChange={noop}
    />,
  );
}

// The card's live line: "<name> on call now", or why nobody is.
function liveLine(): HTMLElement {
  const dot: HTMLElement | null = document.querySelector(
    "span.inline-block.h-2.w-2.rounded-full",
  );

  if (!dot?.parentElement) {
    throw new Error("No live line on the card");
  }

  return dot.parentElement;
}

describe("the layer card's 'on call now' line", () => {
  test("baseline: Alice has the turn", () => {
    renderCard({ overrides: [] });

    expect(liveLine()).toHaveTextContent(`${ALICE.name} on call now`);
    expect(screen.queryByTestId("layer-card-covering")).toBeNull();
  });

  test("Alice skipped: the next person in the rotation has her turn, covering for her", () => {
    renderCard({
      overrides: [
        away({ who: ALICE, from: hoursFromNow(-1), until: hoursFromNow(3) }),
      ],
    });

    expect(liveLine()).toHaveTextContent(`${BOB.name} on call now`);
    // The name as it is written: never lowercased ("alice ...").
    expect(screen.getByTestId("layer-card-covering").textContent).toBe(
      `(Covering for ${ALICE.name})`,
    );
    expect(screen.queryByTestId("layer-card-everyone-away")).toBeNull();
  });

  /*
   * The line wraps on a phone. The dot used to be a flex item of its own, so
   * a long status left it alone on the first line, and "Up next" started the
   * next line with a dangling "·".
   */
  test("on a phone the dot stays with what it marks, and 'Up next' takes a line of its own", () => {
    renderCard({
      overrides: [
        away({ who: ALICE, from: hoursFromNow(-1), until: hoursFromNow(3) }),
      ],
    });

    const status: HTMLElement = screen.getByTestId("layer-card-live-status");

    // The dot and the status it marks wrap as one.
    expect(
      status.querySelector("span.inline-block.h-2.w-2.rounded-full"),
    ).not.toBeNull();
    expect(status).toHaveTextContent(`${BOB.name} on call now`);
    expect(status).toHaveTextContent(`(Covering for ${ALICE.name})`);
    expect(status).not.toHaveTextContent("Up next");

    // "Up next" is a line of its own below sm, and joins the line from sm up.
    const upNext: HTMLElement = screen.getByTestId("layer-card-up-next");
    expect(upNext).toHaveTextContent("Up next");
    expect(upNext.className.split(" ")).toEqual(
      expect.arrayContaining(["basis-full", "sm:basis-auto"]),
    );

    // The "·" between them shows only where they share a line.
    const separator: HTMLElement = upNext.previousElementSibling as HTMLElement;
    expect(separator.textContent).toBe("·");
    expect(separator.className.split(" ")).toEqual(
      expect.arrayContaining(["hidden", "sm:inline"]),
    );
  });

  test("Alice and Bob skipped: it goes on to Carol, never to somebody away", () => {
    renderCard({
      overrides: [
        away({ who: ALICE, from: hoursFromNow(-1), until: hoursFromNow(3) }),
        away({ who: BOB, from: hoursFromNow(-1), until: hoursFromNow(3) }),
      ],
    });

    expect(liveLine()).toHaveTextContent(`${CAROL.name} on call now`);
    expect(liveLine()).not.toHaveTextContent(`${BOB.name} on call now`);
  });

  test("everybody in the layer skipped: it says so, and names nobody", () => {
    renderCard({
      overrides: ROTATION.map((somebody: Person) => {
        return away({
          who: somebody,
          from: hoursFromNow(-1),
          until: hoursFromNow(48),
        });
      }),
    });

    expect(screen.getByTestId("layer-card-everyone-away")).toHaveTextContent(
      "Everyone in this layer is away right now",
    );
    expect(liveLine()).not.toHaveTextContent("on call now");
  });

  test("everybody away, but Alice's cover is named: the cover is on call, not 'everyone away'", () => {
    renderCard({
      overrides: [
        away({
          who: ALICE,
          from: hoursFromNow(-1),
          until: hoursFromNow(48),
          cover: DANA,
        }),
        away({ who: BOB, from: hoursFromNow(-1), until: hoursFromNow(48) }),
        away({ who: CAROL, from: hoursFromNow(-1), until: hoursFromNow(48) }),
      ],
      overrideUserInfo: COVER_INFO,
    });

    expect(liveLine()).toHaveTextContent(`${DANA.name} on call now`);
    expect(screen.queryByTestId("layer-card-everyone-away")).toBeNull();
  });
});

async function renderUsersList(options: {
  overrides: Array<UserOverrideRecord>;
  onSkipUser?: ((person: { userId: string; name: string }) => void) | undefined;
}): Promise<void> {
  getListMock.mockImplementation(async () => {
    const data: Array<OnCallDutyPolicyScheduleLayerUser> = layerUsers();
    return { data, count: data.length, skip: 0, limit: data.length };
  });

  render(
    <LayerUser
      layer={makeLayer()}
      onUpdateUsers={noop}
      overrides={options.overrides}
      coverNameById={{ [DANA.id]: DANA.name }}
      timezone="UTC"
      onSkipUser={options.onSkipUser}
    />,
  );

  await screen.findByText(CAROL.name);
}

// A person's row in the list: from their name to the row that holds it.
function rowOf(somebody: Person): HTMLElement {
  const name: HTMLElement = screen.getByText(somebody.name, { exact: true });
  const row: HTMLElement | null = name.closest(
    "[data-rbd-draggable-id], li, [role='listitem']",
  );

  return (row ||
    name.parentElement!.parentElement!.parentElement!) as HTMLElement;
}

async function tooltipOf(element: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(element);

  let text: string = "";

  await waitFor(() => {
    const describedBy: string | null = element.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    text = document.getElementById(describedBy!)?.textContent || "";
    expect(text).not.toBe("");
  });

  fireEvent.mouseLeave(element);

  return text;
}

describe("the layer's users list", () => {
  test("the person away now says until when; the person booked says from when; nobody else says anything", async () => {
    const aliceBack: Date = hoursFromNow(70);
    const carolGoes: Date = hoursFromNow(30);

    await renderUsersList({
      overrides: [
        away({ who: ALICE, from: hoursFromNow(-2), until: aliceBack }),
        away({
          who: CAROL,
          from: carolGoes,
          until: hoursFromNow(40),
          cover: DANA,
        }),
      ],
    });

    const now: HTMLElement = within(rowOf(ALICE)).getByTestId(
      "layer-user-away-now",
    );
    expect(now).toHaveTextContent(
      `Away until ${formatShiftInstant(aliceBack, "UTC")}`,
    );

    const soon: HTMLElement = within(rowOf(CAROL)).getByTestId(
      "layer-user-away-soon",
    );
    expect(soon).toHaveTextContent(
      `Away from ${formatShiftInstant(carolGoes, "UTC")}`,
    );

    expect(within(rowOf(BOB)).queryByTestId("layer-user-away-now")).toBeNull();
    expect(within(rowOf(BOB)).queryByTestId("layer-user-away-soon")).toBeNull();
    expect(screen.getAllByTestId("layer-user-away-now")).toHaveLength(1);
    expect(screen.getAllByTestId("layer-user-away-soon")).toHaveLength(1);
  });

  test("a badge's tooltip says who has their turns: the rotation, or the person named", async () => {
    await renderUsersList({
      overrides: [
        away({ who: ALICE, from: hoursFromNow(-2), until: hoursFromNow(70) }),
        away({
          who: CAROL,
          from: hoursFromNow(-2),
          until: hoursFromNow(40),
          cover: DANA,
        }),
      ],
    });

    expect(
      await tooltipOf(within(rowOf(ALICE)).getByTestId("layer-user-away-now")),
    ).toBe(
      "Each of their turns goes to the next person in the rotation who is not away.",
    );
    expect(
      await tooltipOf(within(rowOf(CAROL)).getByTestId("layer-user-away-now")),
    ).toBe(`${DANA.name} covers for them.`);
  });

  /*
   * The tooltip shows on hover only, so a screen reader hears what it says
   * as part of the badge: hidden from sight, not from assistive technology.
   */
  test("a screen reader hears who has their turns along with the date", async () => {
    const aliceBack: Date = hoursFromNow(70);

    await renderUsersList({
      overrides: [
        away({ who: ALICE, from: hoursFromNow(-2), until: aliceBack }),
        away({
          who: CAROL,
          from: hoursFromNow(30),
          until: hoursFromNow(40),
          cover: DANA,
        }),
      ],
    });

    const alices: HTMLElement = within(rowOf(ALICE)).getByTestId(
      "layer-user-away-now",
    );
    const aliceSaid: HTMLElement | null = alices.querySelector(".sr-only");

    expect(aliceSaid).not.toBeNull();
    expect(aliceSaid).toHaveTextContent(
      "Each of their turns goes to the next person in the rotation who is not away.",
    );
    expect(alices).toHaveTextContent(
      `Away until ${formatShiftInstant(aliceBack, "UTC")}`,
    );

    const carols: HTMLElement = within(rowOf(CAROL)).getByTestId(
      "layer-user-away-soon",
    );

    expect(carols.querySelector(".sr-only")).toHaveTextContent(
      `${DANA.name} covers for them.`,
    );
  });

  test("time away that is over says nothing", async () => {
    await renderUsersList({
      overrides: [
        away({ who: ALICE, from: hoursFromNow(-30), until: hoursFromNow(-2) }),
      ],
    });

    expect(screen.queryByTestId("layer-user-away-now")).toBeNull();
    expect(screen.queryByTestId("layer-user-away-soon")).toBeNull();
  });

  test("'Skip until...' on a row hands the page that person", async () => {
    const onSkipUser: MockFunction = getJestMockFunction();

    await renderUsersList({
      overrides: [],
      onSkipUser: (person: { userId: string; name: string }) => {
        onSkipUser(person);
      },
    });

    const buttons: Array<HTMLElement> = screen.getAllByTestId(
      "layer-user-skip-button",
    );
    expect(buttons).toHaveLength(ROTATION.length);

    const bobsButton: HTMLElement = within(rowOf(BOB)).getByTestId(
      "layer-user-skip-button",
    );
    expect(bobsButton).toHaveAttribute(
      "aria-label",
      `Skip ${BOB.name} until a date`,
    );
    expect(bobsButton).toHaveTextContent("Skip until…");

    fireEvent.click(bobsButton);

    expect(onSkipUser).toHaveBeenCalledTimes(1);
    expect(onSkipUser).toHaveBeenCalledWith({
      userId: BOB.id,
      name: BOB.name,
    });
  });

  test("without a page to open it, no row offers 'Skip until...'", async () => {
    await renderUsersList({ overrides: [] });

    expect(screen.queryByTestId("layer-user-skip-button")).toBeNull();
  });
});

function renderSummary(overrides: Array<UserOverrideRecord>): void {
  const preview: LayerPreviewResult = getLayerPreviewEvents({
    layer: makeLayer(),
    users: layerUsers(),
    timezone: "UTC",
    numberOfShifts: 6,
    overrides,
  });

  render(
    <LayerRotationSummary
      layer={makeLayer()}
      users={layerUsers()}
      timezone="UTC"
      events={preview.events}
      now={preview.now}
      numberOfShifts={6}
      hasLowerPriorityLayer={false}
      overrideUserInfo={COVER_INFO}
    />,
  );
}

// The upcoming turns, each as "<name>|<its time line>".
function listedTurns(): Array<string> {
  const heading: HTMLElement = screen.getByText("Upcoming shifts");
  const listElement: HTMLElement | null =
    heading.parentElement?.querySelector("ol") || null;

  if (!listElement) {
    throw new Error("No turns listed");
  }

  return Array.from(listElement.querySelectorAll("li")).map(
    (item: HTMLLIElement): string => {
      const name: string =
        item.querySelector("span.truncate")?.textContent || "";
      const times: string =
        item.querySelector("div.mt-0\\.5")?.textContent || "";
      return `${name}|${times}`;
    },
  );
}

describe("the layer's turns, with somebody skipped", () => {
  test("Bob has Alice's turn while she is away, marked as covering for her", () => {
    renderSummary([
      away({ who: ALICE, from: hoursFromNow(-1), until: hoursFromNow(3) }),
    ]);

    const pills: Array<HTMLElement> = screen.getAllByTestId(
      "rotation-covering-pill",
    );
    expect(pills.length).toBeGreaterThan(0);
    expect(pills[0]).toHaveTextContent(`Covering for ${ALICE.name}`);
    expect(listedTurns()[0]).toContain(BOB.name);
  });

  test("everybody away for days: no turn runs on across them", () => {
    /*
     * Back 70 hours from now: four hours into Alice's next turn (her turns
     * run from 6 hours ago, and every 72 hours after). Alice's turn now
     * stopped an hour ago, and nobody in the layer has the days between. Her
     * two pieces are two turns: the first turn listed is the one they come
     * back to - hers, from the moment they are back - and nothing claims a
     * turn is running now, "off-hours" or otherwise: this layer has none.
     */
    const back: Date = hoursFromNow(70);

    renderSummary(
      ROTATION.map((somebody: Person) => {
        return away({ who: somebody, from: hoursFromNow(-1), until: back });
      }),
    );

    const turns: Array<string> = listedTurns();

    expect(turns[0]).toContain(ALICE.name);
    expect(turns[0]).toContain(formatShiftInstant(back, "UTC"));
    expect(screen.queryByText("Current turn · off-hours")).toBeNull();
    expect(screen.queryByText("On call now")).toBeNull();
  });

  test("a turn somebody away comes back in the middle of is theirs from then", () => {
    // Only Alice away, back four hours into her next turn.
    const back: Date = hoursFromNow(70);

    renderSummary([away({ who: ALICE, from: hoursFromNow(-1), until: back })]);

    const turns: Array<string> = listedTurns();
    const alicesTurn: string | undefined = turns.find((turn: string) => {
      return turn.startsWith(`${ALICE.name}|`);
    });

    expect(alicesTurn).toBeDefined();
    expect(alicesTurn).toContain(formatShiftInstant(back, "UTC"));
  });
});
