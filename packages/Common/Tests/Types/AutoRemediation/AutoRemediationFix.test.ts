import { describe, expect, test } from "@jest/globals";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import {
  AutoRemediationFixKind,
  doesRuleRunCommandsOnRunners,
  getAutoRemediationFixKind,
  getRuleCommandRunnerIds,
  getRuleRunbookIds,
  getRuleRunnerId,
  isOneUptimeAiFixRule,
  mayAiPickedRunbookStartWithoutAsking,
  readAutoRemediationIds,
} from "../../../Types/AutoRemediation/AutoRemediationFix";
import ObjectID from "../../../Types/ObjectID";

/*
 * HOW AN AUTO REMEDIATION RULE FIXES - the one reading the rule engine, the
 * AI runs it starts, the rule service and the dashboard share.
 *
 * The maintainer: "Can oneuptime AI do things by default, and I can
 * whitelist some Runbook for AI to pick and run? If I do not whitelist any
 * Runbook, it can basically run any Runbook by default." So OneUptime AI
 * fixes every rule's matches; the rule's runbooks are the allow-list (none:
 * any); its Runner is where OneUptime AI's own commands run (none: no Runner
 * at all - the AI agent on the affected cluster or host). A rule that runs
 * its runbooks every time keeps doing that, and the two shapes from before
 * rules were simplified keep doing what they did.
 */

const RUNNER_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const RUNNER_B: string = "aaaaaaaa-0000-4000-8000-000000000002";
const RUNBOOK_A: string = "bbbbbbbb-0000-4000-8000-000000000001";
const RUNBOOK_B: string = "bbbbbbbb-0000-4000-8000-000000000002";

describe("how a rule fixes", () => {
  test("every new rule, and one saved without the column, is OneUptime AI's", () => {
    for (const rule of [
      {},
      { remediationAction: AutoRemediationAction.OneUptimeAI },
      { remediationAction: null },
      { remediationAction: "SomethingNew" },
      {
        remediationAction: AutoRemediationAction.OneUptimeAI,
        aiComposesCommands: false,
        aiSelectsRunbook: false,
      },
    ]) {
      expect({ rule, kind: getAutoRemediationFixKind(rule) }).toEqual({
        rule,
        kind: AutoRemediationFixKind.OneUptimeAi,
      });
      expect(isOneUptimeAiFixRule(rule)).toBe(true);
    }
  });

  test("Runbooks is a rule that runs its runbooks every time, whatever old flag it carries", () => {
    for (const flags of [
      {},
      { aiComposesCommands: true },
      { aiSelectsRunbook: true },
      { aiComposesCommands: true, aiSelectsRunbook: true },
    ]) {
      const rule: Record<string, unknown> = {
        remediationAction: AutoRemediationAction.Runbooks,
        ...flags,
      };
      expect(getAutoRemediationFixKind(rule)).toBe(
        AutoRemediationFixKind.RunbooksEveryTime,
      );
      expect(isOneUptimeAiFixRule(rule)).toBe(false);
    }
  });

  test("the two shapes from before rules were simplified keep doing what they did, commands first", () => {
    expect(
      getAutoRemediationFixKind({
        remediationAction: AutoRemediationAction.OneUptimeAI,
        aiComposesCommands: true,
      }),
    ).toBe(AutoRemediationFixKind.CommandsOnRunners);
    expect(
      getAutoRemediationFixKind({
        remediationAction: AutoRemediationAction.OneUptimeAI,
        aiSelectsRunbook: true,
      }),
    ).toBe(AutoRemediationFixKind.AiPicksRunbook);
    // Both never ran together: the commands lane took the rule.
    expect(
      getAutoRemediationFixKind({
        aiComposesCommands: true,
        aiSelectsRunbook: true,
      }),
    ).toBe(AutoRemediationFixKind.CommandsOnRunners);

    for (const rule of [
      { aiComposesCommands: true },
      { aiSelectsRunbook: true },
    ]) {
      expect(isOneUptimeAiFixRule(rule)).toBe(false);
    }
  });
});

describe("the ids a rule names", () => {
  test("rows, ids and ObjectIDs alike, lowercased, each once, in order", () => {
    expect(
      readAutoRemediationIds([
        { _id: RUNBOOK_A.toUpperCase() },
        { id: new ObjectID(RUNBOOK_B) },
        ` ${RUNBOOK_A} `,
        new ObjectID(RUNBOOK_B),
      ]),
    ).toEqual([RUNBOOK_A, RUNBOOK_B]);
  });

  test("nothing, or something that names no id, is none", () => {
    for (const value of [undefined, null, [], [{}], [""], [42], {}, ""]) {
      expect({ value, ids: readAutoRemediationIds(value) }).toEqual({
        value,
        ids: [],
      });
    }
    // A single row or id is a list of one.
    expect(readAutoRemediationIds({ _id: RUNNER_A })).toEqual([RUNNER_A]);
    expect(readAutoRemediationIds(RUNNER_A)).toEqual([RUNNER_A]);
  });

  test("a rule's runbooks are its allow-list, and its Runner is one id or none", () => {
    expect(getRuleRunbookIds({})).toEqual([]);
    expect(
      getRuleRunbookIds({ runbooks: [{ _id: RUNBOOK_A }, { _id: RUNBOOK_B }] }),
    ).toEqual([RUNBOOK_A, RUNBOOK_B]);

    expect(getRuleRunnerId({})).toBe("");
    expect(getRuleRunnerId({ runnerId: null })).toBe("");
    expect(getRuleRunnerId({ runnerId: new ObjectID(RUNNER_A) })).toBe(
      RUNNER_A,
    );
    expect(getRuleRunnerId({ runnerId: RUNNER_A.toUpperCase() })).toBe(
      RUNNER_A,
    );
  });
});

describe("the Runners OneUptime AI may run a rule's commands on", () => {
  test("a OneUptime AI rule: the Runner it picks, or none - never any Runner", () => {
    expect(getRuleCommandRunnerIds({})).toEqual([]);
    expect(getRuleCommandRunnerIds({ runnerId: RUNNER_A })).toEqual([RUNNER_A]);
    // Command Runners never decided anything for it.
    expect(
      getRuleCommandRunnerIds({
        runnerId: RUNNER_A,
        commandRunners: [{ _id: RUNNER_B }],
      }),
    ).toEqual([RUNNER_A]);
    expect(
      getRuleCommandRunnerIds({ commandRunners: [{ _id: RUNNER_B }] }),
    ).toEqual([]);
  });

  test("a rule saved composing commands: its Command Runners, with the Runner it picks first", () => {
    expect(
      getRuleCommandRunnerIds({
        aiComposesCommands: true,
        commandRunners: [{ _id: RUNNER_B }],
      }),
    ).toEqual([RUNNER_B]);
    expect(
      getRuleCommandRunnerIds({
        aiComposesCommands: true,
        runnerId: RUNNER_A,
        commandRunners: [{ _id: RUNNER_B }, { _id: RUNNER_A }],
      }),
    ).toEqual([RUNNER_A, RUNNER_B]);
    // None named is none, not any Runner.
    expect(getRuleCommandRunnerIds({ aiComposesCommands: true })).toEqual([]);
  });

  test("a rule that runs its runbooks every time has none, whatever it holds", () => {
    expect(
      getRuleCommandRunnerIds({
        remediationAction: AutoRemediationAction.Runbooks,
        aiComposesCommands: true,
        commandRunners: [{ _id: RUNNER_B }],
      }),
    ).toEqual([]);
  });

  test("OneUptime AI composes commands for a OneUptime AI rule that picks a Runner, or an old commands rule", () => {
    expect(doesRuleRunCommandsOnRunners({})).toBe(false);
    expect(doesRuleRunCommandsOnRunners({ runnerId: RUNNER_A })).toBe(true);
    expect(doesRuleRunCommandsOnRunners({ aiComposesCommands: true })).toBe(
      true,
    );
    expect(
      doesRuleRunCommandsOnRunners({
        aiSelectsRunbook: true,
        runnerId: RUNNER_A,
      }),
    ).toBe(false);
    expect(
      doesRuleRunCommandsOnRunners({
        remediationAction: AutoRemediationAction.Runbooks,
        runnerId: RUNNER_A,
      }),
    ).toBe(false);
  });
});

describe("whether a runbook OneUptime AI picks starts without asking", () => {
  const STARTS: Parameters<typeof mayAiPickedRunbookStartWithoutAsking>[0] = {
    executionMode: AutoRemediationExecutionMode.FullAuto,
    namesRunbooks: true,
    anotherRuleAsksFirst: false,
    agentRoundStarted: false,
  };

  test("only for a rule that fixes without asking and names its runbooks, alone, with no AI agent fixing", () => {
    expect(mayAiPickedRunbookStartWithoutAsking(STARTS)).toBe(true);
  });

  test("any one condition missing proposes it instead", () => {
    for (const change of [
      { executionMode: AutoRemediationExecutionMode.Suggest },
      { executionMode: undefined },
      { executionMode: "fullauto" },
      // Any runbook of the project: a pick from text an attacker can write.
      { namesRunbooks: false },
      // Of several matching rules, the one that asks wins.
      { anotherRuleAsksFirst: true },
      // Two fixes on their own for one signal would undo each other.
      { agentRoundStarted: true },
    ]) {
      expect({
        change,
        starts: mayAiPickedRunbookStartWithoutAsking({ ...STARTS, ...change }),
      }).toEqual({ change, starts: false });
    }
  });
});
