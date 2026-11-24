import FixAccountChangesStepCheck, {
  decideAccountChanges,
  describeAccountChange,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/FixAccountChangesStepCheck";
import {
  AccountChangeAnswer,
  AccountChangesReading,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AccountChangesState";
import {
  StepCheckContext,
  StepCheckEvidence,
  StepCheckResult,
  StepCheckTarget,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import {
  AccountChangeFacts,
  AccountChangeState,
  AccountChangeUnknownReason,
} from "../../../../../Server/Utils/SecurityPlaybook/AccountChangeReadBack";
import ObjectID from "../../../../../Types/ObjectID";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityCaseEventSnapshot } from "../../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchesJson,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import { SecurityCaseStepCheckSentence } from "../../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
} from "../../../../../Utils/SecurityCase/AttackAccountChanges";
import {
  RESPONSE_STEP_KINDS,
  getResponseStepKey,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import { ResponsePhase } from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import {
  CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
  CHECK_ACCOUNT_CHANGES_BACK,
  CHECK_ACCOUNT_CHANGES_CANNOT_READ,
  CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
  CHECK_ACCOUNT_CHANGES_FACT_AWS,
  CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
  CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_NONE_FOUND,
  CHECK_ACCOUNT_CHANGES_STILL_THERE,
  CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE,
  CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
  CHECK_ACCOUNT_CHANGE_GROUP_STILL,
  CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
  CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_MFA_UNDONE,
  CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ROLE_STILL,
  CHECK_COULD_NOT_CHECK,
  CHECK_PRODUCT_READ_FAILED,
  CHECK_PRODUCT_SAID,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { describe, expect, test } from "@jest/globals";

/*
 * "Undo what changed on the account that you did not expect: roles, keys
 * and MFA devices" (fix:account-changes, #10603): what the attack gave,
 * from the case's events, each read back in the product it was made in.
 * Looks Done at most - never checked on a guess, and what a product
 * cannot say is named for a person to confirm - Not Done while a change
 * is still there, Stopped Holding when one comes back, Cannot Tell when
 * nothing can be read back or a product cannot be read just now.
 */

const NOW: Date = new Date("2026-11-17T21:00:00.000Z");
const KEY: string = getResponseStepKey(RESPONSE_STEP_KINDS.fixAccountChanges);

function change(data: Partial<AccountChange>): AccountChange {
  return {
    provider: AccountChangeProvider.Okta,
    kind: AccountChangeKind.Group,
    account: "alice@acme.com",
    accountId: "00u1alice",
    objectId: "00g1admins",
    objectName: "Admins",
    detailId: "",
    ownerType: "",
    eventName: "group.user_membership.add",
    eventUid: "event-1",
    time: "2026-11-17T19:30:00.000Z",
    ...data,
  };
}

const GROUP: AccountChange = change({});
const ROLE: AccountChange = change({
  kind: AccountChangeKind.AdminRole,
  objectId: "",
  objectName: "Super administrator",
  eventUid: "event-2",
});
const FACTOR: AccountChange = change({
  kind: AccountChangeKind.MfaDevice,
  objectId: "pfd1",
  objectName: "Okta Verify",
  eventUid: "event-3",
});
const AWS_KEY: AccountChange = change({
  provider: AccountChangeProvider.Aws,
  kind: AccountChangeKind.Key,
  account: "deploy-bot",
  accountId: "",
  objectId: "",
  objectName: "AKIAEXAMPLE",
  eventUid: "event-4",
});

function facts(
  state: AccountChangeState,
  extra: Partial<AccountChangeFacts> = {},
): AccountChangeFacts {
  return {
    provider: "Okta",
    state,
    url: "https://acme-admin.okta.com/admin/user/profile/view/00u1alice",
    ...extra,
  };
}

function answer(
  item: AccountChange,
  data: Partial<AccountChangeAnswer> = {},
): AccountChangeAnswer {
  return { change: item, facts: null, hasConnection: true, ...data };
}

function target(
  previous: StepCheckTarget["previous"] = null,
): StepCheckTarget {
  return {
    step: {
      key: KEY,
      phase: ResponsePhase.Fix,
      text: { template: "", values: {} },
    } as unknown as StepCheckTarget["step"],
    value: "",
    previous,
    task: null,
  };
}

function decide(
  answers: Array<AccountChangeAnswer>,
  previous: StepCheckTarget["previous"] = null,
): StepCheckResult {
  return decideAccountChanges({
    changes: answers.map((item: AccountChangeAnswer): AccountChange => {
      return item.change;
    }),
    reading: { answers },
    now: NOW,
    target: target(previous),
  });
}

function templates(
  sentences: Array<SecurityCaseStepCheckSentence>,
): Array<SecurityCaseStepCheckSentence["template"]> {
  return sentences.map(
    (
      sentence: SecurityCaseStepCheckSentence,
    ): SecurityCaseStepCheckSentence["template"] => {
      return sentence.template;
    },
  );
}

describe("what the attack changed, read back", () => {
  test("a case whose events record no change: OneUptime cannot tell what to undo, and says how to let it", () => {
    const result: StepCheckResult = decide([]);

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence.template).toBe(
      CHECK_ACCOUNT_CHANGES_NONE_FOUND,
    );
    expect(result.evidence.docsPath).toBe(
      "/telemetry/security-cases#how-oneuptime-checks-a-step",
    );
  });

  test("every change undone: looks done - never checked, a change made another way may not be in the events", () => {
    const result: StepCheckResult = decide([
      answer(GROUP, { facts: facts(AccountChangeState.Undone) }),
      answer(FACTOR, { facts: facts(AccountChangeState.Undone) }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
      values: {},
      count: 2,
    });
    expect(templates(result.evidence.facts)).toEqual([
      CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
      CHECK_ACCOUNT_CHANGE_MFA_UNDONE,
    ]);
    expect(result.evidence.facts[0]!.values).toEqual({
      account: "alice@acme.com",
      object: "Admins",
      provider: "Okta",
    });
    expect(result.evidence.data).toMatchObject({
      changes: 2,
      undone: 2,
      stillThere: 0,
      toConfirm: 0,
      doneSince: NOW.toISOString(),
    });
    // The account's page, once.
    expect(result.evidence.links).toEqual([
      {
        kind: ResponseLinkKind.OpenProvider,
        provider: "Okta",
        url: "https://acme-admin.okta.com/admin/user/profile/view/00u1alice",
      },
    ]);
  });

  test("undone where OneUptime can read it, the rest unknowable: looks done at most, naming what a person confirms, and why", () => {
    const result: StepCheckResult = decide([
      answer(GROUP, { facts: facts(AccountChangeState.Undone) }),
      answer(ROLE, {
        facts: facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
          holding: ["Help Desk Administrator"],
        }),
      }),
      answer(AWS_KEY, { hasConnection: false }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
      values: {},
      count: 2,
    });
    // What to confirm first, with why, then what is undone.
    expect(templates(result.evidence.facts)).toEqual([
      CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM,
      CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
      CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
      CHECK_ACCOUNT_CHANGES_FACT_AWS,
      CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
    ]);
    expect(result.evidence.facts[1]!.values).toEqual({
      account: "deploy-bot",
      object: "AKIAEXAMPLE",
      provider: "AWS",
    });
    // The card says what to confirm at once (isCheckExplainedInline).
    expect(result.evidence.data["toConfirm"]).toBe(2);
  });

  test("a change still there: not done, naming it first, with the rest after", () => {
    const result: StepCheckResult = decide([
      answer(GROUP, { facts: facts(AccountChangeState.Undone) }),
      answer(ROLE, { facts: facts(AccountChangeState.StillThere) }),
      answer(AWS_KEY, { hasConnection: false }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_ACCOUNT_CHANGES_STILL_THERE,
      values: {},
      count: 1,
    });
    expect(templates(result.evidence.facts)).toEqual([
      CHECK_ACCOUNT_CHANGE_ROLE_STILL,
      CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
      CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
    ]);
    expect(result.evidence.data).toMatchObject({ stillThere: 1, undone: 1 });
  });

  test("a change back after it looked undone: stopped holding, said once, from the moment it was seen back", () => {
    const looksDone: StepCheckTarget["previous"] = {
      stepKey: KEY,
      state: SecurityCaseStepCheckState.LooksDone,
      evidence: {
        sentence: { template: CHECK_ACCOUNT_CHANGES_ALL_UNDONE, values: {} },
        facts: [],
        links: [],
        data: { doneSince: "2026-11-17T20:00:00.000Z" },
      },
      checkedAt: new Date("2026-11-17T20:00:00.000Z"),
      stateSince: new Date("2026-11-17T20:00:00.000Z"),
    };
    const back: StepCheckResult = decide(
      [answer(GROUP, { facts: facts(AccountChangeState.StillThere) })],
      looksDone,
    );

    expect(back.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(back.evidence.sentence.template).toBe(CHECK_ACCOUNT_CHANGES_BACK);
    expect(back.evidence.data["regressedAt"]).toBe(NOW.toISOString());

    // Still back on the next check: the same regression, from the same moment.
    const again: StepCheckResult = decideAccountChanges({
      changes: [GROUP],
      reading: {
        answers: [answer(GROUP, { facts: facts(AccountChangeState.StillThere) })],
      },
      now: new Date("2026-11-17T22:00:00.000Z"),
      target: target({
        stepKey: KEY,
        state: SecurityCaseStepCheckState.Regressed,
        evidence: back.evidence,
        checkedAt: NOW,
        stateSince: NOW,
      }),
    });

    expect(again.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(again.evidence.data["regressedAt"]).toBe(NOW.toISOString());
  });

  test("a product that could not be read may be the one that still has it: cannot tell, and tries again soon", () => {
    const result: StepCheckResult = decide([
      answer(GROUP, {
        facts: facts(AccountChangeState.Undone),
        error: "Okta answered 503",
      }),
      answer(FACTOR, { facts: facts(AccountChangeState.Undone) }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_PRODUCT_READ_FAILED,
      values: { value: "alice@acme.com", provider: "Okta" },
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_PRODUCT_SAID,
        values: { provider: "Okta", error: "Okta answered 503" },
      },
    ]);
    expect(result.evidence.data["readFailed"]).toBe(true);
    expect(result.recheckInMinutes).toBe(5);
  });

  test("still there wins over a failure elsewhere: it is not done, whatever the failed product would say", () => {
    expect(
      decide([
        answer(GROUP, { error: "Okta answered 503" }),
        answer(ROLE, { facts: facts(AccountChangeState.StillThere) }),
      ]).state,
    ).toBe(SecurityCaseStepCheckState.NotDone);
  });

  test("nothing OneUptime can read back: cannot tell, each change named for a person, with why and the docs", () => {
    const result: StepCheckResult = decide([
      answer(AWS_KEY, { hasConnection: false }),
      answer(GROUP, { hasConnection: false }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_ACCOUNT_CHANGES_CANNOT_READ,
      values: {},
      count: 2,
    });
    expect(templates(result.evidence.facts)).toEqual([
      CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
      CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
      CHECK_ACCOUNT_CHANGES_FACT_AWS,
      CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
    ]);
    expect(result.evidence.facts[3]!.values).toEqual({ provider: "Okta" });
    expect(result.evidence.docsPath).toBeDefined();
  });

  test("a change no connection had an account for is a person's to confirm, never undone", () => {
    expect(
      decide([answer(GROUP, { facts: null, hasConnection: true })]).state,
    ).toBe(SecurityCaseStepCheckState.CannotTell);
  });

  test("an account gone takes what it was given with it", () => {
    expect(
      describeAccountChange({
        change: GROUP,
        outcome: "Undone" as never,
        facts: facts(AccountChangeState.Undone, { isAccountGone: true }),
      }).template,
    ).toBe(CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE);
  });

  test("never checked by OneUptime, whatever it reads", () => {
    for (const state of [
      AccountChangeState.Undone,
      AccountChangeState.StillThere,
      AccountChangeState.Unknown,
    ]) {
      expect(
        decide([answer(GROUP, { facts: facts(state) })]).state,
      ).not.toBe(SecurityCaseStepCheckState.Verified);
    }
  });
});

describe("the step's check, over the case's events", () => {
  function oktaEvent(
    eventType: string,
    eventUid: string,
  ): SecurityCaseEventSnapshot {
    return {
      time: "2026-11-17T19:30:00.000Z",
      eventUid,
      sourceId: "",
      severityName: "",
      className: "",
      categoryName: "",
      activityName: "",
      statusName: "",
      message: "",
      vendorName: "Okta",
      productName: "Okta System Log",
      ruleName: "",
      principalUser: "",
      principalHost: "",
      principalIp: "",
      targetUser: "",
      targetHost: "",
      targetIp: "",
      targetPort: null,
      processName: "",
      processCommandLine: "",
      observables: [],
      mitreTactics: [],
      mitreTechniques: [],
      attributes: {
        eventType,
        "outcome.result": "SUCCESS",
        "target.0.id": "00u1alice",
        "target.0.type": "User",
        "target.0.alternateId": "alice@acme.com",
        "target.1.id": "00g1admins",
        "target.1.type": "UserGroup",
        "target.1.displayName": "Admins",
      },
      traceId: "",
      spanId: "",
      sessionId: "",
      requestOutcome: "",
      hunt: null,
    };
  }

  function matches(
    events: Array<SecurityCaseEventSnapshot>,
  ): SecurityCaseMatchesJson {
    return {
      detections: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          source: "Detection Rule",
          title: "Okta: user added to an admin group",
          severity: "High",
          groupValue: "alice@acme.com",
          ruleName: "Okta: user added to an admin group",
          eventCount: events.length,
          fireCount: 1,
          firstSeenAt: null,
          lastSeenAt: null,
          sampleMessage: "",
          isOpening: true,
          rule: null,
          threatIntelFeedId: "",
          securityEventConnectionId: "",
          basis: SecurityCaseMatchBasis.RuleCondition,
          windowStart: null,
          windowEnd: null,
          events,
          isKept: true,
          keptPastRetentionCount: 0,
          hiddenEventCount: 0,
          matchedEventCount: events.length,
          outcomes: {},
        },
      ],
      detectionCount: 1,
      unreadableSources: [],
      failedSources: [],
    };
  }

  function context(data: {
    matches: SecurityCaseMatchesJson | null;
    kept?: Array<SecurityCaseEventSnapshot>;
    read?: (changes: Array<AccountChange>) => Promise<AccountChangesReading>;
    asked?: Array<Array<AccountChange>>;
  }): StepCheckContext {
    return {
      securityCase: {
        projectId: ObjectID.generate(),
        securityCaseId: ObjectID.generate(),
        createdAt: new Date("2026-11-17T19:31:00.000Z"),
        firstDetectedAt: null,
        lastDetectedAt: null,
        entities: [],
        matches: data.matches,
        plan: {} as never,
        hasIncident: false,
      },
      target: target(),
      now: NOW,
      evidence: {
        readKeptEvents: async (): Promise<Array<SecurityCaseEventSnapshot>> => {
          return data.kept || [];
        },
        readAccountChanges: async (
          changes: Array<AccountChange>,
        ): Promise<AccountChangesReading> => {
          data.asked?.push(changes);
          return data.read
            ? data.read(changes)
            : {
                answers: changes.map(
                  (item: AccountChange): AccountChangeAnswer => {
                    return answer(item, {
                      facts: facts(AccountChangeState.Undone),
                    });
                  },
                ),
              };
        },
      } as unknown as StepCheckEvidence,
    };
  }

  test("is the account-changes step's, read hourly", () => {
    expect(FixAccountChangesStepCheck.kind).toBe("fix:account-changes");
    expect(FixAccountChangesStepCheck.intervalInMinutes).toBe(60);
  });

  test("reads what the events record, each change once, matched and kept alike", async () => {
    const asked: Array<Array<AccountChange>> = [];
    const result: StepCheckResult | null =
      await FixAccountChangesStepCheck.check(
        context({
          matches: matches([oktaEvent("group.user_membership.add", "event-1")]),
          kept: [oktaEvent("group.user_membership.add", "kept-1")],
          asked,
        }),
      );

    expect(asked).toHaveLength(1);
    expect(asked[0]!).toHaveLength(1);
    expect(asked[0]![0]).toMatchObject({
      kind: AccountChangeKind.Group,
      account: "alice@acme.com",
      objectId: "00g1admins",
    });
    expect(result?.state).toBe(SecurityCaseStepCheckState.LooksDone);
  });

  test("events that record no change are not read back at all", async () => {
    const asked: Array<Array<AccountChange>> = [];
    const result: StepCheckResult | null =
      await FixAccountChangesStepCheck.check(
        context({
          matches: matches([oktaEvent("user.session.start", "event-1")]),
          asked,
        }),
      );

    expect(asked).toEqual([]);
    expect(result?.evidence.sentence.template).toBe(
      CHECK_ACCOUNT_CHANGES_NONE_FOUND,
    );
  });

  test("detections that could not be read, or a read that throws, is never done: it tries again soon", async () => {
    for (const ctx of [
      context({ matches: null }),
      context({
        matches: matches([oktaEvent("group.user_membership.add", "event-1")]),
        read: async (): Promise<AccountChangesReading> => {
          throw new Error("database is down");
        },
      }),
    ]) {
      const result: StepCheckResult | null =
        await FixAccountChangesStepCheck.check(ctx);

      expect(result?.state).toBe(SecurityCaseStepCheckState.CannotTell);
      expect(result?.evidence.sentence.template).toBe(CHECK_COULD_NOT_CHECK);
      expect(result?.recheckInMinutes).toBe(5);
    }
  });
});
