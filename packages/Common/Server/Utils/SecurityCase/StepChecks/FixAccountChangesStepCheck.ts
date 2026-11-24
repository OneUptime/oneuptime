import { SecurityCaseEventSnapshot } from "../../../../Types/SecurityCase/SecurityCaseEventEvidence";
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
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  getAttackAccountChanges,
} from "../../../../Utils/SecurityCase/AttackAccountChanges";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
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
  CHECK_ACCOUNT_CHANGE_ACCOUNT_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE,
  CHECK_ACCOUNT_CHANGE_ACCOUNT_STILL,
  CHECK_ACCOUNT_CHANGE_ACCOUNT_UNDONE,
  CHECK_ACCOUNT_CHANGE_APP_CONFIRM,
  CHECK_ACCOUNT_CHANGE_APP_STILL,
  CHECK_ACCOUNT_CHANGE_APP_UNDONE,
  CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
  CHECK_ACCOUNT_CHANGE_GROUP_STILL,
  CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
  CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_KEY_STILL,
  CHECK_ACCOUNT_CHANGE_KEY_UNDONE,
  CHECK_ACCOUNT_CHANGE_MFA_CONFIRM,
  CHECK_ACCOUNT_CHANGE_MFA_STILL,
  CHECK_ACCOUNT_CHANGE_MFA_UNDONE,
  CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ROLE_STILL,
  CHECK_ACCOUNT_CHANGE_ROLE_UNDONE,
  CHECK_COULD_NOT_CHECK,
  CHECK_PRODUCT_READ_FAILED,
  CHECK_PRODUCT_SAID,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  AccountChangeFacts,
  AccountChangeState,
  AccountChangeUnknownReason,
} from "../../SecurityPlaybook/AccountChangeReadBack";
import {
  AccountChangeAnswer,
  AccountChangesReading,
} from "./Evidence/AccountChangesState";
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
 * "UNDO WHAT CHANGED ON THE ACCOUNT THAT YOU DID NOT EXPECT: ROLES, KEYS AND
 * MFA DEVICES" (fix:account-changes, #10603): what the attack gave
 * accounts, read from the case's events - the ones its detections matched
 * and the ones kept on it (AttackAccountChanges) - and each read back in
 * the product it was made in (AccountChangeReadBack), whoever undid it: a
 * person in the product, a playbook, the account's owner.
 *
 *   Looks Done  each change OneUptime could read back is undone. Never
 *               Checked: a change made another way may not be in the case's
 *               events, and what it cannot read back - an AWS key, a Google
 *               Workspace group, a role a product does not tell apart - a
 *               person confirms, named one by one;
 *   Not Done    a change is still there, and the evidence names each;
 *   Regressed   they were all undone, and one is back;
 *   Cannot Tell the case's events record no change to an account, OneUptime
 *               can read none of them back (no connection to the product,
 *               AWS), or a product could not be read just now.
 */

export interface AccountChangesInput {
  changes: Array<AccountChange>;
  reading: AccountChangesReading;
  now: Date;
  target: StepCheckTarget;
}

// What one change's answer comes to.
enum ChangeOutcome {
  Still = "Still",
  Undone = "Undone",
  Confirm = "Confirm",
  Failed = "Failed",
}

interface ReadChange {
  change: AccountChange;
  outcome: ChangeOutcome;
  facts: AccountChangeFacts | null;
  error: string;
  hasConnection: boolean;
}

const STILL_SENTENCES: Record<AccountChangeKind, string> = {
  [AccountChangeKind.AdminRole]: CHECK_ACCOUNT_CHANGE_ROLE_STILL,
  [AccountChangeKind.Group]: CHECK_ACCOUNT_CHANGE_GROUP_STILL,
  [AccountChangeKind.App]: CHECK_ACCOUNT_CHANGE_APP_STILL,
  [AccountChangeKind.MfaDevice]: CHECK_ACCOUNT_CHANGE_MFA_STILL,
  [AccountChangeKind.Key]: CHECK_ACCOUNT_CHANGE_KEY_STILL,
  [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ACCOUNT_STILL,
};

const UNDONE_SENTENCES: Record<AccountChangeKind, string> = {
  [AccountChangeKind.AdminRole]: CHECK_ACCOUNT_CHANGE_ROLE_UNDONE,
  [AccountChangeKind.Group]: CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
  [AccountChangeKind.App]: CHECK_ACCOUNT_CHANGE_APP_UNDONE,
  [AccountChangeKind.MfaDevice]: CHECK_ACCOUNT_CHANGE_MFA_UNDONE,
  [AccountChangeKind.Key]: CHECK_ACCOUNT_CHANGE_KEY_UNDONE,
  [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ACCOUNT_UNDONE,
};

const CONFIRM_SENTENCES: Record<AccountChangeKind, string> = {
  [AccountChangeKind.AdminRole]: CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM,
  [AccountChangeKind.Group]: CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
  [AccountChangeKind.App]: CHECK_ACCOUNT_CHANGE_APP_CONFIRM,
  [AccountChangeKind.MfaDevice]: CHECK_ACCOUNT_CHANGE_MFA_CONFIRM,
  [AccountChangeKind.Key]: CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ACCOUNT_CONFIRM,
};

// The most accounts' pages the evidence links to.
const MAX_PROVIDER_LINKS: number = 5;

// What a change gave, as its sentence names it: its name, else its id.
function getObjectName(change: AccountChange): string {
  return change.objectName || change.objectId;
}

function readChange(answer: AccountChangeAnswer): ReadChange {
  const facts: AccountChangeFacts | null = answer.facts;
  let outcome: ChangeOutcome = ChangeOutcome.Confirm;

  if (facts?.state === AccountChangeState.StillThere) {
    outcome = ChangeOutcome.Still;
  } else if (answer.error) {
    // A product that could not be read may be the one that still has it.
    outcome = ChangeOutcome.Failed;
  } else if (facts?.state === AccountChangeState.Undone) {
    outcome = ChangeOutcome.Undone;
  }

  return {
    change: answer.change,
    outcome,
    facts,
    error: answer.error || "",
    hasConnection: answer.hasConnection,
  };
}

// A change as one line of the evidence.
export function describeAccountChange(
  item: Pick<ReadChange, "change" | "outcome" | "facts">,
): SecurityCaseStepCheckSentence {
  const values: Record<string, string> = {
    account: item.change.account,
    object: getObjectName(item.change),
    provider: item.change.provider,
  };

  if (item.outcome === ChangeOutcome.Still) {
    return sentence(STILL_SENTENCES[item.change.kind], values);
  }

  if (item.outcome === ChangeOutcome.Undone) {
    return sentence(
      item.facts?.isAccountGone && item.change.kind !== AccountChangeKind.Account
        ? CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE
        : UNDONE_SENTENCES[item.change.kind],
      values,
    );
  }

  return sentence(CONFIRM_SENTENCES[item.change.kind], values);
}

/*
 * Why OneUptime asks a person to confirm what it cannot read back, said
 * once a product (or an account, where the product cannot tell which).
 */
function confirmReasons(
  confirms: Array<ReadChange>,
): Array<SecurityCaseStepCheckSentence> {
  const reasons: Array<SecurityCaseStepCheckSentence> = [];
  const said: Set<string> = new Set();
  const once: (key: string, line: SecurityCaseStepCheckSentence) => void = (
    key: string,
    line: SecurityCaseStepCheckSentence,
  ): void => {
    if (!said.has(key)) {
      said.add(key);
      reasons.push(line);
    }
  };

  for (const item of confirms) {
    const provider: string = item.change.provider;

    if (item.change.provider === AccountChangeProvider.Aws) {
      once("aws", sentence(CHECK_ACCOUNT_CHANGES_FACT_AWS));
    } else if (!item.hasConnection) {
      once(
        `connection:${provider}`,
        sentence(CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION, { provider }),
      );
    } else if (
      item.facts?.reason === AccountChangeUnknownReason.CannotTellWhich
    ) {
      once(
        `which:${provider}:${item.change.account.toLowerCase()}`,
        sentence(CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH, {
          provider,
          account: item.change.account,
        }),
      );
    }
  }

  return reasons;
}

// The accounts' pages in their products, each once.
function providerLinks(items: Array<ReadChange>): Array<ResponseLink> {
  const links: Array<ResponseLink> = [];

  for (const item of items) {
    const url: string | undefined = item.facts?.url;

    if (
      url &&
      links.length < MAX_PROVIDER_LINKS &&
      !links.some((link: ResponseLink): boolean => {
        return link.kind === ResponseLinkKind.OpenProvider && link.url === url;
      })
    ) {
      links.push({
        kind: ResponseLinkKind.OpenProvider,
        provider: item.facts!.provider,
        url,
      });
    }
  }

  return links;
}

export function decideAccountChanges(
  input: AccountChangesInput,
): StepCheckResult {
  if (input.changes.length === 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_ACCOUNT_CHANGES_NONE_FOUND),
        docsPath: STEP_CHECK_DOCS_PATH,
        data: { reason: "NoChanges", changes: 0 },
      }),
    };
  }

  const read: Array<ReadChange> = input.reading.answers.map(readChange);
  const ofOutcome: (outcome: ChangeOutcome) => Array<ReadChange> = (
    outcome: ChangeOutcome,
  ): Array<ReadChange> => {
    return read.filter((item: ReadChange): boolean => {
      return item.outcome === outcome;
    });
  };
  const still: Array<ReadChange> = ofOutcome(ChangeOutcome.Still);
  const undone: Array<ReadChange> = ofOutcome(ChangeOutcome.Undone);
  const confirm: Array<ReadChange> = ofOutcome(ChangeOutcome.Confirm);
  const failed: Array<ReadChange> = ofOutcome(ChangeOutcome.Failed);
  const links: Array<ResponseLink> = providerLinks(read);
  const counts: Record<string, number> = {
    changes: read.length,
    stillThere: still.length,
    undone: undone.length,
    toConfirm: confirm.length,
  };

  if (still.length > 0) {
    const facts: Array<SecurityCaseStepCheckSentence> = [
      ...still,
      ...undone,
      ...confirm,
    ].map(describeAccountChange);
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
          sentence: sentence(
            CHECK_ACCOUNT_CHANGES_BACK,
            {},
            { count: still.length },
          ),
          facts,
          links,
          data: { ...counts, regressedAt },
        }),
      };
    }

    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(
          CHECK_ACCOUNT_CHANGES_STILL_THERE,
          {},
          { count: still.length },
        ),
        facts,
        links,
        data: counts,
      }),
    };
  }

  if (failed.length > 0) {
    const first: ReadChange = failed[0]!;

    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_PRODUCT_READ_FAILED, {
          value: first.change.account,
          provider: first.change.provider,
        }),
        facts: failed.map((item: ReadChange): SecurityCaseStepCheckSentence => {
          return sentence(CHECK_PRODUCT_SAID, {
            provider: item.change.provider,
            error: item.error,
          });
        }),
        data: { ...counts, readFailed: true, provider: first.change.provider },
      }),
      recheckInMinutes: 5,
    };
  }

  const confirmFacts: Array<SecurityCaseStepCheckSentence> = [
    ...confirm.map(describeAccountChange),
    ...confirmReasons(confirm),
  ];

  if (undone.length === 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(
          CHECK_ACCOUNT_CHANGES_CANNOT_READ,
          {},
          { count: confirm.length },
        ),
        facts: confirmFacts,
        links,
        docsPath: STEP_CHECK_DOCS_PATH,
        data: { ...counts, reason: "CannotReadBack" },
      }),
    };
  }

  /*
   * Looks done, never checked: a change made another way may not be in the
   * case's events, and what OneUptime cannot read back is a person's to
   * confirm, named one by one.
   */
  return {
    state: SecurityCaseStepCheckState.LooksDone,
    evidence: evidenceOf({
      sentence:
        confirm.length > 0
          ? sentence(
              CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
              {},
              { count: confirm.length },
            )
          : sentence(
              CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
              {},
              { count: undone.length },
            ),
      facts: [...confirmFacts, ...undone.map(describeAccountChange)],
      links,
      data: {
        ...counts,
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

const FixAccountChangesStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.fixAccountChanges,
  /*
   * Hourly: an account's roles and keys change rarely, and each read asks a
   * product about every change. A tick or a playbook checks it at once.
   */
  intervalInMinutes: 60,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    // Without the case's detections there is no telling what the attack changed.
    if (!context.securityCase.matches) {
      return {
        state: SecurityCaseStepCheckState.CannotTell,
        evidence: evidenceOf({
          sentence: sentence(CHECK_COULD_NOT_CHECK),
          data: { readFailed: true },
        }),
        recheckInMinutes: 5,
      };
    }

    try {
      const keptEvents: Array<SecurityCaseEventSnapshot> =
        await context.evidence.readKeptEvents();
      const changes: Array<AccountChange> = getAttackAccountChanges({
        matches: context.securityCase.matches,
        keptEvents,
      });
      const reading: AccountChangesReading =
        changes.length > 0
          ? await context.evidence.readAccountChanges(changes)
          : { answers: [] };

      return decideAccountChanges({
        changes,
        reading,
        now: context.now,
        target: context.target,
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
  },
};

export default FixAccountChangesStepCheck;
