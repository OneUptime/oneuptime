import { Service as RunnerServiceClass } from "../../Services/RunnerService";
import CommandAllowlist from "./CommandAllowlist";
import RunbookCredentialReaders from "./RunbookCredentialReaders";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ObjectID from "../../../Types/ObjectID";

/*
 * What a rule says about the commands OneUptime AI composes for it: the
 * columns of AutoRemediationRule, or what a write sends for them (the
 * allowlist as an array, a JSON string or one bare pattern - the column is
 * jsonb; Runners as rows, { _id } objects or ids).
 */
export interface RuleCommandSettings {
  isEnabled?: boolean | undefined;
  remediationAction?: AutoRemediationRule["remediationAction"] | undefined;
  aiComposesCommands?: boolean | undefined;
  executionMode?: AutoRemediationRule["executionMode"] | undefined;
  commandAllowlist?: unknown;
  commandRunners?: unknown;
}

// One rule a write changes: as it was (null for a new rule), as it will be.
export interface RuleCommandSettingsChange {
  before: RuleCommandSettings | null;
  after: RuleCommandSettings;
}

/*
 * A COMMAND RUNS WITH A RUNBOOK CREDENTIAL ONLY WHEN WHOEVER CHOSE THAT
 * CREDENTIAL FOR IT MAY READ CREDENTIALS.
 *
 * A runbook credential (an SSH key, a service account token) is used by a
 * command only when the person who decided the command may run with it may
 * read runbook credentials (RunbookCredential's read list:
 * RelationListPermission.mayReadTable) - the rule naming a credential in a
 * runbook step follows (RunbookService), and the one binding a credential
 * to a cluster's AI access follows (KubernetesClusterService). For OneUptime
 * AI's remediation commands that person is:
 *
 *   - whoever approves a plan. An SSH command in it runs with one of the
 *     credentials assigned to its Runner, the one OneUptime AI picked; the
 *     approver confirms that choice, so approving needs the read
 *     (assertApproverMayUseCredentials). A plan made by OneUptime AI and
 *     approved by a person is held to the person.
 *   - whoever lets a rule run OneUptime AI's commands without asking (Full
 *     Auto, with an allowlist): there is no approver, and every SSH command
 *     the rule's runs pick runs on its own, so turning that on, or widening
 *     it, needs the read (AutoRemediationRuleService).
 *
 * A kubectl command runs with the credential its cluster's AI page binds,
 * which only someone who may read credentials can bind, and the approve
 * route refuses a kubectl command composed for any other binding; a
 * resource's command never carries a credential. Neither picks one.
 *
 * A workflow's step is never one who may (RunbookCredentialReaders): a
 * person who may read runbook credentials has to approve such a plan or save
 * such a rule.
 */
export default class AiRemediationCredentialUse {
  // Whether `props` may read runbook credentials, so let commands use them.
  public static mayUseCredentials(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return RunbookCredentialReaders.mayRead(props);
  }

  /*
   * The first command of `plan` that runs with a credential OneUptime AI
   * picked - an SSH command, the one kind that runs with one of its
   * Runner's credentials - or undefined. A kubectl command's credential is
   * its cluster's binding, not a pick; a Bash command runs on the Runner
   * itself and a resource's command on its own agent, with none, whatever
   * the plan carries beside them.
   */
  public static getCommandWithPickedCredential(
    plan: AiRemediationCommandPlan,
  ): AiRemediationCommand | undefined {
    return plan.commands.find((command: AiRemediationCommand): boolean => {
      return command.stepType === RunbookStepType.SSH;
    });
  }

  // The permissions that read runbook credentials, by title.
  public static getCredentialReaderTitles(): string {
    return RunbookCredentialReaders.getTitles();
  }

  // Why an approver who may not read credentials cannot approve `command`.
  public static getApprovalRefusal(command: AiRemediationCommand): string {
    const credential: string = command.credentialNameSnapshot
      ? `the credential "${command.credentialNameSnapshot}"`
      : "a runbook credential";

    return `Command ${command.sequence} of this plan runs over SSH with ${credential}, and approving a plan that runs with a runbook credential needs permission to read runbook credentials: ${AiRemediationCredentialUse.getCredentialReaderTitles()}. Ask someone who has it to approve the plan, or dismiss the suggestion.`;
  }

  /*
   * Refuses an approval of `plan` by someone who may not read runbook
   * credentials when one of its commands runs with a credential OneUptime AI
   * picked. Nothing to refuse otherwise.
   */
  public static assertApproverMayUseCredentials(data: {
    plan: AiRemediationCommandPlan;
    props: DatabaseCommonInteractionProps;
  }): void {
    const command: AiRemediationCommand | undefined =
      AiRemediationCredentialUse.getCommandWithPickedCredential(data.plan);

    if (!command || AiRemediationCredentialUse.mayUseCredentials(data.props)) {
      return;
    }

    throw new NotAuthorizedException(
      AiRemediationCredentialUse.getApprovalRefusal(command),
    );
  }

  /*
   * Whether a rule, as `rule` has it, runs OneUptime AI's commands without
   * asking, as the rule engine and the run decide it: it is on (a rule
   * saved without the column is), fixes with OneUptime AI composing
   * commands (the column a rule saved without reads as OneUptime AI), Full
   * Auto, with a command allowlist read as the run reads it
   * (CommandAllowlist: an array, a JSON string or one bare pattern) -
   * without one, every run asks first.
   */
  public static runsCommandsWithoutAsking(
    rule: Omit<RuleCommandSettings, "commandRunners">,
  ): boolean {
    return (
      rule.isEnabled !== false &&
      rule.remediationAction !== AutoRemediationAction.Runbooks &&
      rule.aiComposesCommands === true &&
      rule.executionMode === AutoRemediationExecutionMode.FullAuto &&
      CommandAllowlist.normalize(rule.commandAllowlist).length > 0
    );
  }

  /*
   * Whether a write that leaves a rule `after` lets OneUptime AI do more
   * without asking than `before` (null for a new rule) did: it starts
   * running commands without asking (turning the rule on included), adds
   * an allowlist pattern, or reaches more Runners - one it did not, or
   * every Runner once its list is cleared. A rule that does not run
   * commands without asking afterwards never does more.
   */
  public static widensCommandsWithoutAsking(
    data: RuleCommandSettingsChange,
  ): boolean {
    if (!AiRemediationCredentialUse.runsCommandsWithoutAsking(data.after)) {
      return false;
    }

    if (
      !data.before ||
      !AiRemediationCredentialUse.runsCommandsWithoutAsking(data.before)
    ) {
      return true;
    }

    const patternsBefore: Array<string> = CommandAllowlist.normalize(
      data.before.commandAllowlist,
    );

    const addsPattern: boolean = CommandAllowlist.normalize(
      data.after.commandAllowlist,
    ).some((pattern: string): boolean => {
      return !patternsBefore.includes(pattern);
    });

    if (addsPattern) {
      return true;
    }

    const runnersBefore: Array<string> = RunnerServiceClass.readRunnerIds(
      data.before.commandRunners,
    ).map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    });

    const runnersAfter: Array<string> = RunnerServiceClass.readRunnerIds(
      data.after.commandRunners,
    ).map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    });

    // No Runners named means any Runner that accepts AI commands.
    if (runnersAfter.length === 0) {
      return runnersBefore.length > 0;
    }

    if (runnersBefore.length === 0) {
      return false;
    }

    return runnersAfter.some((id: string): boolean => {
      return !runnersBefore.includes(id);
    });
  }

  /*
   * Why a rule cannot be left running OneUptime AI's commands without
   * asking - and, for a workflow's step, that a person has to save it
   * (RunbookCredentialReaders.getWorkflowNote).
   */
  public static getUnattendedRuleRefusal(
    props?: DatabaseCommonInteractionProps | undefined,
  ): string {
    return `This rule would let OneUptime AI run its commands without asking, and those commands may run over SSH with any credential assigned to the rule's Runners. Turning that on (or turning on a rule that does it), adding allowlist patterns or Runners to it needs permission to read runbook credentials: ${AiRemediationCredentialUse.getCredentialReaderTitles()}.${
      props ? RunbookCredentialReaders.getWorkflowNote(props) : ""
    } Set the rule to ask before fixing, or ask someone who has it to save the rule.`;
  }

  /*
   * Refuses a write by someone who may not read runbook credentials that
   * leaves any of `changes` running OneUptime AI's commands without asking
   * more widely than before (widensCommandsWithoutAsking).
   */
  public static assertMaySaveRules(data: {
    props: DatabaseCommonInteractionProps;
    changes: Array<RuleCommandSettingsChange>;
  }): void {
    const widens: boolean = data.changes.some(
      (change: RuleCommandSettingsChange): boolean => {
        return AiRemediationCredentialUse.widensCommandsWithoutAsking(change);
      },
    );

    if (!widens || AiRemediationCredentialUse.mayUseCredentials(data.props)) {
      return;
    }

    throw new NotAuthorizedException(
      AiRemediationCredentialUse.getUnattendedRuleRefusal(data.props),
    );
  }
}
