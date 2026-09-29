import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import { RuleRunType } from "../../../../Types/Rules/RuleRun";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  ProgressInfo,
} from "../../../../UI/Components/BulkUpdate/BulkUpdateForm";
import getRunRulesBulkAction from "../../../../UI/Components/RuleRun/RunRulesBulkAction";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import RuleRunClient, {
  RuleRunOutcome,
} from "../../../../UI/Utils/Rules/RuleRunClient";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - "Run Now" in a rule table's bulk actions.
 *
 * Selected rules run one at a time, each to completion, because two runs over
 * the same resources would race each other's "already attached" reads. A bulk
 * run has nowhere to ask about notifications, so it never notifies. One rule
 * failing (switched off, say) must not stop the others, and must say why in
 * the failed list rather than as an anonymous count.
 */

const RULE_IDS: Array<string> = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function rule(id: string): MonitorOwnerRule {
  const item: MonitorOwnerRule = new MonitorOwnerRule();
  item._id = id;
  return item;
}

function success(): RuleRunOutcome {
  return {
    isSuccess: true,
    message: "Added owners to 1 monitor.",
    result: null,
  };
}

interface Callbacks {
  onProgressInfo: jest.Mock;
  onBulkActionStart: jest.Mock;
  onBulkActionEnd: jest.Mock;
}

function callbacks(): Callbacks {
  return {
    onProgressInfo: jest.fn(),
    onBulkActionStart: jest.fn(),
    onBulkActionEnd: jest.fn(),
  };
}

describe("getRunRulesBulkAction", () => {
  beforeEach(() => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ tenantid: "project-1" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("confirms with the rule count and the no-notification warning for owner rules", () => {
    const action: BulkActionButtonSchema<MonitorOwnerRule> =
      getRunRulesBulkAction({
        ruleType: RuleRunType.MonitorOwnerRule,
        modelType: MonitorOwnerRule,
      });

    const items: Array<MonitorOwnerRule> = RULE_IDS.map(rule);

    expect(action.title).toBe("Run Now");
    expect(action.disabled).toBe(false);
    expect(action.confirmTitle!(items)).toBe("Run 3 Rules Now");
    expect(action.confirmTitle!(items.slice(0, 1))).toBe("Run 1 Rule Now");
    expect(action.confirmMessage!(items)).toContain(
      "Owners added by a bulk run are not notified.",
    );
  });

  it("runs each selected rule in order, one at a time, never notifying", async () => {
    const order: Array<string> = [];
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    const runSpy: jest.SpyInstance = jest
      .spyOn(RuleRunClient, "run")
      .mockImplementation(async (data: { ruleId: string }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(data.ruleId);
        await Promise.resolve();
        inFlight--;
        return success();
      });

    const action: BulkActionButtonSchema<MonitorOwnerRule> =
      getRunRulesBulkAction({
        ruleType: RuleRunType.MonitorOwnerRule,
        modelType: MonitorOwnerRule,
      });
    const cb: Callbacks = callbacks();

    await action.onClick({
      items: RULE_IDS.map(rule),
      onProgressInfo: cb.onProgressInfo,
      onBulkActionStart: cb.onBulkActionStart,
      onBulkActionEnd: cb.onBulkActionEnd,
    });

    expect(order).toEqual(RULE_IDS);
    expect(maxInFlight).toBe(1);

    for (const call of runSpy.mock.calls) {
      expect(call[0]).toMatchObject({
        ruleType: RuleRunType.MonitorOwnerRule,
        notifyOwners: false,
        headers: { tenantid: "project-1" },
      });
    }

    expect(cb.onBulkActionStart).toHaveBeenCalledTimes(1);
    expect(cb.onBulkActionEnd).toHaveBeenCalledTimes(1);
    expect(cb.onProgressInfo).toHaveBeenCalledTimes(3);

    const last: ProgressInfo<MonitorOwnerRule> = cb.onProgressInfo.mock
      .calls[2]![0] as ProgressInfo<MonitorOwnerRule>;
    expect(last.successItems).toHaveLength(3);
    expect(last.failed).toHaveLength(0);
    expect(last.inProgressItems).toHaveLength(0);
  });

  it("keeps going past a failed rule and reports its reason", async () => {
    jest
      .spyOn(RuleRunClient, "run")
      .mockImplementation(async (data: { ruleId: string }) => {
        if (data.ruleId === RULE_IDS[1]) {
          return {
            isSuccess: false,
            message: "This rule is disabled. Enable it before running it.",
            result: null,
          };
        }

        return success();
      });

    const action: BulkActionButtonSchema<MonitorOwnerRule> =
      getRunRulesBulkAction({
        ruleType: RuleRunType.MonitorOwnerRule,
        modelType: MonitorOwnerRule,
      });
    const cb: Callbacks = callbacks();

    await action.onClick({
      items: RULE_IDS.map(rule),
      onProgressInfo: cb.onProgressInfo,
      onBulkActionStart: cb.onBulkActionStart,
      onBulkActionEnd: cb.onBulkActionEnd,
    });

    const last: ProgressInfo<MonitorOwnerRule> = cb.onProgressInfo.mock
      .calls[2]![0] as ProgressInfo<MonitorOwnerRule>;

    expect(last.successItems).toHaveLength(2);
    expect(last.failed).toHaveLength(1);

    const failure: BulkActionFailed<MonitorOwnerRule> = last.failed[0]!;
    expect(failure.item._id).toBe(RULE_IDS[1]);
    expect(failure.failedMessage).toBe(
      "This rule is disabled. Enable it before running it.",
    );
  });

  it("is locked, and does nothing, for a viewer who cannot edit rules", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need permission to edit monitor owner rules.",
    });
    const runSpy: jest.SpyInstance = jest.spyOn(RuleRunClient, "run");

    const action: BulkActionButtonSchema<MonitorOwnerRule> =
      getRunRulesBulkAction({
        ruleType: RuleRunType.MonitorOwnerRule,
        modelType: MonitorOwnerRule,
      });
    const cb: Callbacks = callbacks();

    expect(action.disabled).toBe(true);
    expect(action.tooltip).toBe(
      "You need permission to edit monitor owner rules.",
    );

    await action.onClick({
      items: RULE_IDS.map(rule),
      onProgressInfo: cb.onProgressInfo,
      onBulkActionStart: cb.onBulkActionStart,
      onBulkActionEnd: cb.onBulkActionEnd,
    });

    expect(runSpy).not.toHaveBeenCalled();
    expect(cb.onBulkActionStart).not.toHaveBeenCalled();
  });
});
