import AlertEpisodeOnCallRule from "../../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeOnCallRule from "../../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import AlertEpisodeOnCallRuleService from "../../../../Server/Services/AlertEpisodeOnCallRuleService";
import AlertOnCallRuleService from "../../../../Server/Services/AlertOnCallRuleService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentEpisodeOnCallRuleService from "../../../../Server/Services/IncidentEpisodeOnCallRuleService";
import IncidentOnCallRuleService from "../../../../Server/Services/IncidentOnCallRuleService";
import OnCallRuleWhenToPageCheck, {
  AI_HOLD_TIME_OUT_OF_BOUNDS_MESSAGE,
  ONEUPTIME_AI_NOT_FOR_EPISODES_MESSAGE,
} from "../../../../Server/Utils/Rules/OnCallRuleWhenToPageCheck";
import ObjectID from "../../../../Types/ObjectID";
import OnCallRuleWhenToPage from "../../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * AN ON-CALL RULE THAT LETS ONEUPTIME AI RESPOND FIRST (OnCallPolicyAiHold).
 *
 * Alert and incident rules may: AI investigates those. Episode rules may
 * not, and are told why. A hold time a write names is whole minutes from 1
 * to 30; empty is the default. Refused the same way from the form, the API
 * and Terraform.
 */

function rule(values: Record<string, unknown>): AlertOnCallRule {
  const model: AlertOnCallRule = new AlertOnCallRule();

  for (const [key, value] of Object.entries(values)) {
    (model as unknown as Record<string, unknown>)[key] = value;
  }

  return model;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a rule's create", () => {
  test("an alert or incident rule may let OneUptime AI respond first", () => {
    expect(() => {
      OnCallRuleWhenToPageCheck.checkCreate(
        {
          data: rule({ whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI }),
          props: { isRoot: true },
        },
        { allowsOneUptimeAI: true },
      );
    }).not.toThrow();
  });

  test("a rule whose kind does not allow it is refused, saying why", () => {
    expect(() => {
      OnCallRuleWhenToPageCheck.checkCreate({
        data: rule({ whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI }),
        props: { isRoot: true },
      });
    }).toThrow(ONEUPTIME_AI_NOT_FOR_EPISODES_MESSAGE);
  });

  test("a hold time of whole minutes from 1 to 30 - as a number, or as a form's digits - or none, is saved", () => {
    for (const minutes of [undefined, null, "", 1, 10, 30, "10"]) {
      expect(() => {
        OnCallRuleWhenToPageCheck.checkCreate(
          {
            data: rule({
              whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
              aiHoldTimeInMinutes: minutes,
            }),
            props: { isRoot: true },
          },
          { allowsOneUptimeAI: true },
        );
      }).not.toThrow();
    }
  });

  test("any other hold time is refused", () => {
    for (const minutes of [0, 31, -1, 2.5, "ten", "2.5", Number.NaN, true]) {
      expect(() => {
        OnCallRuleWhenToPageCheck.checkCreate(
          {
            data: rule({
              whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
              aiHoldTimeInMinutes: minutes,
            }),
            props: { isRoot: true },
          },
          { allowsOneUptimeAI: true },
        );
      }).toThrow(AI_HOLD_TIME_OUT_OF_BOUNDS_MESSAGE);
    }
  });

  test("the message says the bounds", () => {
    expect(AI_HOLD_TIME_OUT_OF_BOUNDS_MESSAGE).toBe(
      "OneUptime AI Hold Time In Minutes is a whole number from 1 to 30.",
    );
  });
});

describe("a rule's update", () => {
  async function update(data: {
    written: AlertOnCallRule;
    stored: Array<AlertOnCallRule>;
    allowsOneUptimeAI: boolean;
  }): Promise<void> {
    await OnCallRuleWhenToPageCheck.checkUpdate({
      service: {
        findRowsAndHoldUpdateToThem: async (): Promise<
          Array<AlertOnCallRule>
        > => {
          return data.stored;
        },
      } as unknown as DatabaseService<AlertOnCallRule>,
      updateBy: {
        query: { _id: ObjectID.generate().toString() },
        data: data.written,
        props: { isRoot: true },
      } as never,
      options: { allowsOneUptimeAI: data.allowsOneUptimeAI },
    });
  }

  test("switching an alert or incident rule to After OneUptime AI is saved", async () => {
    await expect(
      update({
        written: rule({ whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI }),
        stored: [rule({ whenToPage: OnCallRuleWhenToPage.RightAway })],
        allowsOneUptimeAI: true,
      }),
    ).resolves.toBeUndefined();
  });

  test("switching an episode rule to it is refused", async () => {
    await expect(
      update({
        written: rule({ whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI }),
        stored: [rule({ whenToPage: OnCallRuleWhenToPage.RightAway })],
        allowsOneUptimeAI: false,
      }),
    ).rejects.toThrow(ONEUPTIME_AI_NOT_FOR_EPISODES_MESSAGE);
  });

  test("changing only the hold time is held to its bounds, whatever the rule says", async () => {
    await expect(
      update({
        written: rule({ aiHoldTimeInMinutes: 45 }),
        stored: [rule({ whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI })],
        allowsOneUptimeAI: true,
      }),
    ).rejects.toThrow(AI_HOLD_TIME_OUT_OF_BOUNDS_MESSAGE);

    await expect(
      update({
        written: rule({ aiHoldTimeInMinutes: 20 }),
        stored: [rule({ whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI })],
        allowsOneUptimeAI: true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("each kind of rule's service", () => {
  const SERVICES: Array<[string, unknown, () => BaseModel, boolean]> = [
    [
      "alert",
      AlertOnCallRuleService,
      (): BaseModel => {
        return new AlertOnCallRule();
      },
      true,
    ],
    [
      "incident",
      IncidentOnCallRuleService,
      (): BaseModel => {
        return new IncidentOnCallRule();
      },
      true,
    ],
    [
      "alert episode",
      AlertEpisodeOnCallRuleService,
      (): BaseModel => {
        return new AlertEpisodeOnCallRule();
      },
      false,
    ],
    [
      "incident episode",
      IncidentEpisodeOnCallRuleService,
      (): BaseModel => {
        return new IncidentEpisodeOnCallRule();
      },
      false,
    ],
  ];

  test.each(SERVICES)(
    "the %s rules allow After OneUptime AI only for alerts and incidents",
    async (
      _name: string,
      service: unknown,
      newRule: () => BaseModel,
      allows: boolean,
    ) => {
      const model: BaseModel = newRule();
      model.setColumnValue("whenToPage", OnCallRuleWhenToPage.AfterOneUptimeAI);

      const checkCreate: (createBy: unknown) => Promise<void> = (
        service as {
          checkCreateBeforeReferences: (createBy: unknown) => Promise<void>;
        }
      ).checkCreateBeforeReferences.bind(service);

      if (allows) {
        await expect(
          checkCreate({ data: model, props: { isRoot: true } }),
        ).resolves.toBeUndefined();
      } else {
        await expect(
          checkCreate({ data: model, props: { isRoot: true } }),
        ).rejects.toThrow(ONEUPTIME_AI_NOT_FOR_EPISODES_MESSAGE);
      }
    },
  );
});
