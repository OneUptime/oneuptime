import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import LayerCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerCard";
import LayerRotationSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerRotationSummary";
import { getLayerPreviewEvents } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerShiftPreview";
import { OverrideUserInfo } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ScheduleOverrides";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { UserOverrideRecord } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

/*
 * https://github.com/OneUptime/oneuptime/issues/3411
 *
 * The layer card's live "<name> on call now" line and the shift table it
 * expands into are the two places on the Layers tab that make a claim about who
 * is covering right now. Both used to be computed from the raw rotation, so
 * during an override they named the originally-scheduled user while the
 * "Final schedule" calendar at the bottom of the SAME page, and the code that
 * actually rings a phone, named the substitute.
 *
 * LayerShiftPreview's own suite pins the event-level substitution. What these
 * tests add is the half that only the rendered component can prove: a
 * substitute is by construction NOT assigned to the layer, so nothing in the
 * layer's own user list can name them - and a fix that substitutes the id but
 * cannot resolve the name turns "Alice on call now" into "Unknown user on call
 * now", which is not an improvement.
 */

const USER_A_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_B_ID: string = "bbbbbbbb-2222-4222-8222-222222222222";
// A second rotation member. The shift table only renders for a real rotation.
const USER_C_ID: string = "cccccccc-3333-4333-8333-333333333333";

const USER_A_NAME: string = "Alice Scheduled";
const USER_B_NAME: string = "Bob Covering";
const USER_C_NAME: string = "Carol Rotation";

function makeUser(id: string, name: string): User {
  const user: User = new User();
  user.id = new ObjectID(id);
  user.name = name as any;
  user.email = `${id}@example.com` as any;
  return user;
}

function makeLayerUser(
  id: string,
  name: string,
  order: number = 1,
): OnCallDutyPolicyScheduleLayerUser {
  const layerUser: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  layerUser.id = new ObjectID(`6666666${order}-6666-4666-8666-666666666666`);
  layerUser.userId = new ObjectID(id);
  layerUser.user = makeUser(id, name);
  layerUser.order = order;
  return layerUser;
}

/*
 * The rotation summary deliberately renders only prose for a single-user layer
 * ("X is always on call - there is no rotation"): with one person every period
 * is theirs and a shift table says nothing. The turn table, and therefore the
 * "On call now" badge this bug mislabelled, only exists for a real rotation, so
 * these fixtures put two people on the layer.
 */
function rotationUsers(): Array<OnCallDutyPolicyScheduleLayerUser> {
  return [
    makeLayerUser(USER_A_ID, USER_A_NAME, 1),
    makeLayerUser(USER_C_ID, USER_C_NAME, 2),
  ];
}

function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  const now: Date = OneUptimeDate.getCurrentDate();

  layer.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  layer.name = "Primary" as any;
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

function activeGlobalOverride(): UserOverrideRecord {
  const now: Date = OneUptimeDate.getCurrentDate();
  return {
    overrideUserId: USER_A_ID,
    routeAlertsToUserId: USER_B_ID,
    startsAt: OneUptimeDate.addRemoveHours(now, -1),
    endsAt: OneUptimeDate.addRemoveHours(now, 1),
    onCallDutyPolicyId: null,
  };
}

const SUBSTITUTE_INFO: Dictionary<OverrideUserInfo> = {
  [USER_B_ID]: { name: USER_B_NAME, email: `${USER_B_ID}@example.com` },
};

const noop: () => void = (): void => {
  return undefined;
};

function renderCard(options: {
  overrides: Array<UserOverrideRecord>;
  overrideUserInfo: Dictionary<OverrideUserInfo>;
}): void {
  render(
    <LayerCard
      layer={makeLayer()}
      users={[makeLayerUser(USER_A_ID, USER_A_NAME)]}
      timezone="UTC"
      index={0}
      total={1}
      isExpanded={false}
      actionsDisabled={false}
      isDeleteButtonLoading={false}
      overrides={options.overrides}
      overridePolicyContextId=""
      overrideUserInfo={options.overrideUserInfo}
      onToggleExpand={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      onDeleteLayer={noop}
      onLayerChange={noop}
      onUsersChange={noop}
    />,
  );
}

// The live line reads "<name> on call now", so anchor on that phrase's row.
function getOnCallNowLineText(): string {
  const label: HTMLElement = screen.getByText(/on call now/i);
  return label.closest("div")?.textContent || label.textContent || "";
}

describe("Layer card names the substitute during an override (issue #3411)", () => {
  afterEach(() => {
    cleanup();
  });

  test("without an override the rotation user is named - the baseline", () => {
    renderCard({ overrides: [], overrideUserInfo: {} });

    const line: string = getOnCallNowLineText();
    expect(line).toContain(USER_A_NAME);
    expect(line).not.toContain(USER_B_NAME);
    expect(line).not.toContain("covering via override");
  });

  test("during an override the SUBSTITUTE is named, and marked as covering", () => {
    renderCard({
      overrides: [activeGlobalOverride()],
      overrideUserInfo: SUBSTITUTE_INFO,
    });

    const line: string = getOnCallNowLineText();
    expect(line).toContain(USER_B_NAME);
    expect(line).toContain("covering via override");
    expect(line).not.toContain(`${USER_A_NAME} on call now`);
  });

  /*
   * The substitute's name has to come from the override payload: they are not
   * on this layer, so the layer's user list cannot supply it. Withholding the
   * info must degrade to "Unknown user" rather than silently reverting to the
   * overridden user's name, which would look correct while being wrong.
   */
  test("a substitute with no display info renders as Unknown user, never as the overridden user", () => {
    renderCard({
      overrides: [activeGlobalOverride()],
      overrideUserInfo: {},
    });

    const line: string = getOnCallNowLineText();
    expect(line).toContain("Unknown user");
    /*
     * Alice legitimately reappears in the same row as "Up next" - she resumes
     * when the override ends - so the assertion is about the CLAIM, not about
     * her name being absent from the row.
     */
    expect(line).not.toContain(`${USER_A_NAME} on call now`);
  });
});

describe("Rotation summary marks a covered turn (issue #3411)", () => {
  afterEach(() => {
    cleanup();
  });

  function renderSummary(options: {
    overrides: Array<UserOverrideRecord>;
    overrideUserInfo: Dictionary<OverrideUserInfo>;
  }): void {
    const preview: {
      events: Array<any>;
      now: Date;
    } = getLayerPreviewEvents({
      layer: makeLayer(),
      users: rotationUsers(),
      timezone: "UTC",
      numberOfShifts: 6,
      overrides: options.overrides,
    });

    render(
      <LayerRotationSummary
        layer={makeLayer()}
        users={rotationUsers()}
        timezone="UTC"
        events={preview.events}
        now={preview.now}
        hasLowerPriorityLayer={false}
        overrideUserInfo={options.overrideUserInfo}
      />,
    );
  }

  test("the covered turn is attributed to the substitute and tagged Covering", () => {
    renderSummary({
      overrides: [activeGlobalOverride()],
      overrideUserInfo: SUBSTITUTE_INFO,
    });

    expect(screen.getAllByText(USER_B_NAME).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Covering").length).toBeGreaterThan(0);
  });

  test("without an override no turn is tagged Covering", () => {
    renderSummary({ overrides: [], overrideUserInfo: {} });

    expect(screen.queryByText("Covering")).toBeNull();
  });

  /*
   * The "Order" row states the layer's configured rotation, which an override
   * does not change. Substituting there would misrepresent the schedule as
   * having been reconfigured.
   */
  test("the rotation order still lists the assigned user, not the substitute", () => {
    renderSummary({
      overrides: [activeGlobalOverride()],
      overrideUserInfo: SUBSTITUTE_INFO,
    });

    const orderLabel: HTMLElement = screen.getByText("Order");
    const orderRow: string = orderLabel.parentElement?.textContent || "";

    expect(orderRow).toContain(USER_A_NAME);
    expect(orderRow).toContain(USER_C_NAME);
    expect(orderRow).not.toContain(USER_B_NAME);
  });
});
