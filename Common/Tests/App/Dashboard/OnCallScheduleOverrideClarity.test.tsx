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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The schedule calendar has to say that a shift is COVERED, not merely who is
 * covering it.
 *
 * Before this, an overridden window was relabelled to the substitute and drawn
 * in the substitute's own colour - a block indistinguishable from an ordinary
 * rotation shift. The screen was correct and unreadable at the same time: it
 * named the right person to page, while giving the reader no way to learn that
 * the roster says somebody else, whose shift it was, when the substitution
 * expires, or whether it reaches every policy or only one. Someone checking
 * "am I covered on Thursday?" could look straight at the answer and not see it.
 *
 * These tests drive the real LayersPreview against a mocked ModelAPI and assert
 * on the four surfaces that now carry the substitution: the calendar block
 * itself (label, stripe colour, class and tooltip), the overrides card above
 * the grid, the legend, and the "on call right now" card. Each is checked
 * separately, because a reader who happens to look at only one of them still
 * has to get the whole story.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers matter: jest.mock is hoisted above the compiled requires,
 * so the consts above are still in their temporal dead zone when the factory
 * body runs. Dereferencing lazily, at call time, is what works.
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

/*
 * react-big-calendar is replaced by a list that exposes the FULL event objects
 * rather than only their titles. The visual cues under test - the accent stripe
 * colour and the override class name - never reach the DOM as text, so a mock
 * that rendered titles alone could not tell a block that carries them from one
 * that does not, which is exactly the regression this file exists to catch.
 */
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
                data-event-color={event.color || ""}
                data-event-accent={event.accentColor || ""}
                data-event-desc={event.desc || ""}
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
import { getColorForUserId } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUserColors";
import { OVERRIDE_EVENT_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
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

const POLICY_NAME: string = "Database On-Call";

const USER_A_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_B_ID: string = "bbbbbbbb-2222-4222-8222-222222222222";

const USER_A_NAME: string = "Alice Scheduled";
const USER_B_NAME: string = "Bob Covering";

const TIMEOUT_MS: number = 10000;

function objectId(id: string): ObjectID {
  return new ObjectID(id);
}

function makeUser(id: string, name: string): User {
  const user: User = new User();
  user.id = objectId(id);
  user.name = name as any;
  user.email = `${id}@example.com` as any;
  return user;
}

/*
 * One 24/7 layer, rotating daily, started well in the past, with exactly one
 * user assigned - so "who is on call right now" has a single correct answer no
 * matter when the suite runs, and any second name on the screen can only have
 * come from an override.
 */
function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  layer.id = objectId(LAYER_ID);
  layer.projectId = objectId(PROJECT_ID);
  layer.onCallDutyPolicyScheduleId = objectId(SCHEDULE_ID);
  layer.order = 1;
  layer.name = "Primary" as any;

  const now: Date = OneUptimeDate.getCurrentDate();
  layer.startsAt = OneUptimeDate.addRemoveDays(now, -30);
  layer.handOffTime = OneUptimeDate.addRemoveDays(now, -30);

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
  const layerUser: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  layerUser.id = objectId("66666666-6666-4666-8666-666666666666");
  layerUser.onCallDutyPolicyScheduleLayerId = objectId(LAYER_ID);
  layerUser.onCallDutyPolicyScheduleId = objectId(SCHEDULE_ID);
  layerUser.projectId = objectId(PROJECT_ID);
  layerUser.order = 1;
  layerUser.userId = objectId(USER_A_ID);
  layerUser.user = makeUser(USER_A_ID, USER_A_NAME);

  return { [LAYER_ID]: [layerUser] };
}

interface OverrideFixture {
  onCallDutyPolicyId: string | null;
  policyName?: string | undefined;
  startsAt: Date;
  endsAt: Date;
}

function activeOverride(data: {
  onCallDutyPolicyId: string | null;
  policyName?: string | undefined;
}): OverrideFixture {
  const now: Date = OneUptimeDate.getCurrentDate();
  return {
    onCallDutyPolicyId: data.onCallDutyPolicyId,
    ...(data.policyName ? { policyName: data.policyName } : {}),
    startsAt: OneUptimeDate.addRemoveHours(now, -1),
    endsAt: OneUptimeDate.addRemoveHours(now, 1),
  };
}

function toModel(fixture: OverrideFixture): OnCallDutyPolicyUserOverride {
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  model.id = objectId("77777777-7777-4777-8777-777777777777");
  model.projectId = objectId(PROJECT_ID);
  model.overrideUserId = objectId(USER_A_ID);
  model.routeAlertsToUserId = objectId(USER_B_ID);
  model.startsAt = fixture.startsAt;
  model.endsAt = fixture.endsAt;
  model.onCallDutyPolicyId = fixture.onCallDutyPolicyId
    ? objectId(fixture.onCallDutyPolicyId)
    : (null as any);
  model.overrideUser = makeUser(USER_A_ID, USER_A_NAME);
  model.routeAlertsToUser = makeUser(USER_B_ID, USER_B_NAME);

  if (fixture.policyName) {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = objectId(fixture.onCallDutyPolicyId!);
    policy.name = fixture.policyName as any;
    model.onCallDutyPolicy = policy;
  }

  return model;
}

// Stands in for the server's WHERE clause on onCallDutyPolicyId.
function matchesPolicyQuery(
  fixture: OverrideFixture,
  queryValue: unknown,
): boolean {
  if (queryValue instanceof IsNull) {
    return fixture.onCallDutyPolicyId === null;
  }
  if (queryValue instanceof EqualToOrNull) {
    return (
      fixture.onCallDutyPolicyId === null ||
      fixture.onCallDutyPolicyId === queryValue.toString()
    );
  }
  return true;
}

function setupApi(options: {
  overrides: Array<OverrideFixture>;
  attachedPolicyIds: Array<string>;
}): void {
  getListMock.mockImplementation((args: any) => {
    const modelName: string = args?.modelType?.name || "";

    if (modelName === "OnCallDutyPolicyUserOverride") {
      const matched: Array<OverrideFixture> = options.overrides.filter(
        (fixture: OverrideFixture) => {
          return matchesPolicyQuery(fixture, args?.query?.onCallDutyPolicyId);
        },
      );
      return Promise.resolve({
        data: matched.map(toModel),
        count: matched.length,
        skip: 0,
        limit: matched.length,
      });
    }

    if (modelName === "OnCallDutyPolicyEscalationRuleSchedule") {
      const joins: Array<OnCallDutyPolicyEscalationRuleSchedule> =
        options.attachedPolicyIds.map((policyId: string, index: number) => {
          const join: OnCallDutyPolicyEscalationRuleSchedule =
            new OnCallDutyPolicyEscalationRuleSchedule();
          join.id = objectId(
            `8888888${index}-8888-4888-8888-888888888888`.slice(0, 36),
          );
          join.projectId = objectId(PROJECT_ID);
          join.onCallDutyPolicyScheduleId = objectId(SCHEDULE_ID);
          join.onCallDutyPolicyId = objectId(policyId);
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

function renderPreview(): void {
  render(
    <LayersPreview
      layers={[makeLayer()]}
      allLayerUsers={makeLayerUsers()}
      timezone="UTC"
      onCallDutyPolicyScheduleId={objectId(SCHEDULE_ID)}
    />,
  );
}

// The calendar block produced by the override, once the async fetches land.
async function findOverrideEvent(): Promise<HTMLElement> {
  let found: HTMLElement | null = null;

  await waitFor(
    () => {
      const match: HTMLElement | undefined = screen
        .getAllByTestId("calendar-event")
        .find((node: HTMLElement) => {
          return (
            node.getAttribute("data-event-class") === OVERRIDE_EVENT_CLASS_NAME
          );
        });
      if (!match) {
        throw new Error("no override-marked calendar event yet");
      }
      found = match;
    },
    { timeout: TIMEOUT_MS },
  );

  return found!;
}

async function findOverridesCard(): Promise<HTMLElement> {
  return screen.findByTestId("active-overrides-card", undefined, {
    timeout: TIMEOUT_MS,
  });
}

describe("The calendar block says a shift is covered, not just who is on it", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("names the substitute AND the person whose shift it was", async () => {
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const event: HTMLElement = await findOverrideEvent();

    expect(event.textContent).toContain(USER_B_NAME);
    expect(event.textContent).toContain(`covering ${USER_A_NAME}`);
  });

  test("leads the label with the swap marker so it survives a narrow column", async () => {
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const event: HTMLElement = await findOverrideEvent();

    expect((event.textContent || "").trimStart().startsWith("⇄")).toBe(true);
  });

  test("carries the overridden person's colour as the block's accent stripe", async () => {
    /*
     * The stripe is the only cue that works when the column is too narrow for
     * any text at all, and the only one that says WHOSE shift this was without
     * words. It must be the OVERRIDDEN user's colour, not the substitute's -
     * the block is already painted in the substitute's.
     */
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const event: HTMLElement = await findOverrideEvent();

    expect(event.getAttribute("data-event-accent")).toBe(
      getColorForUserId(USER_A_ID),
    );
    expect(event.getAttribute("data-event-color")).toBe(
      getColorForUserId(USER_B_ID),
    );
    expect(event.getAttribute("data-event-accent")).not.toBe(
      event.getAttribute("data-event-color"),
    );
  });

  test("the tooltip states the swap, its window and its scope", async () => {
    setupApi({
      overrides: [
        activeOverride({
          onCallDutyPolicyId: POLICY_ID,
          policyName: POLICY_NAME,
        }),
      ],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const event: HTMLElement = await findOverrideEvent();
    const tooltip: string = event.getAttribute("data-event-desc") || "";

    expect(tooltip).toContain(`Override: ${USER_A_NAME} → ${USER_B_NAME}`);
    expect(tooltip).toContain(
      `Alerts that would page ${USER_A_NAME} go to ${USER_B_NAME}.`,
    );
    expect(tooltip).toContain("Override window:");
    expect(tooltip).toContain(POLICY_NAME);
  });

  test("an ordinary shift gets no override class, stripe or covering wording", async () => {
    /*
     * The other half of the contract. A marker on every block would be no
     * marker at all, so the plain segments either side of the override window
     * must stay plain.
     */
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    await findOverrideEvent();

    const plain: Array<HTMLElement> = screen
      .getAllByTestId("calendar-event")
      .filter((node: HTMLElement) => {
        return node.getAttribute("data-event-class") === "";
      });

    expect(plain.length).toBeGreaterThan(0);
    for (const node of plain) {
      expect(node.getAttribute("data-event-accent")).toBe("");
      expect(node.textContent).not.toContain("covering");
      expect(node.textContent).not.toContain("⇄");
    }
  });

  test("a schedule with no overrides marks nothing and shows no overrides card", async () => {
    setupApi({ overrides: [], attachedPolicyIds: [POLICY_ID] });
    renderPreview();

    await waitFor(
      () => {
        expect(screen.getAllByTestId("calendar-event").length).toBeGreaterThan(
          0,
        );
      },
      { timeout: TIMEOUT_MS },
    );

    for (const node of screen.getAllByTestId("calendar-event")) {
      expect(node.getAttribute("data-event-class")).toBe("");
    }
    expect(screen.queryByTestId("active-overrides-card")).toBeNull();
    expect(screen.queryByTestId("legend-override-key")).toBeNull();
  });
});

describe("The overrides card states the substitution in full", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("names both parties and labels which is which", async () => {
    /*
     * "Alice -> Bob" on its own still requires the reader to know which way an
     * override runs. Getting that backwards means calling the person who is
     * away, so both sides are labelled in words.
     */
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const card: HTMLElement = await findOverridesCard();
    const row: HTMLElement = within(card).getByTestId("active-override-row");

    expect(row.textContent).toContain(USER_A_NAME);
    expect(row.textContent).toContain("Overridden");
    expect(row.textContent).toContain(USER_B_NAME);
    expect(row.textContent).toContain("Alerts go here");
  });

  test("marks an override that is running right now", async () => {
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const card: HTMLElement = await findOverridesCard();
    expect(card.textContent).toContain("In force now");
  });

  test("a GLOBAL override is labelled as reaching every policy", async () => {
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const card: HTMLElement = await findOverridesCard();
    const pill: HTMLElement = within(card).getByTestId("override-scope-pill");

    expect(pill.textContent).toContain("Global override");
    expect(pill.getAttribute("title")).toContain("every on-call policy");
  });

  test("a POLICY-SCOPED override names the policy it is limited to", async () => {
    /*
     * The distinction the reader cannot afford to miss: this substitution
     * covers alerts escalating through ONE policy. Every other policy attached
     * to this schedule still pages the person who is away.
     */
    setupApi({
      overrides: [
        activeOverride({
          onCallDutyPolicyId: POLICY_ID,
          policyName: POLICY_NAME,
        }),
      ],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const card: HTMLElement = await findOverridesCard();
    const pill: HTMLElement = within(card).getByTestId("override-scope-pill");

    expect(pill.textContent).toContain(`Only for ${POLICY_NAME}`);
    expect(pill.textContent).not.toContain("Global");
  });

  test("shows the override's own window, not the shift's", async () => {
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const card: HTMLElement = await findOverridesCard();
    const now: Date = OneUptimeDate.getCurrentDate();

    /*
     * The fixture window is now-1h to now+1h, while the layer's shift is a full
     * day. Asserting on the year alone would pass for either; the hour is what
     * distinguishes them.
     */
    const startHour: string = OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: OneUptimeDate.addRemoveHours(now, -1),
      timezone: "UTC",
      showWeekday: true,
    });

    expect(card.textContent).toContain(startHour);
  });
});

describe("The legend and the on-call card carry the same story", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("the legend names who the substitute is covering, not just that they are", async () => {
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const label: HTMLElement = await screen.findByTestId(
      "legend-covering-label",
      undefined,
      { timeout: TIMEOUT_MS },
    );

    expect(label.textContent).toBe(`Covering ${USER_A_NAME}`);
  });

  test("the legend explains the striped edge drawn on covered blocks", async () => {
    setupApi({
      overrides: [activeOverride({ onCallDutyPolicyId: null })],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const key: HTMLElement = await screen.findByTestId(
      "legend-override-key",
      undefined,
      { timeout: TIMEOUT_MS },
    );

    expect(key.textContent).toContain("Covered by an override");
    expect(key.getAttribute("title")).toContain("overridden");
  });

  test("'on call right now' says the person is there via an override, and whose shift it was", async () => {
    setupApi({
      overrides: [
        activeOverride({
          onCallDutyPolicyId: POLICY_ID,
          policyName: POLICY_NAME,
        }),
      ],
      attachedPolicyIds: [POLICY_ID],
    });
    renderPreview();

    const strip: HTMLElement = await screen.findByTestId(
      "on-call-now-override",
      undefined,
      { timeout: TIMEOUT_MS },
    );

    expect(strip.textContent).toContain("Override");
    expect(strip.textContent).toContain(`Covering for ${USER_A_NAME}`);
    expect(strip.textContent).toContain(`Only for ${POLICY_NAME}`);
    expect(strip.textContent).toContain("Override runs");
  });

  test("an un-overridden schedule shows no override strip on the on-call card", async () => {
    setupApi({ overrides: [], attachedPolicyIds: [POLICY_ID] });
    renderPreview();

    await waitFor(
      () => {
        expect(screen.getAllByTestId("calendar-event").length).toBeGreaterThan(
          0,
        );
      },
      { timeout: TIMEOUT_MS },
    );

    expect(screen.queryByTestId("on-call-now-override")).toBeNull();
    expect(screen.queryByTestId("legend-covering-label")).toBeNull();
  });
});
