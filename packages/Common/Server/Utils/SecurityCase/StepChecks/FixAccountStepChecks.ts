import {
  ResponseLink,
  ResponseLinkKind,
} from "../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseStepCheckSentence,
  readStepCheckDataTime,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState, {
  isStepCheckHolding,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
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
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { AccountFixFacts } from "../../SecurityPlaybook/SecurityPlaybookContainment";
import {
  AccountFixReading,
  AccountProductAnswer,
} from "./Evidence/AccountFixState";
import {
  STEP_CHECK_DOCS_PATH,
  StepCheck,
  StepCheckContext,
  StepCheckResult,
  StepCheckTarget,
  evidenceOf,
  isStillRegressed,
  sentence,
} from "./StepCheck";

/*
 * THE FIX STEPS ABOUT ACCOUNTS (#10347), read back from the identity
 * products the project is connected to - Okta, Microsoft Entra ID, Google
 * Workspace - whoever did them: a playbook, an admin in the product, the
 * account's owner.
 *
 * "Reset the password and revoke the tokens" (fix:credentials):
 *   Verified    every product that has the account says its password
 *               changed after the case opened, and its sessions and tokens
 *               were ended after it too: Okta's passwordChanged and the
 *               System Log's user.session.clear, Entra ID's
 *               lastPasswordChangeDateTime and signInSessionsValidFromDateTime;
 *   Not Done    one of them says the password has not changed since, or it
 *               changed and the sessions were not ended;
 *   Cannot Tell Google Workspace alone has the account (its Directory API
 *               says nothing of when a password changed), no product has
 *               it, the project has no such connection, or one could not
 *               be read.
 *
 * "MFA on the accounts the attack went after, and lock out repeated failed
 * sign-ins" (fix:brute-force):
 *   Looks Done  every account a product has can sign in with a second
 *               factor: an active Okta factor, an Entra ID MFA method, Google
 *               2-Step Verification. An account no product has is no account
 *               to protect: a brute force tries names that do not exist.
 *               Never Verified: no product's read says whether repeated
 *               failed sign-ins are locked out, so a person confirms it;
 *   Not Done    some have none, and the evidence names them;
 *   Regressed   they all had one, and one of them has none any more;
 *   Cannot Tell no product has any of them, the project has no such
 *               connection, or one could not be read.
 */

// The most accounts the MFA step reads: a brute force tries many names.
export const FIX_MFA_MAX_ACCOUNTS: number = 10;

function providerLink(facts: AccountFixFacts): ResponseLink | null {
  return facts.url
    ? {
        kind: ResponseLinkKind.OpenProvider,
        provider: facts.provider,
        url: facts.url,
      }
    : null;
}

function foundFacts(reading: AccountFixReading): Array<AccountFixFacts> {
  return reading.answers
    .map((answer: AccountProductAnswer): AccountFixFacts | null => {
      return answer.facts || null;
    })
    .filter((facts: AccountFixFacts | null): facts is AccountFixFacts => {
      return facts !== null;
    });
}

function failedAnswers(
  reading: AccountFixReading,
): Array<AccountProductAnswer> {
  return reading.answers.filter((answer: AccountProductAnswer): boolean => {
    return Boolean(answer.error);
  });
}

// A product that could not be read may be the one that says "not done".
function readFailedResult(data: {
  value: string;
  failed: Array<AccountProductAnswer>;
}): StepCheckResult {
  return {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: evidenceOf({
      sentence: sentence(CHECK_PRODUCT_READ_FAILED, {
        value: data.value,
        provider: data.failed[0]?.provider || "",
      }),
      facts: data.failed.map(
        (failure: AccountProductAnswer): SecurityCaseStepCheckSentence => {
          return sentence(CHECK_PRODUCT_SAID, {
            provider: failure.provider,
            error: failure.error || "",
          });
        },
      ),
      data: { readFailed: true, provider: data.failed[0]?.provider || "" },
    }),
    recheckInMinutes: 5,
  };
}

function noConnection(user: string): StepCheckResult {
  return {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: evidenceOf({
      sentence: sentence(CHECK_USER_NO_CONNECTION, { user }),
      docsPath: STEP_CHECK_DOCS_PATH,
      data: { reason: "NoConnection" },
    }),
  };
}

function notFound(data: {
  user: string;
  answers: Array<AccountProductAnswer>;
}): StepCheckResult {
  return {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: evidenceOf({
      sentence: sentence(CHECK_USER_NOT_FOUND, { user: data.user }),
      facts: data.answers.map(
        (answer: AccountProductAnswer): SecurityCaseStepCheckSentence => {
          return sentence(CHECK_FACT_NO_ACCOUNT, {
            provider: answer.provider,
            value: data.user,
          });
        },
      ),
      data: { reason: "NotFound" },
    }),
  };
}

function isAfter(moment: Date | null, since: Date): boolean {
  return Boolean(moment && moment.getTime() >= since.getTime());
}

// ---------- Reset the password (fix:credentials) ----------

export interface CredentialsInput {
  user: string;
  caseOpenedAt: Date;
  reading: AccountFixReading;
}

export function decideCredentials(input: CredentialsInput): StepCheckResult {
  const { user, caseOpenedAt, reading } = input;

  if (reading.answers.length === 0) {
    return noConnection(user);
  }

  const found: Array<AccountFixFacts> = foundFacts(reading);
  const tellable: Array<AccountFixFacts> = found.filter(
    (facts: AccountFixFacts): boolean => {
      return facts.canTellPassword;
    },
  );
  const links: Array<ResponseLink | null> = found.map(providerLink);
  const notReset: AccountFixFacts | undefined = tellable.find(
    (facts: AccountFixFacts): boolean => {
      return !isAfter(facts.passwordChangedAt, caseOpenedAt);
    },
  );

  if (notReset) {
    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(CHECK_FIX_PASSWORD_NOT_RESET, {
          user,
          provider: notReset.provider,
        }),
        links,
        data: {
          provider: notReset.provider,
          passwordChangedAt: notReset.passwordChangedAt,
        },
      }),
    };
  }

  const sessionsOpen: AccountFixFacts | undefined = tellable.find(
    (facts: AccountFixFacts): boolean => {
      return !isAfter(facts.sessionsEndedAt, caseOpenedAt);
    },
  );

  if (sessionsOpen) {
    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(
          CHECK_FIX_PASSWORD_SESSIONS_OPEN,
          { user, provider: sessionsOpen.provider },
          { times: { time: sessionsOpen.passwordChangedAt } },
        ),
        links,
        data: {
          provider: sessionsOpen.provider,
          passwordChangedAt: sessionsOpen.passwordChangedAt,
        },
      }),
    };
  }

  const failed: Array<AccountProductAnswer> = failedAnswers(reading);

  if (failed.length > 0) {
    return readFailedResult({ value: user, failed });
  }

  const cannotTell: Array<AccountFixFacts> = found.filter(
    (facts: AccountFixFacts): boolean => {
      return !facts.canTellPassword;
    },
  );

  if (tellable.length > 0) {
    const reset: (facts: AccountFixFacts) => SecurityCaseStepCheckSentence = (
      facts: AccountFixFacts,
    ): SecurityCaseStepCheckSentence => {
      return sentence(
        CHECK_FIX_PASSWORD_RESET,
        { user, provider: facts.provider },
        {
          times: {
            time: facts.passwordChangedAt,
            ended: facts.sessionsEndedAt,
          },
        },
      );
    };
    const first: AccountFixFacts = tellable[0]!;

    return {
      state: SecurityCaseStepCheckState.Verified,
      evidence: evidenceOf({
        sentence: reset(first),
        facts: [
          ...tellable.slice(1).map(reset),
          ...cannotTell.map((): SecurityCaseStepCheckSentence => {
            return sentence(CHECK_FIX_PASSWORD_GOOGLE_CANNOT_TELL, { user });
          }),
        ],
        links,
        data: {
          provider: first.provider,
          passwordChangedAt: first.passwordChangedAt,
          sessionsEndedAt: first.sessionsEndedAt,
          doneSince: first.passwordChangedAt,
        },
      }),
    };
  }

  if (cannotTell.length > 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_FIX_PASSWORD_GOOGLE_CANNOT_TELL, { user }),
        links,
        docsPath: STEP_CHECK_DOCS_PATH,
        data: { reason: "PasswordTimeUnknown" },
      }),
    };
  }

  return notFound({ user, answers: reading.answers });
}

export const FixCredentialsStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.fixCredentials,
  // A product's API, not the app's own data: asked less often.
  intervalInMinutes: 15,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    // The account the plan names; a step about none is a person's.
    const user: string = context.target.value;

    if (!user) {
      return null;
    }

    let reading: AccountFixReading;

    try {
      reading = await context.evidence.readAccountCredentials({
        user,
        since: context.securityCase.createdAt,
      });
    } catch {
      return {
        state: SecurityCaseStepCheckState.CannotTell,
        evidence: evidenceOf({
          sentence: sentence(CHECK_COULD_NOT_CHECK),
          data: { readFailed: true },
        }),
        recheckInMinutes: 5,
      };
    }

    return decideCredentials({
      user,
      caseOpenedAt: context.securityCase.createdAt,
      reading,
    });
  },
};

// ---------- MFA on the accounts it went after (fix:brute-force) ----------

// What one account's products say of its MFA.
export interface AccountMfaInput {
  user: string;
  // Null when the reading itself failed.
  reading: AccountFixReading | null;
}

export interface MfaInput {
  accounts: Array<AccountMfaInput>;
  now: Date;
  target: StepCheckTarget;
}

// The accounts a step about MFA is about: the case's users, each once.
export function getCaseAccounts(
  entities: Array<SecurityEntity>,
): Array<string> {
  const accounts: Array<string> = [];

  for (const entity of entities) {
    const value: string = entity.value.trim();

    if (
      entity.type === SecurityEntityType.User &&
      value &&
      !accounts.some((account: string): boolean => {
        return account.toLowerCase() === value.toLowerCase();
      })
    ) {
      accounts.push(value);
    }
  }

  return accounts.slice(0, FIX_MFA_MAX_ACCOUNTS);
}

export function decideMfa(input: MfaInput): StepCheckResult {
  const firstUser: string = input.accounts[0]?.user || "";

  if (
    input.accounts.every((account: AccountMfaInput): boolean => {
      return account.reading !== null && account.reading.answers.length === 0;
    })
  ) {
    return noConnection(firstUser);
  }

  const withMfa: Array<{ user: string; facts: AccountFixFacts }> = [];
  const without: Array<{ user: string; facts: AccountFixFacts }> = [];
  const failed: Array<{ user: string; answers: Array<AccountProductAnswer> }> =
    [];
  const links: Array<ResponseLink | null> = [];

  for (const account of input.accounts) {
    if (!account.reading) {
      failed.push({
        user: account.user,
        answers: [{ provider: "", error: "" }],
      });
      continue;
    }

    const found: Array<AccountFixFacts> = foundFacts(account.reading);
    const off: AccountFixFacts | undefined = found.find(
      (facts: AccountFixFacts): boolean => {
        return facts.hasMfa === false;
      },
    );

    links.push(...found.map(providerLink));

    if (off) {
      without.push({ user: account.user, facts: off });
    } else if (failedAnswers(account.reading).length > 0) {
      failed.push({
        user: account.user,
        answers: failedAnswers(account.reading),
      });
    } else if (found.length > 0) {
      withMfa.push({ user: account.user, facts: found[0]! });
    }
  }

  const facts: Array<SecurityCaseStepCheckSentence> = [
    ...without.map(
      (account: {
        user: string;
        facts: AccountFixFacts;
      }): SecurityCaseStepCheckSentence => {
        return sentence(CHECK_FIX_FACT_MFA_OFF, {
          user: account.user,
          provider: account.facts.provider,
        });
      },
    ),
    ...withMfa.map(
      (account: {
        user: string;
        facts: AccountFixFacts;
      }): SecurityCaseStepCheckSentence => {
        return sentence(CHECK_FIX_FACT_MFA_ON, {
          user: account.user,
          provider: account.facts.provider,
        });
      },
    ),
  ];

  if (without.length > 0) {
    const line: SecurityCaseStepCheckSentence = sentence(
      CHECK_FIX_MFA_MISSING,
      { user: without[0]!.user },
      {
        numbers: { total: without.length + withMfa.length },
        count: without.length,
      },
    );
    const wasHolding: boolean =
      Boolean(
        input.target.previous &&
          isStepCheckHolding(input.target.previous.state),
      ) || isStillRegressed(input.target);

    if (wasHolding) {
      const regressedAt: Date =
        (isStillRegressed(input.target)
          ? readStepCheckDataTime(
              input.target.previous?.evidence.data,
              "regressedAt",
            )
          : null) || input.now;

      return {
        state: SecurityCaseStepCheckState.Regressed,
        evidence: evidenceOf({
          sentence: line,
          facts,
          links,
          data: { regressedAt, without: without.length },
        }),
      };
    }

    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: line,
        facts,
        links,
        data: { without: without.length, with: withMfa.length },
      }),
    };
  }

  if (failed.length > 0) {
    const answers: Array<AccountProductAnswer> = failed.flatMap(
      (account: {
        user: string;
        answers: Array<AccountProductAnswer>;
      }): Array<AccountProductAnswer> => {
        return account.answers.filter(
          (answer: AccountProductAnswer): boolean => {
            return Boolean(answer.provider);
          },
        );
      },
    );

    if (answers.length === 0) {
      return {
        state: SecurityCaseStepCheckState.CannotTell,
        evidence: evidenceOf({
          sentence: sentence(CHECK_COULD_NOT_CHECK),
          data: { readFailed: true },
        }),
        recheckInMinutes: 5,
      };
    }

    return readFailedResult({ value: failed[0]!.user, failed: answers });
  }

  if (withMfa.length === 0) {
    return notFound({
      user: firstUser,
      answers: input.accounts[0]?.reading?.answers || [],
    });
  }

  /*
   * Looks done, never verified: the step also asks to lock out repeated
   * failed sign-ins, which no product's read says, so a person confirms it.
   */
  return {
    state: SecurityCaseStepCheckState.LooksDone,
    evidence: evidenceOf({
      sentence: sentence(CHECK_FIX_MFA_ALL, {}, { count: withMfa.length }),
      facts,
      links,
      data: {
        with: withMfa.length,
        // Since when it holds: kept while it holds.
        doneSince:
          (input.target.previous &&
          isStepCheckHolding(input.target.previous.state)
            ? readStepCheckDataTime(
                input.target.previous.evidence.data,
                "doneSince",
              )
            : null) || input.now,
      },
    }),
  };
}

export const FixMfaStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.fixBruteForce,
  /*
   * Hourly: an account's MFA changes rarely, and each read asks every
   * product about every account. A tick or a playbook checks it at once.
   */
  intervalInMinutes: 60,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    const users: Array<string> = getCaseAccounts(context.securityCase.entities);

    // A case that names no account has none to read.
    if (users.length === 0) {
      return null;
    }

    const accounts: Array<AccountMfaInput> = [];

    for (const user of users) {
      let reading: AccountFixReading | null;

      try {
        reading = await context.evidence.readAccountMfa(user);
      } catch {
        reading = null;
      }

      accounts.push({ user, reading });
    }

    return decideMfa({ accounts, now: context.now, target: context.target });
  },
};
