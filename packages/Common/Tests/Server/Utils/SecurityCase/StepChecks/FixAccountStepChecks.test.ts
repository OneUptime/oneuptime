import { AccountFixReading } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AccountFixState";
import {
  FIX_MFA_MAX_ACCOUNTS,
  FixCredentialsStepCheck,
  FixMfaStepCheck,
  getCaseAccounts,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/FixAccountStepChecks";
import { settleStepCheck } from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import { StepCheckResult } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import { AccountFixFacts } from "../../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  CHECK_COULD_NOT_CHECK,
  CHECK_FACT_NO_ACCOUNT,
  CHECK_FIX_FACT_MFA_OFF,
  CHECK_FIX_FACT_MFA_ON,
  CHECK_FIX_MFA_ALL,
  CHECK_FIX_MFA_MISSING,
  CHECK_FIX_PASSWORD_GOOGLE_CANNOT_TELL,
  CHECK_FIX_PASSWORD_NOT_RESET,
  CHECK_FIX_PASSWORD_RESET,
  CHECK_FIX_PASSWORD_SESSIONS_OPEN,
  CHECK_PRODUCT_READ_FAILED,
  CHECK_PRODUCT_SAID,
  CHECK_USER_NOT_FOUND,
  CHECK_USER_NO_CONNECTION,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  FakeEvidence,
  RecordingEvidence,
  at,
  context,
  fakeEvidence,
  planStep,
  previousCheck,
  stepTarget,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * The Fix steps about accounts (#10347), read back from the identity
 * products: "Reset alice@acme.com's password, and revoke their keys and
 * tokens" is checked once Okta or Microsoft Entra ID says the password
 * changed and the sessions ended after the case opened; Google Workspace
 * cannot say when a password changed, and says so. "Make sure the accounts
 * it went after use MFA" names the accounts still without one; with MFA on
 * all of them it looks done, a person confirming the lockout no product
 * can read. A product that cannot be read is never "not done", nor done.
 */

const USER: string = "alice@acme.com";
const CREDENTIALS_KEY: string = "fix:credentials";
const MFA_KEY: string = "fix:brute-force";
// The case opened at minute 2.
const OPENED: Date = at(2);

function okta(facts: Partial<AccountFixFacts> = {}): AccountFixFacts {
  return {
    provider: "Okta",
    canTellPassword: true,
    passwordChangedAt: at(30),
    sessionsEndedAt: at(31),
    hasMfa: null,
    url: "https://acme-admin.okta.com/admin/user/profile/view/00u1",
    ...facts,
  };
}

function entra(facts: Partial<AccountFixFacts> = {}): AccountFixFacts {
  return {
    provider: "Microsoft Entra ID",
    canTellPassword: true,
    passwordChangedAt: at(30),
    sessionsEndedAt: at(30),
    hasMfa: null,
    ...facts,
  };
}

function google(facts: Partial<AccountFixFacts> = {}): AccountFixFacts {
  return {
    provider: "Google Workspace",
    canTellPassword: false,
    passwordChangedAt: null,
    sessionsEndedAt: null,
    hasMfa: null,
    url: "https://admin.google.com/ac/users/1",
    ...facts,
  };
}

function reading(
  ...answers: Array<AccountFixFacts | null | string>
): AccountFixReading {
  return {
    answers: answers.map(
      (answer: AccountFixFacts | null | string, index: number) => {
        if (typeof answer === "string") {
          return { provider: `Product ${index}`, error: answer };
        }

        return {
          provider: answer?.provider || `Product ${index}`,
          facts: answer,
        };
      },
    ),
  };
}

async function credentials(data: {
  evidence: FakeEvidence;
  value?: string;
}): Promise<{ result: StepCheckResult | null; recorded: RecordingEvidence }> {
  const recorded: RecordingEvidence = fakeEvidence(data.evidence);
  const result: StepCheckResult | null = await FixCredentialsStepCheck.check(
    context({
      target: stepTarget({
        step: planStep(CREDENTIALS_KEY, data.value ?? USER),
      }),
      evidence: recorded.evidence,
      minute: 60,
    }),
  );

  return { result, recorded };
}

async function credentialsResult(
  evidence: FakeEvidence,
): Promise<StepCheckResult> {
  return (await credentials({ evidence })).result!;
}

describe("reset the password and revoke the tokens", () => {
  test("Okta: the password changed and every session was cleared after the case opened, so it is checked", async () => {
    const { result, recorded } = await credentials({
      evidence: { credentials: reading(okta()) },
    });

    expect(result!.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result!.evidence.sentence).toEqual({
      template: CHECK_FIX_PASSWORD_RESET,
      values: { user: USER, provider: "Okta" },
      times: { time: at(30).toISOString(), ended: at(31).toISOString() },
    });
    expect(result!.evidence.links).toEqual([
      {
        kind: ResponseLinkKind.OpenProvider,
        provider: "Okta",
        url: "https://acme-admin.okta.com/admin/user/profile/view/00u1",
      },
    ]);
    // Asked about the account, since the case opened.
    expect(recorded.reads).toEqual([
      {
        reader: "readAccountCredentials",
        asked: { user: USER, since: OPENED },
      },
    ]);
  });

  test("Microsoft Entra ID: a new password and its refresh tokens revoked, both after the case opened", async () => {
    expect(
      (await credentialsResult({ credentials: reading(entra()) })).state,
    ).toBe(SecurityCaseStepCheckState.Verified);
  });

  test("the password changed but the sessions were not ended: not done, and says which", async () => {
    const result: StepCheckResult = await credentialsResult({
      credentials: reading(entra({ sessionsEndedAt: at(-500) })),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_PASSWORD_SESSIONS_OPEN,
      values: { user: USER, provider: "Microsoft Entra ID" },
      times: { time: at(30).toISOString() },
    });

    // Okta, whose System Log says no session was cleared since.
    expect(
      (
        await credentialsResult({
          credentials: reading(okta({ sessionsEndedAt: null })),
        })
      ).evidence.sentence.template,
    ).toBe(CHECK_FIX_PASSWORD_SESSIONS_OPEN);
  });

  test("the password last changed before the case opened, or never: not reset", async () => {
    for (const changed of [at(-60), null]) {
      const result: StepCheckResult = await credentialsResult({
        credentials: reading(okta({ passwordChangedAt: changed })),
      });

      expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
      expect(result.evidence.sentence).toEqual({
        template: CHECK_FIX_PASSWORD_NOT_RESET,
        values: { user: USER, provider: "Okta" },
      });
    }
  });

  test("one product that says it is not reset is enough, whatever the others say", async () => {
    const result: StepCheckResult = await credentialsResult({
      credentials: reading(
        okta(),
        entra({ passwordChangedAt: at(-60) }),
        "Graph timed out",
      ),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence.values["provider"]).toBe(
      "Microsoft Entra ID",
    );
  });

  test("Google Workspace cannot say when a password changed: cannot tell, and says so", async () => {
    const result: StepCheckResult = await credentialsResult({
      credentials: reading(google()),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_PASSWORD_GOOGLE_CANNOT_TELL,
      values: { user: USER },
    });
    expect(result.evidence.docsPath).toBe(
      "/telemetry/security-cases#how-oneuptime-checks-a-step",
    );

    // Beside a product that can tell, Google's silence is said, not counted.
    const both: StepCheckResult = await credentialsResult({
      credentials: reading(google(), okta()),
    });

    expect(both.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(both.evidence.facts).toEqual([
      {
        template: CHECK_FIX_PASSWORD_GOOGLE_CANNOT_TELL,
        values: { user: USER },
      },
    ]);
  });

  test("a product that could not be read may be the one where it is not reset: cannot tell, and tries again soon", async () => {
    const result: StepCheckResult = await credentialsResult({
      credentials: reading(okta(), "Okta System Log events request failed"),
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_PRODUCT_READ_FAILED,
      values: { value: USER, provider: "Product 1" },
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_PRODUCT_SAID,
        values: {
          provider: "Product 1",
          error: "Okta System Log events request failed",
        },
      },
    ]);
    expect(result.evidence.data["readFailed"]).toBe(true);
    expect(result.recheckInMinutes).toBe(5);
  });

  test("no connection to an identity product, or the account in none of them: cannot tell", async () => {
    const none: StepCheckResult = await credentialsResult({
      credentials: { answers: [] },
    });

    expect(none.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(none.evidence.sentence).toEqual({
      template: CHECK_USER_NO_CONNECTION,
      values: { user: USER },
    });

    const missing: StepCheckResult = await credentialsResult({
      credentials: {
        answers: [
          { provider: "Okta", facts: null },
          { provider: "Microsoft Entra ID", facts: null },
        ],
      },
    });

    expect(missing.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(missing.evidence.sentence).toEqual({
      template: CHECK_USER_NOT_FOUND,
      values: { user: USER },
    });
    expect(missing.evidence.facts).toEqual([
      {
        template: CHECK_FACT_NO_ACCOUNT,
        values: { provider: "Okta", value: USER },
      },
      {
        template: CHECK_FACT_NO_ACCOUNT,
        values: { provider: "Microsoft Entra ID", value: USER },
      },
    ]);
  });

  test("a read that threw is never done; a step about no account is a person's", async () => {
    const failed: StepCheckResult = await credentialsResult({
      failing: ["readAccountCredentials"],
    });

    expect(failed.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(failed.evidence.sentence.template).toBe(CHECK_COULD_NOT_CHECK);
    expect((await credentials({ evidence: {}, value: "" })).result).toBeNull();
  });
});

// ---------- MFA ----------

const BOB: string = "bob@acme.com";
const EVE: string = "eve@acme.com";

async function mfa(data: {
  evidence: FakeEvidence;
  users?: Array<string>;
  previous?: ReturnType<typeof previousCheck> | null;
  minute?: number;
}): Promise<StepCheckResult | null> {
  return await FixMfaStepCheck.check(
    context({
      target: stepTarget({
        step: planStep(MFA_KEY),
        previous: data.previous || null,
      }),
      evidence: fakeEvidence(data.evidence).evidence,
      minute: data.minute ?? 60,
      securityCase: {
        entities: (data.users ?? [USER, BOB]).map(
          (user: string): SecurityEntity => {
            return { type: SecurityEntityType.User, value: user };
          },
        ),
      },
    }),
  );
}

describe("MFA on the accounts it went after", () => {
  test("every account has MFA: looks done, never verified - no product says whether failed sign-ins are locked out", async () => {
    const result: StepCheckResult = (await mfa({
      evidence: {
        mfa: {
          [USER]: reading(okta({ hasMfa: true })),
          [BOB]: reading(entra({ hasMfa: true })),
        },
      },
    }))!;

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_MFA_ALL,
      values: {},
      count: 2,
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_FIX_FACT_MFA_ON,
        values: { user: USER, provider: "Okta" },
      },
      {
        template: CHECK_FIX_FACT_MFA_ON,
        values: { user: BOB, provider: "Microsoft Entra ID" },
      },
    ]);
  });

  test("some without MFA: not done, and the evidence names each of them", async () => {
    const result: StepCheckResult = (await mfa({
      users: [USER, BOB, EVE],
      evidence: {
        mfa: {
          [USER]: reading(okta({ hasMfa: true })),
          [BOB]: reading(okta({ hasMfa: false })),
          [EVE]: reading(google({ hasMfa: false })),
        },
      },
    }))!;

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_MFA_MISSING,
      values: { user: BOB },
      numbers: { total: 3 },
      count: 2,
    });
    expect(result.evidence.facts).toEqual([
      {
        template: CHECK_FIX_FACT_MFA_OFF,
        values: { user: BOB, provider: "Okta" },
      },
      {
        template: CHECK_FIX_FACT_MFA_OFF,
        values: { user: EVE, provider: "Google Workspace" },
      },
      {
        template: CHECK_FIX_FACT_MFA_ON,
        values: { user: USER, provider: "Okta" },
      },
    ]);
  });

  test("an account in two products needs MFA in both", async () => {
    const result: StepCheckResult = (await mfa({
      users: [USER],
      evidence: {
        mfa: {
          [USER]: reading(okta({ hasMfa: true }), entra({ hasMfa: false })),
        },
      },
    }))!;

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
  });

  test("a name no product has is no account to protect: a brute force tries names that do not exist", async () => {
    const result: StepCheckResult = (await mfa({
      evidence: {
        mfa: {
          [USER]: reading(okta({ hasMfa: true })),
          [BOB]: { answers: [{ provider: "Okta", facts: null }] },
        },
      },
    }))!;

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toMatchObject({ count: 1 });

    const nobody: StepCheckResult = (await mfa({
      evidence: {
        mfa: {
          [USER]: { answers: [{ provider: "Okta", facts: null }] },
          [BOB]: { answers: [{ provider: "Okta", facts: null }] },
        },
      },
    }))!;

    expect(nobody.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(nobody.evidence.sentence).toEqual({
      template: CHECK_USER_NOT_FOUND,
      values: { user: USER },
    });
  });

  test("MFA taken off an account after it looked done stops it holding, said once", async () => {
    const held: StepCheckResult = (await mfa({
      evidence: {
        mfa: {
          [USER]: reading(okta({ hasMfa: true })),
          [BOB]: reading(okta({ hasMfa: true })),
        },
      },
    }))!;
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: MFA_KEY,
      state: held.state,
      evidence: held.evidence,
      stateSince: at(60),
    });
    const lost: FakeEvidence = {
      mfa: {
        [USER]: reading(okta({ hasMfa: true })),
        [BOB]: reading(okta({ hasMfa: false })),
      },
    };
    const regressed: StepCheckResult = (await mfa({
      previous,
      evidence: lost,
      minute: 90,
    }))!;

    expect(regressed.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(regressed.evidence.data["regressedAt"]).toBe(at(90).toISOString());
    expect(
      settleStepCheck({
        previous,
        result: regressed,
        now: at(90),
        intervalInMinutes: 15,
      }).isNewRegression,
    ).toBe(true);

    const again: StepCheckResult = (await mfa({
      previous: previousCheck({
        stepKey: MFA_KEY,
        state: regressed.state,
        evidence: regressed.evidence,
        stateSince: at(90),
      }),
      evidence: lost,
      minute: 120,
    }))!;

    expect(again.evidence.data["regressedAt"]).toBe(at(90).toISOString());
  });

  test("a product that could not be read is never no MFA, nor MFA", async () => {
    const result: StepCheckResult = (await mfa({
      evidence: {
        mfa: {
          [USER]: reading(okta({ hasMfa: true })),
          [BOB]: reading(
            "The connection's app registration needs the Microsoft Graph application permission UserAuthenticationMethod.Read.All, with admin consent.",
          ),
        },
      },
    }))!;

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence.template).toBe(CHECK_PRODUCT_READ_FAILED);
    expect(result.evidence.facts[0]!.values["error"]).toContain(
      "UserAuthenticationMethod.Read.All",
    );
    expect(result.evidence.data["readFailed"]).toBe(true);

    const threw: StepCheckResult = (await mfa({
      evidence: { failing: ["readAccountMfa"] },
    }))!;

    expect(threw.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(threw.evidence.sentence.template).toBe(CHECK_COULD_NOT_CHECK);
  });

  test("no identity product connected: cannot tell, with how to let OneUptime check", async () => {
    const result: StepCheckResult = (await mfa({ evidence: {} }))!;

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_USER_NO_CONNECTION,
      values: { user: USER },
    });
    expect(result.evidence.docsPath).toBeDefined();
  });

  test("the case's accounts, each once and at most ten; a case that names none is a person's", async () => {
    expect(
      getCaseAccounts([
        { type: SecurityEntityType.User, value: USER },
        { type: SecurityEntityType.User, value: "Alice@Acme.com" },
        { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
        { type: SecurityEntityType.User, value: " " },
        { type: SecurityEntityType.User, value: BOB },
      ]),
    ).toEqual([USER, BOB]);
    expect(
      getCaseAccounts(
        Array.from({ length: 15 }, (_value: unknown, index: number) => {
          return {
            type: SecurityEntityType.User,
            value: `user${index}@acme.com`,
          };
        }),
      ),
    ).toHaveLength(FIX_MFA_MAX_ACCOUNTS);
    expect(await mfa({ evidence: {}, users: [] })).toBeNull();
  });
});
