import { SecurityCaseEventSnapshot } from "../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  ResponseLink,
  ResponseLinkKind,
} from "../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  STEP_CHECK_MAX_FACTS,
  SecurityCaseStepCheckSentence,
  StepCheckFactMark,
  isStepCheckFactMarkUnderLine,
  readStepCheckDataTime,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState, {
  isStepCheckHolding,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  AWS_IAM_INLINE_POLICY_CALLS,
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  AccountChangeSubject,
  getAttackAccountChanges,
} from "../../../../Utils/SecurityCase/AttackAccountChanges";
import {
  AWS_EVERY_ACCOUNT,
  AwsIdentityProviderReach,
  AwsTrustedIdentityProvider,
  isAwsIdentityProviderOpen,
} from "../../../../Utils/SecurityCase/AwsTrustPolicy";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
  CHECK_ACCOUNT_CHANGES_BACK,
  CHECK_ACCOUNT_CHANGES_CANNOT_READ,
  CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
  CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
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
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CHANGED,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_STILL,
  CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_KEY_STILL,
  CHECK_ACCOUNT_CHANGE_KEY_UNDONE,
  CHECK_ACCOUNT_CHANGE_MFA_CONFIRM,
  CHECK_ACCOUNT_CHANGE_MFA_STILL,
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
  CHECK_ACCOUNT_CHANGE_ROLE_UNDONE,
  CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT,
  CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNTS,
  CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT,
  CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
  CHECK_ACCOUNT_CHANGE_TRUST_STILL,
  CHECK_ACCOUNT_CHANGE_TRUST_UNDONE,
  CHECK_COULD_NOT_CHECK,
  CHECK_PRODUCT_READ_FAILED,
  CHECK_PRODUCT_SAID,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  AccountChangeFacts,
  AccountChangePolicyDocument,
  AccountChangeState,
  AccountChangeUnknownReason,
} from "../../SecurityPlaybook/AccountChangeReadBack";
import { GOOGLE_WORKSPACE_DIRECTORY_GROUP_MEMBER_SCOPE } from "../../SecurityEvent/Response/GoogleWorkspaceResponseClient";
import {
  AccountChangeAnswer,
  AccountChangeReader,
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
 *               events, and what it cannot read back - a change in a
 *               product it has no connection to, or one whose connection
 *               was not given the read (an AWS connection's Security case
 *               checks, #10900; a Google Workspace delegation's group
 *               member scope, #10901), a role a product does not tell
 *               apart - a person confirms, named one by one, with a line
 *               on how to let OneUptime read it;
 *   Not Done    a change is still there, and the evidence names each;
 *   Regressed   they were all undone, and one is back;
 *   Cannot Tell the case's events record no change to an account, OneUptime
 *               can read none of them back, or a product could not be read
 *               just now.
 *
 * Each line is marked by what it says (StepCheckFactMark): undone, still
 * there, to confirm, or how to let OneUptime read the rest. An IAM role's
 * change (#11038) is said as a role's, and a role still there or to
 * confirm is followed by a line naming the outside AWS accounts it
 * trusts, and one for each identity provider it lets in, with what its
 * conditions hold it to (#11378) - kept with its line, or left out with
 * it - one that lets in anyone marked as open. An inline policy the attack
 * wrote is said by its document, never its name alone (#11377). A line
 * that says what to change in OneUptime links to where it is changed: the
 * AWS connection's form, or Cloud → Connect to connect one (#11039); the
 * Google Workspace connection's form, or Security Events → Connections to
 * connect a product (#11376).
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
  // An AWS change's: the connection that reaches its account (#11039).
  reader?: AccountChangeReader | undefined;
  // Another product's: the Security Events connection that answered (#11376).
  connectionId?: string | undefined;
}

const STILL_SENTENCES: Record<AccountChangeKind, string> = {
  [AccountChangeKind.AdminRole]: CHECK_ACCOUNT_CHANGE_ROLE_STILL,
  [AccountChangeKind.Policy]: CHECK_ACCOUNT_CHANGE_POLICY_STILL,
  [AccountChangeKind.Password]: CHECK_ACCOUNT_CHANGE_PASSWORD_STILL,
  [AccountChangeKind.Group]: CHECK_ACCOUNT_CHANGE_GROUP_STILL,
  [AccountChangeKind.App]: CHECK_ACCOUNT_CHANGE_APP_STILL,
  [AccountChangeKind.MfaDevice]: CHECK_ACCOUNT_CHANGE_MFA_STILL,
  [AccountChangeKind.Key]: CHECK_ACCOUNT_CHANGE_KEY_STILL,
  [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ACCOUNT_STILL,
  // Only a role has a trust policy.
  [AccountChangeKind.Trust]: CHECK_ACCOUNT_CHANGE_TRUST_STILL,
};

const UNDONE_SENTENCES: Record<AccountChangeKind, string> = {
  [AccountChangeKind.AdminRole]: CHECK_ACCOUNT_CHANGE_ROLE_UNDONE,
  [AccountChangeKind.Policy]: CHECK_ACCOUNT_CHANGE_POLICY_UNDONE,
  [AccountChangeKind.Password]: CHECK_ACCOUNT_CHANGE_PASSWORD_UNDONE,
  [AccountChangeKind.Group]: CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
  [AccountChangeKind.App]: CHECK_ACCOUNT_CHANGE_APP_UNDONE,
  [AccountChangeKind.MfaDevice]: CHECK_ACCOUNT_CHANGE_MFA_UNDONE,
  [AccountChangeKind.Key]: CHECK_ACCOUNT_CHANGE_KEY_UNDONE,
  [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ACCOUNT_UNDONE,
  [AccountChangeKind.Trust]: CHECK_ACCOUNT_CHANGE_TRUST_UNDONE,
};

const CONFIRM_SENTENCES: Record<AccountChangeKind, string> = {
  [AccountChangeKind.AdminRole]: CHECK_ACCOUNT_CHANGE_ROLE_CONFIRM,
  [AccountChangeKind.Policy]: CHECK_ACCOUNT_CHANGE_POLICY_CONFIRM,
  [AccountChangeKind.Password]: CHECK_ACCOUNT_CHANGE_PASSWORD_CONFIRM,
  [AccountChangeKind.Group]: CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
  [AccountChangeKind.App]: CHECK_ACCOUNT_CHANGE_APP_CONFIRM,
  [AccountChangeKind.MfaDevice]: CHECK_ACCOUNT_CHANGE_MFA_CONFIRM,
  [AccountChangeKind.Key]: CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ACCOUNT_CONFIRM,
  [AccountChangeKind.Trust]: CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
};

/*
 * An IAM role's (#11038), by what the attack did to it: made it, set its
 * trust policy, gave it a policy. A role is said as one, never as an
 * account.
 */
const ROLE_SENTENCES: Record<
  ChangeOutcome.Still | ChangeOutcome.Undone | ChangeOutcome.Confirm,
  Partial<Record<AccountChangeKind, string>>
> = {
  [ChangeOutcome.Still]: {
    [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
    [AccountChangeKind.Trust]: CHECK_ACCOUNT_CHANGE_TRUST_STILL,
    [AccountChangeKind.Policy]: CHECK_ACCOUNT_CHANGE_ROLE_POLICY_STILL,
  },
  [ChangeOutcome.Undone]: {
    [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ROLE_MADE_UNDONE,
    [AccountChangeKind.Trust]: CHECK_ACCOUNT_CHANGE_TRUST_UNDONE,
    [AccountChangeKind.Policy]: CHECK_ACCOUNT_CHANGE_ROLE_POLICY_UNDONE,
  },
  [ChangeOutcome.Confirm]: {
    [AccountChangeKind.Account]: CHECK_ACCOUNT_CHANGE_ROLE_MADE_CONFIRM,
    [AccountChangeKind.Trust]: CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
    [AccountChangeKind.Policy]: CHECK_ACCOUNT_CHANGE_ROLE_POLICY_CONFIRM,
  },
};

function isRoleChange(change: AccountChange): boolean {
  return change.subject === AccountChangeSubject.Role;
}

/*
 * An inline policy the attack wrote to an IAM user or role (#11377), read
 * by its document: never said by its name alone, since a person who put
 * its old document back keeps the policy.
 */
export function isInlinePolicyChange(change: AccountChange): boolean {
  return (
    change.provider === AccountChangeProvider.Aws &&
    change.kind === AccountChangeKind.Policy &&
    AWS_IAM_INLINE_POLICY_CALLS.includes(change.eventName)
  );
}

// An inline policy's words (#11377), a role's or a user's, by what was read of it.
const INLINE_POLICY_SENTENCES: Record<
  ChangeOutcome.Still | ChangeOutcome.Undone | ChangeOutcome.Confirm,
  Record<AccountChangeSubject, string>
> = {
  [ChangeOutcome.Still]: {
    [AccountChangeSubject.Account]: CHECK_ACCOUNT_CHANGE_INLINE_POLICY_STILL,
    [AccountChangeSubject.Role]: CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_STILL,
  },
  // Undone with its document changed: one deleted says so as any policy does.
  [ChangeOutcome.Undone]: {
    [AccountChangeSubject.Account]: CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CHANGED,
    [AccountChangeSubject.Role]:
      CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CHANGED,
  },
  [ChangeOutcome.Confirm]: {
    [AccountChangeSubject.Account]: CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CONFIRM,
    [AccountChangeSubject.Role]:
      CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CONFIRM,
  },
};

/*
 * The words an inline policy is said in, or "" for those of any policy:
 * still there and to confirm always by its document, undone by it only
 * when its document changed - a policy deleted is just gone.
 */
function inlinePolicySentenceOf(
  item: Pick<ReadChange, "change" | "facts">,
  outcome: ChangeOutcome.Still | ChangeOutcome.Undone | ChangeOutcome.Confirm,
): string {
  if (!isInlinePolicyChange(item.change)) {
    return "";
  }

  if (
    outcome === ChangeOutcome.Undone &&
    item.facts?.policyDocument !== AccountChangePolicyDocument.Changed
  ) {
    return "";
  }

  return INLINE_POLICY_SENTENCES[outcome][item.change.subject];
}

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
    reader: answer.reader,
    connectionId: answer.connectionId,
  };
}

// The sentence a change is said in, by what was read of it: a role's as a role's (#11038).
function sentenceOf(
  change: AccountChange,
  outcome: ChangeOutcome.Still | ChangeOutcome.Undone | ChangeOutcome.Confirm,
): string {
  const forAccounts: Record<AccountChangeKind, string> =
    outcome === ChangeOutcome.Still
      ? STILL_SENTENCES
      : outcome === ChangeOutcome.Undone
        ? UNDONE_SENTENCES
        : CONFIRM_SENTENCES;

  return (
    (isRoleChange(change) ? ROLE_SENTENCES[outcome][change.kind] : "") ||
    forAccounts[change.kind]
  );
}

// A change as one line of the evidence, marked by what it says of the change.
export function describeAccountChange(
  item: Pick<ReadChange, "change" | "outcome" | "facts">,
): SecurityCaseStepCheckSentence {
  const values: Record<string, string> = {
    account: item.change.account,
    object: getObjectName(item.change),
    provider: item.change.provider,
  };

  if (item.outcome === ChangeOutcome.Still) {
    return sentence(
      inlinePolicySentenceOf(item, ChangeOutcome.Still) ||
        sentenceOf(item.change, ChangeOutcome.Still),
      values,
      { mark: StepCheckFactMark.NotDone },
    );
  }

  if (item.outcome === ChangeOutcome.Undone) {
    const isGone: boolean = Boolean(
      item.facts?.isAccountGone &&
        item.change.kind !== AccountChangeKind.Account,
    );

    return sentence(
      isGone
        ? isRoleChange(item.change)
          ? CHECK_ACCOUNT_CHANGE_ROLE_GONE
          : CHECK_ACCOUNT_CHANGE_ACCOUNT_GONE
        : inlinePolicySentenceOf(item, ChangeOutcome.Undone) ||
            sentenceOf(item.change, ChangeOutcome.Undone),
      values,
      { mark: StepCheckFactMark.Done },
    );
  }

  return sentence(
    inlinePolicySentenceOf(item, ChangeOutcome.Confirm) ||
      sentenceOf(item.change, ChangeOutcome.Confirm),
    values,
    { mark: StepCheckFactMark.Confirm },
  );
}

/*
 * Whom an IAM role trusts outside the account it is in, as its trust
 * policy says now (#11038): the line under a role still there, or one to
 * confirm, naming what a person checks. Unmarked - it says more of the
 * line above it - but for every AWS account, marked as open to anyone
 * (#11378), and none when the role trusts nobody outside.
 */
export function describeRoleTrust(
  item: Pick<ReadChange, "change" | "outcome" | "facts">,
): SecurityCaseStepCheckSentence | null {
  const trusted: Array<string> = item.facts?.trusted || [];

  if (
    !isRoleChange(item.change) ||
    trusted.length === 0 ||
    (item.outcome !== ChangeOutcome.Still &&
      item.outcome !== ChangeOutcome.Confirm)
  ) {
    return null;
  }

  const values: Record<string, string> = {
    account: item.change.account,
    cloudAccount: item.change.cloudAccountId,
    trusted: trusted[0]!,
  };

  // Anyone in AWS: a way in open to anyone, marked so (#11378).
  if (trusted.includes(AWS_EVERY_ACCOUNT)) {
    return sentence(
      CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT,
      { account: item.change.account },
      { mark: StepCheckFactMark.Exposed },
    );
  }

  return trusted.length === 1
    ? sentence(CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT, values)
    : sentence(CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNTS, values, {
        count: trusted.length,
      });
}

// The most identity providers named under one role, the open ones first.
export const ROLE_IDENTITY_PROVIDERS_MAX: number = 3;

/*
 * Whom a role lets in through an identity provider, as its trust policy
 * says now (#11378): a line for each under the role's, said as plainly as
 * the policy holds it - the tokens a claim's value lets in, a SAML
 * provider's sign-ins, or, marked as open, anyone with a token from it,
 * in any organization for a shared one. Only of a role still there or to
 * confirm, like whom it trusts outside its account; at most
 * ROLE_IDENTITY_PROVIDERS_MAX, the open ones never left out for a held
 * one.
 */
export function describeRoleIdentityProviders(
  item: Pick<ReadChange, "change" | "outcome" | "facts">,
): Array<SecurityCaseStepCheckSentence> {
  const providers: Array<AwsTrustedIdentityProvider> =
    item.facts?.providers || [];

  if (
    !isRoleChange(item.change) ||
    (item.outcome !== ChangeOutcome.Still &&
      item.outcome !== ChangeOutcome.Confirm)
  ) {
    return [];
  }

  return [
    ...providers.filter(isAwsIdentityProviderOpen),
    ...providers.filter((provider: AwsTrustedIdentityProvider): boolean => {
      return !isAwsIdentityProviderOpen(provider);
    }),
  ]
    .slice(0, ROLE_IDENTITY_PROVIDERS_MAX)
    .map(
      (provider: AwsTrustedIdentityProvider): SecurityCaseStepCheckSentence => {
        const values: Record<string, string> = {
          account: item.change.account,
          provider: provider.name,
          claim: provider.claim,
        };

        switch (provider.reach) {
          case AwsIdentityProviderReach.AnyOrganization:
            return sentence(
              CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
              values,
              { mark: StepCheckFactMark.Exposed },
            );
          case AwsIdentityProviderReach.Anyone:
            return sentence(CHECK_ACCOUNT_CHANGE_PROVIDER_ANYONE, values, {
              mark: StepCheckFactMark.Exposed,
            });
          case AwsIdentityProviderReach.SignedIn:
            return sentence(CHECK_ACCOUNT_CHANGE_PROVIDER_SAML, {
              account: item.change.account,
              provider: provider.name,
            });
          default:
            return provider.values.length > 1
              ? sentence(
                  CHECK_ACCOUNT_CHANGE_PROVIDER_HELD_TO_SEVERAL,
                  { ...values, value: provider.values[0]! },
                  { count: provider.values.length },
                )
              : sentence(CHECK_ACCOUNT_CHANGE_PROVIDER_HELD, {
                  ...values,
                  value: provider.values[0] || "",
                });
        }
      },
    );
}

/*
 * A change's lines: its own, then whom a role lets in under it - the
 * outside accounts it trusts, and the identity providers it lets in.
 */
export function describeAccountChangeLines(
  item: Pick<ReadChange, "change" | "outcome" | "facts">,
): Array<SecurityCaseStepCheckSentence> {
  const trust: SecurityCaseStepCheckSentence | null = describeRoleTrust(item);

  return [
    describeAccountChange(item),
    ...(trust ? [trust] : []),
    ...describeRoleIdentityProviders(item),
  ];
}

/*
 * Why OneUptime asks a person to confirm what it cannot read back, and how
 * to let it read it: said once a product, an AWS account, or an account a
 * product cannot tell about.
 *
 *   - no connection to the product, or - AWS - none that reads the account
 *     the change was made in: linked to where one is connected, Cloud →
 *     Connect (#11039) or Security Events → Connections (#11376);
 *   - a connection not given the read: an AWS connection whose Security
 *     case checks are off (#10900), or on with a command not run again
 *     since they grant more (#11038, #11377), linked to that connection's
 *     form (#11039); a Google Workspace delegation without the group
 *     member scope (#10901), linked to that connection's form under
 *     Security Events → Connections (#11376);
 *   - a product that says the account holds something of the kind, but
 *     not which - but for a role's trust policy, whose own line says what
 *     to confirm, and names whom it trusts, and an inline policy, whose
 *     own line says to confirm its document (#11377).
 */
export function confirmReasons(
  confirms: Array<
    Pick<
      ReadChange,
      "change" | "facts" | "hasConnection" | "reader" | "connectionId"
    >
  >,
): Array<SecurityCaseStepCheckSentence> {
  const reasons: Array<SecurityCaseStepCheckSentence> = [];
  const said: Set<string> = new Set();
  const once: (
    key: string,
    template: string,
    values?: Record<string, string>,
    link?: ResponseLink,
  ) => void = (
    key: string,
    template: string,
    values: Record<string, string> = {},
    link?: ResponseLink,
  ): void => {
    if (!said.has(key)) {
      said.add(key);
      reasons.push(
        sentence(template, values, {
          mark: StepCheckFactMark.HowToCheck,
          link,
        }),
      );
    }
  };

  for (const item of confirms) {
    const provider: string = item.change.provider;
    const isAws: boolean = provider === AccountChangeProvider.Aws;
    const cloudAccount: string = item.change.cloudAccountId;

    if (!item.hasConnection) {
      if (isAws && cloudAccount) {
        once(
          `aws-connection:${cloudAccount}`,
          CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
          { cloudAccount },
          { kind: ResponseLinkKind.OpenCloudConnection },
        );
      } else {
        // Where a connection to the product is made: AWS's under Cloud, the others' under Security Events.
        once(
          `connection:${provider}`,
          CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
          {
            provider,
          },
          isAws
            ? { kind: ResponseLinkKind.OpenCloudConnection }
            : { kind: ResponseLinkKind.OpenSecurityEventConnection },
        );
      }
    } else if (item.facts?.reason === AccountChangeUnknownReason.NotGranted) {
      if (isAws) {
        // The connection to edit, when the read names it; else Cloud → Connect.
        const link: ResponseLink = item.reader
          ? {
              kind: ResponseLinkKind.OpenCloudConnection,
              connectionId: item.reader.connectionId,
            }
          : { kind: ResponseLinkKind.OpenCloudConnection };

        if (item.reader?.isChecking) {
          once(
            `aws-run-again:${cloudAccount}`,
            CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
            { cloudAccount },
            link,
          );
        } else {
          once(
            `aws-grant:${cloudAccount}`,
            CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
            { cloudAccount },
            link,
          );
        }
      } else if (provider === AccountChangeProvider.GoogleWorkspace) {
        // The connection whose delegation lacks the scope, when its answer names it (#11376).
        once(
          "google-groups",
          CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
          { scope: GOOGLE_WORKSPACE_DIRECTORY_GROUP_MEMBER_SCOPE },
          item.connectionId
            ? {
                kind: ResponseLinkKind.OpenSecurityEventConnection,
                connectionId: item.connectionId,
              }
            : { kind: ResponseLinkKind.OpenSecurityEventConnection },
        );
      }
    } else if (
      item.facts?.reason === AccountChangeUnknownReason.CannotTellWhich &&
      item.change.kind !== AccountChangeKind.Trust &&
      !isInlinePolicyChange(item.change)
    ) {
      once(
        `which:${provider}:${item.change.subject}:${item.change.account.toLowerCase()}`,
        CHECK_ACCOUNT_CHANGES_FACT_CANNOT_TELL_WHICH,
        { provider, account: item.change.account },
      );
    }
  }

  return reasons;
}

/*
 * Lines as they go together: a marked line, and the ones under it that say
 * more of it - whom a role trusts (#11038), and whom it lets in, marked
 * when that is anyone (#11378).
 */
function linesTogether(
  facts: Array<SecurityCaseStepCheckSentence>,
): Array<Array<SecurityCaseStepCheckSentence>> {
  const together: Array<Array<SecurityCaseStepCheckSentence>> = [];

  for (const fact of facts) {
    const last: Array<SecurityCaseStepCheckSentence> | undefined =
      together[together.length - 1];

    if (isStepCheckFactMarkUnderLine(fact.mark) && last) {
      last.push(fact);
    } else {
      together.push([fact]);
    }
  }

  return together;
}

/*
 * The facts of the step, in the order the card draws them - what is still
 * there, what a person confirms and how to let OneUptime read it, what is
 * undone - and within the facts a check keeps: past it, the undone ones go
 * first, then those to confirm, never what is still there nor how to let
 * OneUptime read the rest. A line and the unmarked ones under it are kept,
 * or left out, together: never a role's trust without its role.
 */
export function orderAccountChangeFacts(groups: {
  still: Array<SecurityCaseStepCheckSentence>;
  confirm: Array<SecurityCaseStepCheckSentence>;
  howToCheck: Array<SecurityCaseStepCheckSentence>;
  undone: Array<SecurityCaseStepCheckSentence>;
}): Array<SecurityCaseStepCheckSentence> {
  let room: number = STEP_CHECK_MAX_FACTS;
  const take: (
    facts: Array<SecurityCaseStepCheckSentence>,
  ) => Array<SecurityCaseStepCheckSentence> = (
    facts: Array<SecurityCaseStepCheckSentence>,
  ): Array<SecurityCaseStepCheckSentence> => {
    const kept: Array<SecurityCaseStepCheckSentence> = [];

    for (const lines of linesTogether(facts)) {
      if (lines.length > room) {
        break;
      }

      kept.push(...lines);
      room -= lines.length;
    }

    return kept;
  };
  // Kept in this order of need.
  const still: Array<SecurityCaseStepCheckSentence> = take(groups.still);
  const howToCheck: Array<SecurityCaseStepCheckSentence> = take(
    groups.howToCheck,
  );
  const confirm: Array<SecurityCaseStepCheckSentence> = take(groups.confirm);
  const undone: Array<SecurityCaseStepCheckSentence> = take(groups.undone);

  return [...still, ...confirm, ...howToCheck, ...undone];
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

  // What a person confirms, and how to let OneUptime read it back.
  const confirmLines: Array<SecurityCaseStepCheckSentence> = confirm.flatMap(
    describeAccountChangeLines,
  );
  const howToCheck: Array<SecurityCaseStepCheckSentence> =
    confirmReasons(confirm);
  const undoneLines: Array<SecurityCaseStepCheckSentence> = undone.map(
    describeAccountChange,
  );

  if (still.length > 0) {
    const facts: Array<SecurityCaseStepCheckSentence> = orderAccountChangeFacts(
      {
        still: still.flatMap(describeAccountChangeLines),
        confirm: confirmLines,
        howToCheck,
        undone: undoneLines,
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

  if (undone.length === 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(
          CHECK_ACCOUNT_CHANGES_CANNOT_READ,
          {},
          { count: confirm.length },
        ),
        facts: orderAccountChangeFacts({
          still: [],
          confirm: confirmLines,
          howToCheck,
          undone: [],
        }),
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
      facts: orderAccountChangeFacts({
        still: [],
        confirm: confirmLines,
        howToCheck,
        undone: undoneLines,
      }),
      links,
      // What a person confirms: the docs say how to let OneUptime read it back.
      ...(confirm.length > 0 ? { docsPath: STEP_CHECK_DOCS_PATH } : {}),
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
