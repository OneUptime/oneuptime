import FixAccountChangesStepCheck, {
  ROLE_IDENTITY_PROVIDERS_MAX,
  confirmReasons,
  decideAccountChanges,
  describeAccountChange,
  describeAccountChangeLines,
  describeRoleIdentityProviders,
  describeRoleTrust,
  orderAccountChangeFacts,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/FixAccountChangesStepCheck";
import {
  AwsIdentityProviderKind,
  AwsIdentityProviderReach,
  AwsTrustedIdentityProvider,
} from "../../../../../Utils/SecurityCase/AwsTrustPolicy";
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
  AccountChangePolicyDocument,
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
import {
  STEP_CHECK_MAX_FACTS,
  SecurityCaseStepCheckSentence,
  StepCheckFactMark,
  isStepCheckFactMarkUnderLine,
  readStepCheckEvidence,
  readStepCheckSentence,
} from "../../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  AccountChangeSubject,
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
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
  CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
  CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_NONE_FOUND,
  CHECK_ACCOUNT_CHANGES_STILL_THERE,
  CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE,
  CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
  CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CHANGED,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_STILL,
  CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_MFA_UNDONE,
  CHECK_ACCOUNT_CHANGE_PASSWORD_CONFIRM,
  CHECK_ACCOUNT_CHANGE_PASSWORD_STILL,
  CHECK_ACCOUNT_CHANGE_PASSWORD_UNDONE,
  CHECK_ACCOUNT_CHANGE_POLICY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_POLICY_STILL,
  CHECK_ACCOUNT_CHANGE_POLICY_UNDONE,
  CHECK_ACCOUNT_CHANGE_PROVIDER_ANYONE,
  CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
  CHECK_ACCOUNT_CHANGE_PROVIDER_HELD,
  CHECK_ACCOUNT_CHANGE_PROVIDER_HELD_TO_SEVERAL,
  CHECK_ACCOUNT_CHANGE_PROVIDER_SAML,
  CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ROLE_GONE,
  CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CHANGED,
  CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_STILL,
  CHECK_ACCOUNT_CHANGE_ROLE_MADE_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
  CHECK_ACCOUNT_CHANGE_ROLE_MADE_UNDONE,
  CHECK_ACCOUNT_CHANGE_ROLE_POLICY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ROLE_POLICY_STILL,
  CHECK_ACCOUNT_CHANGE_ROLE_POLICY_UNDONE,
  CHECK_ACCOUNT_CHANGE_ROLE_STILL,
  CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT,
  CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNTS,
  CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT,
  CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
  CHECK_ACCOUNT_CHANGE_TRUST_STILL,
  CHECK_ACCOUNT_CHANGE_TRUST_UNDONE,
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
// The project's Google Workspace connection under Security Events > Connections (#11376).
const GOOGLE_CONNECTION_ID: string = "9a7e6c5d-0000-4000-8000-0000000060a1";

function change(data: Partial<AccountChange>): AccountChange {
  return {
    provider: AccountChangeProvider.Okta,
    kind: AccountChangeKind.Group,
    subject: AccountChangeSubject.Account,
    account: "alice@acme.com",
    accountId: "00u1alice",
    objectId: "00g1admins",
    objectName: "Admins",
    detailId: "",
    ownerType: "",
    cloudAccountId: "",
    cloudConnectionId: "",
    policyDocuments: [],
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
  objectId: "AKIAEXAMPLE",
  objectName: "AKIAEXAMPLE",
  cloudAccountId: "123456789012",
  eventName: "CreateAccessKey",
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

function target(previous: StepCheckTarget["previous"] = null): StepCheckTarget {
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
    // What to confirm first, with why and how to let OneUptime read it, then what is undone.
    expect(templates(result.evidence.facts)).toEqual([
      CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM,
      CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
      CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
      CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
      CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
    ]);
    expect(result.evidence.facts[3]!.values).toEqual({
      cloudAccount: "123456789012",
    });
    expect(result.evidence.facts[1]!.values).toEqual({
      account: "deploy-bot",
      object: "AKIAEXAMPLE",
      provider: "AWS",
    });
    // The card says what to confirm at once (isCheckExplainedInline).
    expect(result.evidence.data["toConfirm"]).toBe(2);
  });

  test("a change still there: not done, naming it first, then what to confirm and how to let OneUptime read it, then what is undone", () => {
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
      CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
      CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
      CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
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
        answers: [
          answer(GROUP, { facts: facts(AccountChangeState.StillThere) }),
        ],
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
      CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
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
      expect(decide([answer(GROUP, { facts: facts(state) })]).state).not.toBe(
        SecurityCaseStepCheckState.Verified,
      );
    }
  });
});

describe("each line marked by what it says (#10900, #10901)", () => {
  test("still there, undone, to confirm, and how to let OneUptime read the rest", () => {
    const result: StepCheckResult = decide([
      answer(GROUP, { facts: facts(AccountChangeState.Undone) }),
      answer(ROLE, { facts: facts(AccountChangeState.StillThere) }),
      answer(AWS_KEY, { hasConnection: false }),
    ]);

    expect(
      result.evidence.facts.map(
        (fact: SecurityCaseStepCheckSentence): unknown => {
          return [fact.template, fact.mark];
        },
      ),
    ).toEqual([
      [CHECK_ACCOUNT_CHANGE_ROLE_STILL, StepCheckFactMark.NotDone],
      [CHECK_ACCOUNT_CHANGE_KEY_CONFIRM, StepCheckFactMark.Confirm],
      [
        CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
        StepCheckFactMark.HowToCheck,
      ],
      [CHECK_ACCOUNT_CHANGE_GROUP_UNDONE, StepCheckFactMark.Done],
    ]);
  });

  test("the marks are kept as the check is stored and read back; one the card does not know is dropped", () => {
    const result: StepCheckResult = decide([
      answer(GROUP, { facts: facts(AccountChangeState.Undone) }),
      answer(AWS_KEY, { hasConnection: false }),
    ]);
    const stored: unknown = JSON.parse(JSON.stringify(result.evidence));

    expect(readStepCheckEvidence(stored)?.facts).toEqual(result.evidence.facts);
    expect(
      readStepCheckSentence({
        template: CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
        values: {},
        mark: "Sparkly",
      }),
    ).toEqual({ template: CHECK_ACCOUNT_CHANGE_GROUP_UNDONE, values: {} });
  });
});

describe("what a person is told to grant, so OneUptime reads the change back", () => {
  test("an AWS connection that reaches the account with its Security case checks off: what to turn on, once an account", () => {
    const notGranted: Partial<AccountChangeAnswer> = {
      facts: {
        provider: "AWS",
        state: AccountChangeState.Unknown,
        reason: AccountChangeUnknownReason.NotGranted,
      },
    };
    const otherAccount: AccountChange = change({
      ...AWS_KEY,
      objectId: "AKIAOTHER",
      cloudAccountId: "210987654321",
      eventUid: "event-5",
    });
    const result: StepCheckResult = decide([
      answer(GROUP, { facts: facts(AccountChangeState.Undone) }),
      answer(AWS_KEY, notGranted),
      answer(
        change({ ...AWS_KEY, objectId: "AKIA2", eventUid: "e6" }),
        notGranted,
      ),
      answer(otherAccount, notGranted),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(
      result.evidence.facts
        .filter((fact: SecurityCaseStepCheckSentence): boolean => {
          return fact.mark === StepCheckFactMark.HowToCheck;
        })
        .map((fact: SecurityCaseStepCheckSentence): unknown => {
          return [fact.template, fact.values];
        }),
    ).toEqual([
      [
        CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
        { cloudAccount: "123456789012" },
      ],
      [
        CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
        { cloudAccount: "210987654321" },
      ],
    ]);
    // And the docs, which say how.
    expect(result.evidence.docsPath).toBe(
      "/telemetry/security-cases#how-oneuptime-checks-a-step",
    );
  });

  test("a Google Workspace delegation without the group member scope: the scope to add, word for word, where the connection is - linked to its form (#11376)", () => {
    const group: AccountChange = change({
      provider: AccountChangeProvider.GoogleWorkspace,
      account: "alice@example.com",
      objectId: "",
      objectName: "finance@example.com",
      eventName: "ADD_GROUP_MEMBER",
    });
    const result: StepCheckResult = decide([
      answer(group, {
        facts: {
          provider: "Google Workspace",
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotGranted,
        },
        connectionId: GOOGLE_CONNECTION_ID,
      }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
        values: {
          account: "alice@example.com",
          object: "finance@example.com",
          provider: "Google Workspace",
        },
        mark: StepCheckFactMark.Confirm,
      },
      {
        template: CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
        values: {
          scope:
            "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
        },
        mark: StepCheckFactMark.HowToCheck,
        link: {
          kind: ResponseLinkKind.OpenSecurityEventConnection,
          connectionId: GOOGLE_CONNECTION_ID,
        },
      },
    ]);
    // Said with where the connection is, for a reader the link is not drawn for.
    expect(CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE).toContain(
      "of the Google Workspace connection under Security Events → Connections",
    );
    // What a check before #11376 said stays worded, for a case closed since.
    expect(CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS).toContain(
      "add the scope {{scope}} to the connection's domain-wide delegation",
    );
  });

  test("a Google Workspace answer that names no connection links to Security Events > Connections; two such changes say it once (#11376)", () => {
    const groupChange: (name: string) => AccountChange = (
      name: string,
    ): AccountChange => {
      return change({
        provider: AccountChangeProvider.GoogleWorkspace,
        account: "alice@example.com",
        objectId: "",
        objectName: name,
        eventName: "ADD_GROUP_MEMBER",
        eventUid: name,
      });
    };
    const notGranted: AccountChangeFacts = {
      provider: "Google Workspace",
      state: AccountChangeState.Unknown,
      reason: AccountChangeUnknownReason.NotGranted,
    };

    expect(
      confirmReasons([
        {
          change: groupChange("finance@example.com"),
          facts: notGranted,
          hasConnection: true,
        },
        {
          change: groupChange("admins@example.com"),
          facts: notGranted,
          hasConnection: true,
          connectionId: GOOGLE_CONNECTION_ID,
        },
      ]).map((fact: SecurityCaseStepCheckSentence): unknown => {
        return [fact.template, fact.link];
      }),
    ).toEqual([
      [
        CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
        { kind: ResponseLinkKind.OpenSecurityEventConnection },
      ],
    ]);
  });

  test("an AWS change whose event names no account: no connection to AWS, said as for any product, linked to Cloud > Connect", () => {
    const unnamed: AccountChange = change({ ...AWS_KEY, cloudAccountId: "" });

    expect(
      confirmReasons([
        { change: unnamed, facts: null, hasConnection: false },
      ]).map((fact: SecurityCaseStepCheckSentence): unknown => {
        return [fact.template, fact.values, fact.link];
      }),
    ).toEqual([
      [
        CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
        { provider: "AWS" },
        { kind: ResponseLinkKind.OpenCloudConnection },
      ],
    ]);
  });

  test("a change a product does not tell apart, or one it read, needs no line of how to grant", () => {
    expect(
      confirmReasons([
        {
          change: AWS_KEY,
          facts: {
            provider: "AWS",
            state: AccountChangeState.Unknown,
            reason: AccountChangeUnknownReason.NotNamed,
          },
          hasConnection: true,
        },
      ]),
    ).toEqual([]);
  });
});

describe("an AWS policy and console password read as what they are (#10900)", () => {
  const POLICY: AccountChange = change({
    ...AWS_KEY,
    kind: AccountChangeKind.Policy,
    objectId: "arn:aws:iam::aws:policy/AdministratorAccess",
    objectName: "AdministratorAccess",
    eventName: "AttachUserPolicy",
  });
  const PASSWORD: AccountChange = change({
    ...AWS_KEY,
    kind: AccountChangeKind.Password,
    objectId: "",
    objectName: "",
    eventName: "CreateLoginProfile",
  });

  test.each([
    [
      "Still",
      CHECK_ACCOUNT_CHANGE_POLICY_STILL,
      CHECK_ACCOUNT_CHANGE_PASSWORD_STILL,
    ],
    [
      "Undone",
      CHECK_ACCOUNT_CHANGE_POLICY_UNDONE,
      CHECK_ACCOUNT_CHANGE_PASSWORD_UNDONE,
    ],
    [
      "Confirm",
      CHECK_ACCOUNT_CHANGE_POLICY_CONFIRM,
      CHECK_ACCOUNT_CHANGE_PASSWORD_CONFIRM,
    ],
  ])("%s", (outcome: string, policy: string, password: string) => {
    expect(
      describeAccountChange({
        change: POLICY,
        outcome: outcome as never,
        facts: null,
      }),
    ).toMatchObject({
      template: policy,
      values: {
        account: "deploy-bot",
        object: "AdministratorAccess",
        provider: "AWS",
      },
    });
    expect(
      describeAccountChange({
        change: PASSWORD,
        outcome: outcome as never,
        facts: null,
      }).template,
    ).toBe(password);
  });
});

describe("the most a check keeps", () => {
  function many(
    count: number,
    data: Partial<AccountChange>,
    answered: Partial<AccountChangeAnswer>,
  ): Array<AccountChangeAnswer> {
    const answers: Array<AccountChangeAnswer> = [];

    for (let index: number = 0; index < count; index++) {
      answers.push(
        answer(
          change({
            ...data,
            objectId: `${index}`,
            eventUid: `${data.eventUid}-${index}`,
          }),
          answered,
        ),
      );
    }

    return answers;
  }

  test("past it, what is undone goes first, then what to confirm: never what is still there, nor how to let OneUptime read the rest", () => {
    const result: StepCheckResult = decide([
      ...many(
        4,
        { eventUid: "still" },
        { facts: facts(AccountChangeState.StillThere) },
      ),
      ...many(16, { ...AWS_KEY, eventUid: "aws" }, { hasConnection: false }),
      ...many(
        10,
        { eventUid: "undone" },
        { facts: facts(AccountChangeState.Undone) },
      ),
    ]);
    const marks: Array<StepCheckFactMark | undefined> =
      result.evidence.facts.map(
        (
          fact: SecurityCaseStepCheckSentence,
        ): StepCheckFactMark | undefined => {
          return fact.mark;
        },
      );

    expect(result.evidence.facts).toHaveLength(STEP_CHECK_MAX_FACTS);
    expect(
      marks.filter((mark: StepCheckFactMark | undefined): boolean => {
        return mark === StepCheckFactMark.NotDone;
      }),
    ).toHaveLength(4);
    expect(marks).toContain(StepCheckFactMark.HowToCheck);
    expect(
      marks.filter((mark: StepCheckFactMark | undefined): boolean => {
        return mark === StepCheckFactMark.Confirm;
      }),
    ).toHaveLength(16);
    // The rest of the room goes to what is undone: 24 - 4 - 1 - 16.
    expect(
      marks.filter((mark: StepCheckFactMark | undefined): boolean => {
        return mark === StepCheckFactMark.Done;
      }),
    ).toHaveLength(3);
    // In the order the card draws them.
    expect(marks.indexOf(StepCheckFactMark.HowToCheck)).toBe(20);
  });

  test("orders a check's facts whatever their number, within the room", () => {
    const line: (mark: StepCheckFactMark) => SecurityCaseStepCheckSentence = (
      mark: StepCheckFactMark,
    ): SecurityCaseStepCheckSentence => {
      return { template: "x", values: {}, mark };
    };

    expect(
      orderAccountChangeFacts({
        still: [line(StepCheckFactMark.NotDone)],
        confirm: [line(StepCheckFactMark.Confirm)],
        howToCheck: [line(StepCheckFactMark.HowToCheck)],
        undone: [line(StepCheckFactMark.Done)],
      }).map((fact: SecurityCaseStepCheckSentence) => {
        return fact.mark;
      }),
    ).toEqual([
      StepCheckFactMark.NotDone,
      StepCheckFactMark.Confirm,
      StepCheckFactMark.HowToCheck,
      StepCheckFactMark.Done,
    ]);
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

// ---------- An IAM role's changes (#11038), and where to grant the reads (#11039) ----------

const AWS_ACCOUNT: string = "123456789012";
const CONNECTION_ID: string = "5d0c2a7e-0000-4000-8000-00000000c0de";

function roleChange(data: Partial<AccountChange>): AccountChange {
  return change({
    provider: AccountChangeProvider.Aws,
    subject: AccountChangeSubject.Role,
    account: "Deploy",
    accountId: "",
    objectId: "",
    objectName: "",
    cloudAccountId: AWS_ACCOUNT,
    ...data,
  });
}

const ROLE_MADE: AccountChange = roleChange({
  kind: AccountChangeKind.Account,
  account: "backdoor",
  accountId: "AROA6ON6E4XEFFEXAMPLE",
  eventName: "CreateRole",
  eventUid: "role-1",
});
const ROLE_TRUST: AccountChange = roleChange({
  kind: AccountChangeKind.Trust,
  eventName: "UpdateAssumeRolePolicy",
  eventUid: "role-2",
});
const ROLE_POLICY: AccountChange = roleChange({
  kind: AccountChangeKind.Policy,
  objectId: "arn:aws:iam::aws:policy/AdministratorAccess",
  objectName: "AdministratorAccess",
  eventName: "AttachRolePolicy",
  eventUid: "role-3",
});

function awsFacts(
  state: AccountChangeState,
  extra: Partial<AccountChangeFacts> = {},
): AccountChangeFacts {
  return {
    provider: "AWS",
    state,
    url: "https://console.aws.amazon.com/iam/home#/roles/details/Deploy",
    ...extra,
  };
}

const NOT_GRANTED: AccountChangeFacts = {
  provider: "AWS",
  state: AccountChangeState.Unknown,
  reason: AccountChangeUnknownReason.NotGranted,
};

describe("an IAM role's change is said as a role's (#11038)", () => {
  test.each([
    [
      ROLE_MADE,
      CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
      CHECK_ACCOUNT_CHANGE_ROLE_MADE_UNDONE,
      CHECK_ACCOUNT_CHANGE_ROLE_MADE_CONFIRM,
    ],
    [
      ROLE_TRUST,
      CHECK_ACCOUNT_CHANGE_TRUST_STILL,
      CHECK_ACCOUNT_CHANGE_TRUST_UNDONE,
      CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
    ],
    [
      ROLE_POLICY,
      CHECK_ACCOUNT_CHANGE_ROLE_POLICY_STILL,
      CHECK_ACCOUNT_CHANGE_ROLE_POLICY_UNDONE,
      CHECK_ACCOUNT_CHANGE_ROLE_POLICY_CONFIRM,
    ],
  ])(
    "%#: still there, undone and to confirm, each marked, the role and what it gave named",
    (item: AccountChange, still: string, undone: string, confirm: string) => {
      const values: Record<string, string> = {
        account: item.account,
        object: item.objectName || item.objectId,
        provider: "AWS",
      };
      const decided: (
        state: AccountChangeState,
      ) => SecurityCaseStepCheckSentence = (
        state: AccountChangeState,
      ): SecurityCaseStepCheckSentence => {
        const result: StepCheckResult = decide([
          answer(item, { facts: awsFacts(state) }),
        ]);

        return result.evidence.facts[0]!;
      };

      expect(decided(AccountChangeState.StillThere)).toEqual({
        template: still,
        values,
        mark: StepCheckFactMark.NotDone,
      });
      expect(decided(AccountChangeState.Undone)).toEqual({
        template: undone,
        values,
        mark: StepCheckFactMark.Done,
      });
      expect(
        decide([answer(item, { facts: NOT_GRANTED })]).evidence.facts[0],
      ).toEqual({
        template: confirm,
        values,
        mark: StepCheckFactMark.Confirm,
      });
    },
  );

  test("a role deleted took what it was given; the role the attack made, deleted, is simply gone", () => {
    const gone: AccountChangeFacts = {
      provider: "AWS",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    };

    expect(
      decide([answer(ROLE_POLICY, { facts: gone })]).evidence.facts[0]!
        .template,
    ).toBe(CHECK_ACCOUNT_CHANGE_ROLE_GONE);
    expect(
      decide([answer(ROLE_TRUST, { facts: gone })]).evidence.facts[0]!.template,
    ).toBe(CHECK_ACCOUNT_CHANGE_ROLE_GONE);
    expect(
      decide([answer(ROLE_MADE, { facts: gone })]).evidence.facts[0]!.template,
    ).toBe(CHECK_ACCOUNT_CHANGE_ROLE_MADE_UNDONE);
  });

  test("a user's change of the same kind is still said as an account's", () => {
    const userPolicy: AccountChange = change({
      ...ROLE_POLICY,
      subject: AccountChangeSubject.Account,
      account: "deploy-bot",
      eventName: "AttachUserPolicy",
    });

    expect(
      describeAccountChange({
        change: userPolicy,
        outcome: "Still" as never,
        facts: awsFacts(AccountChangeState.StillThere),
      }).template,
    ).toBe(CHECK_ACCOUNT_CHANGE_POLICY_STILL);
    expect(
      decide([
        answer(userPolicy, {
          facts: {
            ...awsFacts(AccountChangeState.Undone),
            isAccountGone: true,
          },
        }),
      ]).evidence.facts[0]!.template,
    ).toBe(CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE);
  });
});

describe("whom a role trusts, under its line (#11038)", () => {
  test("one outside account, named with the account the role is in, on an unmarked line under the role's", () => {
    const result: StepCheckResult = decide([
      answer(ROLE_MADE, {
        facts: awsFacts(AccountChangeState.StillThere, {
          trusted: ["444455556666"],
        }),
      }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
        values: { account: "backdoor", object: "", provider: "AWS" },
        mark: StepCheckFactMark.NotDone,
      },
      {
        template: CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT,
        values: {
          account: "backdoor",
          cloudAccount: AWS_ACCOUNT,
          trusted: "444455556666",
        },
      },
    ]);
  });

  test("several, counted, the first named; every account, said as anyone", () => {
    expect(
      describeRoleTrust({
        change: ROLE_TRUST,
        outcome: "Confirm" as never,
        facts: awsFacts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
          trusted: ["444455556666", "555555555555", "999999999999"],
        }),
      }),
    ).toEqual({
      template: CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNTS,
      values: {
        account: "Deploy",
        cloudAccount: AWS_ACCOUNT,
        trusted: "444455556666",
      },
      count: 3,
    });
    expect(
      describeRoleTrust({
        change: ROLE_MADE,
        outcome: "Still" as never,
        facts: awsFacts(AccountChangeState.StillThere, {
          trusted: ["444455556666", "*"],
        }),
      }),
    ).toEqual({
      template: CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT,
      values: { account: "backdoor" },
      // A way in open to anyone, marked so (#11378).
      mark: StepCheckFactMark.Exposed,
    });
  });

  test("said only of a role still there or to confirm: not of one undone, of a role that trusts nobody outside, or of a user", () => {
    expect(
      describeRoleTrust({
        change: ROLE_TRUST,
        outcome: "Undone" as never,
        facts: awsFacts(AccountChangeState.Undone, {
          trusted: ["444455556666"],
        }),
      }),
    ).toBeNull();
    expect(
      describeRoleTrust({
        change: ROLE_MADE,
        outcome: "Still" as never,
        facts: awsFacts(AccountChangeState.StillThere),
      }),
    ).toBeNull();
    expect(
      describeRoleTrust({
        change: AWS_KEY,
        outcome: "Still" as never,
        facts: awsFacts(AccountChangeState.StillThere, {
          trusted: ["444455556666"],
        }),
      }),
    ).toBeNull();
    expect(
      describeAccountChangeLines({
        change: ROLE_POLICY,
        outcome: "Still" as never,
        facts: awsFacts(AccountChangeState.StillThere),
      }),
    ).toHaveLength(1);
  });

  test("a trust policy to confirm says so on its own line, with whom it trusts under it, and no 'cannot tell which' line", () => {
    const result: StepCheckResult = decide([
      answer(GROUP, { facts: facts(AccountChangeState.Undone) }),
      answer(ROLE_TRUST, {
        facts: awsFacts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
          trusted: ["111122223333"],
        }),
      }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(templates(result.evidence.facts)).toEqual([
      CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
      CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT,
      CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
    ]);
    expect(templates(result.evidence.facts)).not.toContain(
      CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
    );
  });

  test("a line and the unmarked one under it are kept, or left out, together - never whom a role trusts without its role", () => {
    const lines: (count: number) => Array<SecurityCaseStepCheckSentence> = (
      count: number,
    ): Array<SecurityCaseStepCheckSentence> => {
      return Array.from(
        { length: count },
        (_: unknown, index: number): Array<SecurityCaseStepCheckSentence> => {
          return describeAccountChangeLines({
            change: roleChange({
              kind: AccountChangeKind.Account,
              account: `backdoor-${index}`,
            }),
            outcome: "Still" as never,
            facts: awsFacts(AccountChangeState.StillThere, {
              trusted: ["444455556666"],
            }),
          });
        },
      ).flat();
    };
    const single: SecurityCaseStepCheckSentence = describeAccountChange({
      change: AWS_KEY,
      outcome: "Still" as never,
      facts: awsFacts(AccountChangeState.StillThere),
    });

    // A single line, then pairs: the pair that would be cut at the end is left out whole.
    const ordered: Array<SecurityCaseStepCheckSentence> =
      orderAccountChangeFacts({
        still: [single, ...lines(13)],
        confirm: [],
        howToCheck: [],
        undone: [],
      });

    expect(ordered).toHaveLength(STEP_CHECK_MAX_FACTS - 1);
    expect(ordered[ordered.length - 1]!.mark).toBeUndefined();
    expect(ordered[ordered.length - 2]!.mark).toBe(StepCheckFactMark.NotDone);

    // Exactly room for twelve pairs.
    expect(
      orderAccountChangeFacts({
        still: lines(12),
        confirm: [],
        howToCheck: [],
        undone: [single],
      }),
    ).toHaveLength(STEP_CHECK_MAX_FACTS);
  });
});

describe("the lines that say what to grant link to where it is granted (#11039)", () => {
  function howToCheck(
    result: StepCheckResult,
  ): Array<SecurityCaseStepCheckSentence> {
    return result.evidence.facts.filter(
      (fact: SecurityCaseStepCheckSentence): boolean => {
        return fact.mark === StepCheckFactMark.HowToCheck;
      },
    );
  }

  test("checks off on the connection that reaches the account: turn them on, linked to that connection's form", () => {
    expect(
      howToCheck(
        decide([
          answer(AWS_KEY, {
            facts: NOT_GRANTED,
            reader: { connectionId: CONNECTION_ID, isChecking: false },
          }),
        ]),
      ),
    ).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
        values: { cloudAccount: AWS_ACCOUNT },
        mark: StepCheckFactMark.HowToCheck,
        link: {
          kind: ResponseLinkKind.OpenCloudConnection,
          connectionId: CONNECTION_ID,
        },
      },
    ]);
  });

  test("checks on, and AWS refused all the same - its command not run again since the role reads: run it again, linked to the connection", () => {
    expect(
      howToCheck(
        decide([
          answer(ROLE_TRUST, {
            facts: NOT_GRANTED,
            reader: { connectionId: CONNECTION_ID, isChecking: true },
          }),
          answer(ROLE_POLICY, {
            facts: NOT_GRANTED,
            reader: { connectionId: CONNECTION_ID, isChecking: true },
          }),
        ]),
      ),
    ).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
        values: { cloudAccount: AWS_ACCOUNT },
        mark: StepCheckFactMark.HowToCheck,
        link: {
          kind: ResponseLinkKind.OpenCloudConnection,
          connectionId: CONNECTION_ID,
        },
      },
    ]);
  });

  test("no connection reads the account: connect one, linked to Cloud > Connect", () => {
    expect(
      howToCheck(decide([answer(AWS_KEY, { hasConnection: false })])),
    ).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
        values: { cloudAccount: AWS_ACCOUNT },
        mark: StepCheckFactMark.HowToCheck,
        link: { kind: ResponseLinkKind.OpenCloudConnection },
      },
    ]);
  });

  test("an answer that names no connection links to Cloud > Connect; another product with no connection, to Security Events > Connections where it is connected (#11376)", () => {
    const result: StepCheckResult = decide([
      answer(AWS_KEY, { facts: NOT_GRANTED }),
      answer(GROUP, { hasConnection: false }),
    ]);

    expect(
      howToCheck(result).map((fact: SecurityCaseStepCheckSentence): unknown => {
        return [fact.template, fact.link];
      }),
    ).toEqual([
      [
        CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
        { kind: ResponseLinkKind.OpenCloudConnection },
      ],
      [
        CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
        { kind: ResponseLinkKind.OpenSecurityEventConnection },
      ],
    ]);
  });

  test("a line's link is kept as the check is stored and read back; one the card cannot route is dropped", () => {
    const result: StepCheckResult = decide([
      answer(AWS_KEY, {
        facts: NOT_GRANTED,
        reader: { connectionId: CONNECTION_ID, isChecking: false },
      }),
    ]);
    const stored: unknown = JSON.parse(JSON.stringify(result.evidence));

    expect(readStepCheckEvidence(stored)?.facts).toEqual(result.evidence.facts);
    expect(
      readStepCheckSentence({
        template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
        values: { cloudAccount: AWS_ACCOUNT },
        link: { kind: "OpenSomewhereElse", url: "https://evil.example.com" },
      }),
    ).toEqual({
      template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
      values: { cloudAccount: AWS_ACCOUNT },
    });
  });
});

// ---------- The identity providers a role lets in (#11378) ----------

describe("whom a role lets in through an identity provider, under its line (#11378)", () => {
  const GITHUB: string = "token.actions.githubusercontent.com";

  function provider(
    data: Partial<AwsTrustedIdentityProvider>,
  ): AwsTrustedIdentityProvider {
    return {
      principal: `arn:aws:iam::${AWS_ACCOUNT}:oidc-provider/${GITHUB}`,
      name: GITHUB,
      kind: AwsIdentityProviderKind.Oidc,
      reach: AwsIdentityProviderReach.Limited,
      claim: "sub",
      values: ["repo:GitHubOrg/GitHubRepo:*"],
      ...data,
    };
  }

  const OPEN_GITHUB: AwsTrustedIdentityProvider = provider({
    reach: AwsIdentityProviderReach.AnyOrganization,
    values: [],
  });
  const CLUSTER: AwsTrustedIdentityProvider = provider({
    principal: `arn:aws:iam::${AWS_ACCOUNT}:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE`,
    name: "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE",
    reach: AwsIdentityProviderReach.Anyone,
    values: [],
  });
  const OKTA: AwsTrustedIdentityProvider = provider({
    principal: `arn:aws:iam::${AWS_ACCOUNT}:saml-provider/Okta`,
    name: "Okta",
    kind: AwsIdentityProviderKind.Saml,
    reach: AwsIdentityProviderReach.SignedIn,
    claim: "",
    values: [],
  });

  function lines(
    item: AccountChange,
    outcome: string,
    providers: Array<AwsTrustedIdentityProvider>,
    extra: Partial<AccountChangeFacts> = {},
  ): Array<SecurityCaseStepCheckSentence> {
    return describeRoleIdentityProviders({
      change: item,
      outcome: outcome as never,
      facts: awsFacts(AccountChangeState.StillThere, { providers, ...extra }),
    });
  }

  test("held to a value: the tokens it lets in, said plainly, on an unmarked line", () => {
    expect(lines(ROLE_MADE, "Still", [provider({})])).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_HELD,
        values: {
          account: "backdoor",
          provider: GITHUB,
          claim: "sub",
          value: "repo:GitHubOrg/GitHubRepo:*",
        },
      },
    ]);
  });

  test("held to several values: counted, the first named", () => {
    expect(
      lines(ROLE_TRUST, "Confirm", [
        provider({
          values: [
            "repo:GitHubOrg/app:*",
            "repo:GitHubOrg/api:*",
            "repo:GitHubOrg/web:*",
          ],
        }),
      ]),
    ).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_HELD_TO_SEVERAL,
        values: {
          account: "Deploy",
          provider: GITHUB,
          claim: "sub",
          value: "repo:GitHubOrg/app:*",
        },
        count: 3,
      },
    ]);
  });

  test("open to anyone: every organization through a shared provider, anyone a provider of your own signs in - each marked", () => {
    expect(lines(ROLE_MADE, "Still", [OPEN_GITHUB, CLUSTER])).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
        values: { account: "backdoor", provider: GITHUB, claim: "sub" },
        mark: StepCheckFactMark.Exposed,
      },
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_ANYONE,
        values: {
          account: "backdoor",
          provider: CLUSTER.name,
          claim: "sub",
        },
        mark: StepCheckFactMark.Exposed,
      },
    ]);
  });

  test("a SAML provider: the people it signs in as the role", () => {
    expect(lines(ROLE_MADE, "Still", [OKTA])).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_SAML,
        values: { account: "backdoor", provider: "Okta" },
      },
    ]);
  });

  test(`at most ${ROLE_IDENTITY_PROVIDERS_MAX}, the open ones first: one is never left out for a held one`, () => {
    const many: Array<AwsTrustedIdentityProvider> = [
      provider({ name: "a.example.com" }),
      provider({ name: "b.example.com" }),
      OKTA,
      provider({ name: "c.example.com" }),
      OPEN_GITHUB,
    ];

    expect(
      lines(ROLE_MADE, "Still", many).map(
        (line: SecurityCaseStepCheckSentence): string => {
          return line.values["provider"]!;
        },
      ),
    ).toEqual([GITHUB, "a.example.com", "b.example.com"]);
    expect(ROLE_IDENTITY_PROVIDERS_MAX).toBe(3);
  });

  test("said only of a role still there or to confirm, as whom it trusts outside its account", () => {
    expect(lines(ROLE_TRUST, "Undone", [OPEN_GITHUB])).toEqual([]);
    expect(lines(AWS_KEY, "Still", [OPEN_GITHUB])).toEqual([]);
    expect(lines(ROLE_MADE, "Still", [])).toEqual([]);
  });

  test("under the role's line, after the outside accounts it trusts, kept with it as the check is decided", () => {
    const result: StepCheckResult = decide([
      answer(ROLE_MADE, {
        facts: awsFacts(AccountChangeState.StillThere, {
          trusted: ["444455556666"],
          providers: [provider({}), OPEN_GITHUB],
        }),
      }),
    ]);

    expect(
      result.evidence.facts.map(
        (fact: SecurityCaseStepCheckSentence): [unknown, unknown] => {
          return [fact.template, fact.mark];
        },
      ),
    ).toEqual([
      [CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL, StepCheckFactMark.NotDone],
      [CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT, undefined],
      [
        CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
        StepCheckFactMark.Exposed,
      ],
      [CHECK_ACCOUNT_CHANGE_PROVIDER_HELD, undefined],
    ]);
  });

  test("a marked line under a change is kept, or left out, with it - never a way in without its role", () => {
    const group: Array<SecurityCaseStepCheckSentence> =
      describeAccountChangeLines({
        change: ROLE_MADE,
        outcome: "Still" as never,
        facts: awsFacts(AccountChangeState.StillThere, {
          trusted: ["*"],
          providers: [OPEN_GITHUB],
        }),
      });
    const single: SecurityCaseStepCheckSentence = describeAccountChange({
      change: AWS_KEY,
      outcome: "Still" as never,
      facts: awsFacts(AccountChangeState.StillThere),
    });

    expect(
      group.map((line: SecurityCaseStepCheckSentence): unknown => {
        return line.mark;
      }),
    ).toEqual([
      StepCheckFactMark.NotDone,
      StepCheckFactMark.Exposed,
      StepCheckFactMark.Exposed,
    ]);

    // Room for one line less than the group: it is left out whole, never cut after its role.
    const ordered: Array<SecurityCaseStepCheckSentence> =
      orderAccountChangeFacts({
        still: [
          ...Array.from({ length: STEP_CHECK_MAX_FACTS - 2 }, () => {
            return single;
          }),
          ...group,
        ],
        confirm: [],
        howToCheck: [],
        undone: [],
      });

    expect(ordered).toHaveLength(STEP_CHECK_MAX_FACTS - 2);
    expect(
      ordered.some((line: SecurityCaseStepCheckSentence): boolean => {
        return line.mark === StepCheckFactMark.Exposed;
      }),
    ).toBe(false);
  });

  test("the mark is kept as the check is stored and read back", () => {
    const result: StepCheckResult = decide([
      answer(ROLE_MADE, {
        facts: awsFacts(AccountChangeState.StillThere, {
          providers: [OPEN_GITHUB],
        }),
      }),
    ]);

    expect(
      readStepCheckEvidence(JSON.parse(JSON.stringify(result.evidence)))?.facts,
    ).toEqual(result.evidence.facts);
    expect(isStepCheckFactMarkUnderLine(StepCheckFactMark.Exposed)).toBe(true);
    expect(isStepCheckFactMarkUnderLine(undefined)).toBe(true);
    expect(isStepCheckFactMarkUnderLine(StepCheckFactMark.NotDone)).toBe(false);
  });
});

// ---------- An inline policy, said by its document (#11377) ----------

describe("an inline policy the attack wrote is said by its document, never its name alone (#11377)", () => {
  const ROLE_INLINE: AccountChange = roleChange({
    kind: AccountChangeKind.Policy,
    objectName: "ci-deploy",
    policyDocuments: [
      '{"Version":"2012-10-17","Statement":{"Effect":"Allow","Action":"*","Resource":"*"}}',
    ],
    eventName: "PutRolePolicy",
    eventUid: "inline-1",
  });
  const USER_INLINE: AccountChange = change({
    ...AWS_KEY,
    kind: AccountChangeKind.Policy,
    objectId: "",
    objectName: "IAMReadAccess",
    policyDocuments: ROLE_INLINE.policyDocuments,
    eventName: "PutUserPolicy",
    eventUid: "inline-2",
  });
  const read: (
    item: AccountChange,
    facts: AccountChangeFacts,
  ) => SecurityCaseStepCheckSentence = (
    item: AccountChange,
    facts: AccountChangeFacts,
  ): SecurityCaseStepCheckSentence => {
    return decide([answer(item, { facts })]).evidence.facts[0]!;
  };

  test.each([
    [
      "a role's",
      ROLE_INLINE,
      CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_STILL,
      CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CHANGED,
      CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CONFIRM,
      CHECK_ACCOUNT_CHANGE_ROLE_POLICY_UNDONE,
    ],
    [
      "a user's",
      USER_INLINE,
      CHECK_ACCOUNT_CHANGE_INLINE_POLICY_STILL,
      CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CHANGED,
      CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CONFIRM,
      CHECK_ACCOUNT_CHANGE_POLICY_UNDONE,
    ],
  ])(
    "%s: still there and to confirm by its document, undone by it once it changed, and by its name once deleted",
    (
      _: string,
      item: AccountChange,
      still: string,
      changed: string,
      confirm: string,
      deleted: string,
    ) => {
      const values: Record<string, string> = {
        account: item.account,
        object: item.objectName,
        provider: "AWS",
      };

      expect(
        read(
          item,
          awsFacts(AccountChangeState.StillThere, {
            policyDocument: AccountChangePolicyDocument.Attack,
          }),
        ),
      ).toEqual({ template: still, values, mark: StepCheckFactMark.NotDone });
      expect(
        read(
          item,
          awsFacts(AccountChangeState.Undone, {
            policyDocument: AccountChangePolicyDocument.Changed,
          }),
        ),
      ).toEqual({ template: changed, values, mark: StepCheckFactMark.Done });
      // Deleted: the policy is simply gone, as any policy is.
      expect(read(item, awsFacts(AccountChangeState.Undone))).toEqual({
        template: deleted,
        values,
        mark: StepCheckFactMark.Done,
      });

      // Whatever OneUptime could not read or compare is to confirm, by its document.
      for (const facts of [
        NOT_GRANTED,
        awsFacts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
          policyDocument: AccountChangePolicyDocument.Earlier,
        }),
        awsFacts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
          policyDocument: AccountChangePolicyDocument.NotComparable,
        }),
      ]) {
        expect(read(item, facts)).toEqual({
          template: confirm,
          values,
          mark: StepCheckFactMark.Confirm,
        });
      }
    },
  );

  test("the user or role deleted took the policy with it, as for any change", () => {
    const gone: AccountChangeFacts = {
      provider: "AWS",
      state: AccountChangeState.Undone,
      isAccountGone: true,
    };

    expect(read(ROLE_INLINE, gone).template).toBe(
      CHECK_ACCOUNT_CHANGE_ROLE_GONE,
    );
    expect(read(USER_INLINE, gone).template).toBe(
      CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE,
    );
  });

  test("a managed policy, attached by its ARN, is still said by its name", () => {
    expect(
      read(ROLE_POLICY, awsFacts(AccountChangeState.StillThere)).template,
    ).toBe(CHECK_ACCOUNT_CHANGE_ROLE_POLICY_STILL);
    expect(
      describeAccountChange({
        change: change({
          ...USER_INLINE,
          objectId: "arn:aws:iam::aws:policy/AdministratorAccess",
          objectName: "AdministratorAccess",
          policyDocuments: [],
          eventName: "AttachUserPolicy",
        }),
        outcome: "Still" as never,
        facts: awsFacts(AccountChangeState.StillThere),
      }).template,
    ).toBe(CHECK_ACCOUNT_CHANGE_POLICY_STILL);
  });

  test("its document changed reads as undone: looks done, never checked", () => {
    const result: StepCheckResult = decide([
      answer(ROLE_INLINE, {
        facts: awsFacts(AccountChangeState.Undone, {
          policyDocument: AccountChangePolicyDocument.Changed,
        }),
      }),
    ]);

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence.template).toEqual(
      CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
    );
  });

  test("to confirm says why on its own line: no 'cannot tell which' line; refused, run the command again, linked to the connection", () => {
    const cannotTell: StepCheckResult = decide([
      answer(ROLE_INLINE, {
        facts: awsFacts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
          policyDocument: AccountChangePolicyDocument.Earlier,
        }),
        reader: { connectionId: CONNECTION_ID, isChecking: true },
      }),
    ]);

    expect(templates(cannotTell.evidence.facts)).toEqual([
      CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CONFIRM,
    ]);
    expect(templates(cannotTell.evidence.facts)).not.toContain(
      CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
    );

    // A connection set up before the document reads: AWS refused them.
    const refused: StepCheckResult = decide([
      answer(USER_INLINE, {
        facts: {
          ...awsFacts(AccountChangeState.Unknown),
          reason: AccountChangeUnknownReason.NotGranted,
        },
        reader: { connectionId: CONNECTION_ID, isChecking: true },
      }),
    ]);

    expect(refused.evidence.facts).toEqual([
      {
        template: CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CONFIRM,
        values: {
          account: "deploy-bot",
          object: "IAMReadAccess",
          provider: "AWS",
        },
        mark: StepCheckFactMark.Confirm,
      },
      {
        template: CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
        values: { cloudAccount: AWS_ACCOUNT },
        mark: StepCheckFactMark.HowToCheck,
        link: {
          kind: ResponseLinkKind.OpenCloudConnection,
          connectionId: CONNECTION_ID,
        },
      },
    ]);
  });
});
