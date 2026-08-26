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
 * https://github.com/OneUptime/oneuptime/issues/3411
 *
 * The schedule preview (the "Final schedule" calendar and the "On call right
 * now" card above it) is the screen an on-call engineer opens to answer "who is
 * covering?". Alert routing answers the same question through
 * OnCallDutyPolicyEscalationRuleService -> getCurrentUserIdInSchedule, which is
 * handed the escalating policy's id and therefore applies BOTH global and
 * policy-scoped user overrides.
 *
 * The preview used to hard-code `onCallDutyPolicyId: IsNull()` on its override
 * fetch, so an override created from the on-call policy's own "User Overrides"
 * tab - the obvious place to add a shift override, and the one that stamps
 * onCallDutyPolicyId - never reached the calendar. The page then contradicted
 * itself: the banner at the top of the same screen reads the persisted roster,
 * which the server resolves in the single attached policy's context and which
 * therefore DID show the substitute, while the calendar underneath kept showing
 * the original user.
 *
 * These tests drive the real component with a mocked ModelAPI that filters the
 * override list exactly the way the server's query would, so an assertion here
 * fails if the component stops asking for the right rows OR stops passing the
 * policy context into UserOverrideUtil - the two independent halves of the bug.
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
 * react-big-calendar renders a grid that is awkward to assert against and slow
 * to mount. What matters here is the event list the preview hands it, so the
 * calendar is replaced by a plain list of event titles. The substitution is
 * visible in the DOM either way, so a regression that stops relabelling events
 * still fails.
 */
jest.mock("../../../UI/Components/Calendar/Calendar", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      return (
        <ul data-testid="calendar-events">
          {(props.events || []).map((event: any, index: number) => {
            return (
              <li key={index} data-testid="calendar-event">
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
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
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

const USER_A_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_B_ID: string = "bbbbbbbb-2222-4222-8222-222222222222";
const USER_C_ID: string = "cccccccc-3333-4333-8333-333333333333";

const USER_A_NAME: string = "Alice Scheduled";
const USER_B_NAME: string = "Bob Covering";
const USER_C_NAME: string = "Carol Elsewhere";

const objectId: (id: string) => ObjectID = (id: string): ObjectID => {
  return new ObjectID(id);
};

function makeUser(id: string, name: string): User {
  const user: User = new User();
  user.id = objectId(id);
  user.name = name as any;
  user.email = `${id}@example.com` as any;
  return user;
}

/*
 * A single 24/7 layer that started well in the past and rotates daily, so
 * exactly one user - the only one assigned - is on call at "now" no matter when
 * the suite runs. That makes "who does the preview show right now" a question
 * with one correct answer, which is the whole point.
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
  overrideUserId: string;
  routeAlertsToUserId: string;
  routeAlertsToUserName: string;
  onCallDutyPolicyId: string | null;
  startsAt: Date;
  endsAt: Date;
}

function activeOverride(
  onCallDutyPolicyId: string | null,
  routeAlertsToUserId: string = USER_B_ID,
  routeAlertsToUserName: string = USER_B_NAME,
): OverrideFixture {
  const now: Date = OneUptimeDate.getCurrentDate();
  return {
    overrideUserId: USER_A_ID,
    routeAlertsToUserId,
    routeAlertsToUserName,
    onCallDutyPolicyId,
    startsAt: OneUptimeDate.addRemoveHours(now, -1),
    endsAt: OneUptimeDate.addRemoveHours(now, 1),
  };
}

function toModel(fixture: OverrideFixture): OnCallDutyPolicyUserOverride {
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  model.id = objectId("77777777-7777-4777-8777-777777777777");
  model.projectId = objectId(PROJECT_ID);
  model.overrideUserId = objectId(fixture.overrideUserId);
  model.routeAlertsToUserId = objectId(fixture.routeAlertsToUserId);
  model.startsAt = fixture.startsAt;
  model.endsAt = fixture.endsAt;
  model.onCallDutyPolicyId = fixture.onCallDutyPolicyId
    ? objectId(fixture.onCallDutyPolicyId)
    : (null as any);
  model.overrideUser = makeUser(fixture.overrideUserId, USER_A_NAME);
  model.routeAlertsToUser = makeUser(
    fixture.routeAlertsToUserId,
    fixture.routeAlertsToUserName,
  );
  return model;
}

/*
 * Stands in for the server's WHERE clause on onCallDutyPolicyId. Without this
 * the mock would hand back every override regardless of what the component
 * asked for, and the test could not tell a component that asks for the right
 * rows apart from one that asks for the wrong rows and gets lucky.
 */
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

  if (queryValue === undefined || queryValue === null) {
    // No filter at all - the server would return every row in the project.
    return true;
  }

  return fixture.onCallDutyPolicyId === String(queryValue);
}

interface ScenarioOptions {
  overrides: Array<OverrideFixture>;
  attachedPolicyIds: Array<string>;
}

function setupApi(options: ScenarioOptions): void {
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

/*
 * The "On call right now" hero card. Reading the name out of that specific card
 * (rather than out of the whole document) is what makes the assertion about the
 * question the user asked - "who is covering right now" - and not about whether
 * a name appears anywhere on a screen that also lists a whole week of shifts.
 */
async function getOnCallNowText(): Promise<string> {
  const heading: HTMLElement = await screen.findByText(/On call right now/i);
  const card: HTMLElement | null = heading.closest("div.rounded-xl");
  if (!card) {
    throw new Error("Could not find the 'On call right now' card");
  }
  return card.textContent || "";
}

describe("Schedule preview reflects the overrides that alert routing applies (issue #3411)", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("a POLICY-SCOPED override is shown when the schedule is attached to exactly one policy", async () => {
    setupApi({
      overrides: [activeOverride(POLICY_ID)],
      attachedPolicyIds: [POLICY_ID],
    });

    renderPreview();

    await waitFor(
      async () => {
        expect(await getOnCallNowText()).toContain(USER_B_NAME);
      },
      { timeout: 10000 },
    );

    expect(await getOnCallNowText()).not.toContain(USER_A_NAME);
  });

  test("the calendar grid relabels the overridden window to the substitute", async () => {
    setupApi({
      overrides: [activeOverride(POLICY_ID)],
      attachedPolicyIds: [POLICY_ID],
    });

    renderPreview();

    /*
     * A longer budget than the 1s default on purpose. The grid is painted from a
     * useEffect, so it lands one commit after the summary (a useMemo) - plus two
     * awaited round trips before that, for the policy context and the overrides.
     */
    await waitFor(
      () => {
        const titles: Array<string> = screen
          .getAllByTestId("calendar-event")
          .map((node: HTMLElement) => {
            return node.textContent || "";
          });

        expect(
          titles.some((title: string) => {
            return (
              title.includes(USER_B_NAME) &&
              title.includes(`covering ${USER_A_NAME}`)
            );
          }),
        ).toBe(true);
      },
      { timeout: 10000 },
    );
  });

  test("a GLOBAL override is still shown (the behaviour that already worked must not regress)", async () => {
    setupApi({
      overrides: [activeOverride(null)],
      attachedPolicyIds: [POLICY_ID],
    });

    renderPreview();

    await waitFor(
      async () => {
        expect(await getOnCallNowText()).toContain(USER_B_NAME);
      },
      { timeout: 10000 },
    );
  });

  test("an override scoped to a DIFFERENT policy is not shown", async () => {
    setupApi({
      overrides: [activeOverride(OTHER_POLICY_ID, USER_C_ID, USER_C_NAME)],
      attachedPolicyIds: [POLICY_ID],
    });

    renderPreview();

    await waitFor(
      async () => {
        expect(await getOnCallNowText()).toContain(USER_A_NAME);
      },
      { timeout: 10000 },
    );

    expect(await getOnCallNowText()).not.toContain(USER_C_NAME);
  });

  test("with the schedule attached to TWO policies only global overrides apply, matching the persisted roster", async () => {
    setupApi({
      overrides: [activeOverride(POLICY_ID, USER_C_ID, USER_C_NAME)],
      attachedPolicyIds: [POLICY_ID, OTHER_POLICY_ID],
    });

    renderPreview();

    await waitFor(
      async () => {
        expect(await getOnCallNowText()).toContain(USER_A_NAME);
      },
      { timeout: 10000 },
    );

    expect(await getOnCallNowText()).not.toContain(USER_C_NAME);
  });
});
