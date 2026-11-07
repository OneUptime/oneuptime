import { describe, expect, test } from "@jest/globals";
import {
  ON_CALL_RULE_PAGE_AS_SELECT,
  OnCallRulePageRoles,
  OnCallRulesPaging,
  getNoOnCallRulesPaging,
  splitOnCallRulePolicies,
} from "../../../../Server/Utils/OnCall/OnCallRulePageAs";
import OnCallPageAs from "../../../../Types/OnCallDutyPolicy/OnCallPageAs";

/*
 * WHO A RECORD'S ON-CALL RULES PAGE, AND AS WHAT (OnCallRulePageAs): each
 * rule pages its policies as responders or as observers; responders win;
 * the record's own policies respond to it and are never paged again as
 * observers; observer policies are paged beside the record, not added to
 * it.
 */

const A: string = "policy-a";
const B: string = "policy-b";
const C: string = "policy-c";

describe("OnCallRulePageRoles", () => {
  test("a rule with nothing set pages responders, as rules always have", () => {
    const roles: OnCallRulePageRoles = new OnCallRulePageRoles();
    roles.addRule({}, [A]);

    expect(roles.isObserverOnly(A)).toBe(false);
  });

  test.each([
    [OnCallPageAs.Observers, true],
    ["Observers", true],
    ["observer", true],
    [OnCallPageAs.Responders, false],
    [null, false],
    [undefined, false],
    ["something else", false],
  ])(
    "a rule set to %p pages its policies as observers: %p",
    (pageAs: unknown, expected: boolean) => {
      const roles: OnCallRulePageRoles = new OnCallRulePageRoles();
      roles.addRule({ pageAs: pageAs as OnCallPageAs }, [A]);

      expect(roles.isObserverOnly(A)).toBe(expected);
    },
  );

  test.each([
    ["observers first", [OnCallPageAs.Observers, OnCallPageAs.Responders]],
    ["responders first", [OnCallPageAs.Responders, OnCallPageAs.Observers]],
  ])(
    "two rules paging one policy as observers and responders page responders (%s)",
    (_name: string, order: Array<OnCallPageAs>) => {
      const roles: OnCallRulePageRoles = new OnCallRulePageRoles();

      for (const pageAs of order) {
        roles.addRule({ pageAs: pageAs }, [A]);
      }

      expect(roles.isObserverOnly(A)).toBe(false);
    },
  );

  test("a policy no rule pages is no observer's", () => {
    const roles: OnCallRulePageRoles = new OnCallRulePageRoles();
    roles.addRule({ pageAs: OnCallPageAs.Observers }, [A]);

    expect(roles.isObserverOnly(B)).toBe(false);
  });

  test("an empty policy id is passed over", () => {
    const roles: OnCallRulePageRoles = new OnCallRulePageRoles();
    roles.addRule({ pageAs: OnCallPageAs.Observers }, ["", A]);

    expect(roles.isObserverOnly("")).toBe(false);
    expect(roles.isObserverOnly(A)).toBe(true);
  });
});

describe("splitOnCallRulePolicies", () => {
  test("responder policies are added; observer policies are paged beside; in the order matched", () => {
    const roles: OnCallRulePageRoles = new OnCallRulePageRoles();
    roles.addRule({ pageAs: OnCallPageAs.Observers }, [B]);
    roles.addRule({}, [A, C]);

    expect(
      splitOnCallRulePolicies({
        matchedPolicyIds: [B, A, C],
        existingPolicyIds: new Set<string>(),
        roles: roles,
      }),
    ).toEqual({ toAddPolicyIds: [A, C], observerPolicyIds: [B] });
  });

  test("a policy the record has already is neither added nor paged as observers", () => {
    const roles: OnCallRulePageRoles = new OnCallRulePageRoles();
    roles.addRule({ pageAs: OnCallPageAs.Observers }, [A]);
    roles.addRule({}, [B]);

    expect(
      splitOnCallRulePolicies({
        matchedPolicyIds: [A, B],
        existingPolicyIds: new Set<string>([A, B]),
        roles: roles,
      }),
    ).toEqual({ toAddPolicyIds: [], observerPolicyIds: [] });
  });

  test("nothing matched, nothing paged", () => {
    expect(
      splitOnCallRulePolicies({
        matchedPolicyIds: [],
        existingPolicyIds: new Set<string>(),
        roles: new OnCallRulePageRoles(),
      }),
    ).toEqual({ toAddPolicyIds: [], observerPolicyIds: [] });
  });
});

describe("what an engine reads and hands back", () => {
  test("it reads each rule's Page As", () => {
    expect(ON_CALL_RULE_PAGE_AS_SELECT).toEqual({ pageAs: true });
  });

  test("rules that page nobody hand back nothing - a new result each time", () => {
    const first: OnCallRulesPaging = getNoOnCallRulesPaging();
    const second: OnCallRulesPaging = getNoOnCallRulesPaging();

    expect(first.addedPolicyIds).toEqual([]);
    expect(first.observerPolicyIds).toEqual([]);
    expect(first.holds.size).toBe(0);

    first.observerPolicyIds.push(A);
    expect(second.observerPolicyIds).toEqual([]);
  });
});
