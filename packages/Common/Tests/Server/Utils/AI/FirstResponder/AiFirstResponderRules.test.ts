import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import AiFirstResponder from "../../../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import AiFirstResponderRules from "../../../../../Server/Utils/AI/FirstResponder/AiFirstResponderRules";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallRuleWhenToPage from "../../../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A RULE THAT NO LONGER LETS ONEUPTIME AI RESPOND FIRST (AiFirstResponderRules):
 * set to another When to Page, or disabled - or deleted - its policies' held
 * pages go to people, project by project.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "6d000000-0000-4000-8000-000000000001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "6d000000-0000-4000-8000-000000000002",
);

function policy(id: string): OnCallDutyPolicy {
  const model: OnCallDutyPolicy = new OnCallDutyPolicy();
  model.id = new ObjectID(id);
  return model;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an update that stops a rule holding pages", () => {
  test("another When to Page stops it", () => {
    for (const whenToPage of [
      OnCallRuleWhenToPage.RightAway,
      OnCallRuleWhenToPage.WorkingHours,
    ]) {
      expect(AiFirstResponderRules.isStoppingHolds({ whenToPage })).toBe(true);
    }
  });

  test("disabling it stops it", () => {
    expect(AiFirstResponderRules.isStoppingHolds({ isEnabled: false })).toBe(
      true,
    );
  });

  test("keeping After OneUptime AI, enabling it, or changing anything else does not", () => {
    expect(
      AiFirstResponderRules.isStoppingHolds({
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
      }),
    ).toBe(false);
    expect(AiFirstResponderRules.isStoppingHolds({ isEnabled: true })).toBe(
      false,
    );
    expect(
      AiFirstResponderRules.isStoppingHolds({
        name: "Page Platform",
        aiHoldTimeInMinutes: 5,
      }),
    ).toBe(false);
  });
});

describe("handing off the holds of rules that stopped", () => {
  test("each project's policies are handed off once, together", async () => {
    const calls: Array<{ projectId: ObjectID; policyIds: Array<ObjectID> }> =
      [];
    jest
      .spyOn(AiFirstResponder, "onRuleStoppedHolding")
      .mockImplementation((async (data: {
        projectId: ObjectID;
        policyIds: Array<ObjectID>;
      }): Promise<void> => {
        calls.push(data);
      }) as never);

    await AiFirstResponderRules.handOffForRules([
      {
        projectId: PROJECT_A,
        onCallDutyPolicies: [
          policy("6d000000-0000-4000-8000-0000000000a1"),
          policy("6d000000-0000-4000-8000-0000000000a2"),
        ],
      },
      {
        projectId: PROJECT_A,
        onCallDutyPolicies: [policy("6d000000-0000-4000-8000-0000000000a1")],
      },
      {
        projectId: PROJECT_B,
        onCallDutyPolicies: [policy("6d000000-0000-4000-8000-0000000000b1")],
      },
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.projectId.toString()).toBe(PROJECT_A.toString());
    expect(
      calls[0]!.policyIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([
      "6d000000-0000-4000-8000-0000000000a1",
      "6d000000-0000-4000-8000-0000000000a2",
    ]);
    expect(calls[1]!.projectId.toString()).toBe(PROJECT_B.toString());
  });

  test("a rule with no policies, or no project, hands off nothing", async () => {
    const handOff: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AiFirstResponder, "onRuleStoppedHolding")
      .mockResolvedValue(undefined as never);

    await AiFirstResponderRules.handOffForRules([
      { projectId: PROJECT_A, onCallDutyPolicies: [] },
      { onCallDutyPolicies: [policy("6d000000-0000-4000-8000-0000000000a1")] },
    ]);

    expect(handOff).not.toHaveBeenCalled();
  });

  test("one project's failure does not stop the next, nor the write", async () => {
    const handOff: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AiFirstResponder, "onRuleStoppedHolding")
      .mockRejectedValueOnce(new Error("database is down") as never)
      .mockResolvedValue(undefined as never);

    await expect(
      AiFirstResponderRules.handOffForRules([
        {
          projectId: PROJECT_A,
          onCallDutyPolicies: [policy("6d000000-0000-4000-8000-0000000000a1")],
        },
        {
          projectId: PROJECT_B,
          onCallDutyPolicies: [policy("6d000000-0000-4000-8000-0000000000b1")],
        },
      ]),
    ).resolves.toBeUndefined();
    expect(handOff).toHaveBeenCalledTimes(2);
  });
});
