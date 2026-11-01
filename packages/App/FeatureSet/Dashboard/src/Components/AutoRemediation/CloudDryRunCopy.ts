import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import { getCloudChangesToDryRun } from "Common/Utils/AiRemediation/CloudChangeDryRunPlan";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of a cloud change's dry run on the Remediation card
 * (CloudDryRunNote), and when the card offers one - import-clean, so the
 * suites and the docs facts read them without a browser.
 *
 * Before a person approves a fix that changes a cloud account, OneUptime
 * asks the account's Cloud AI agent to dry-run each change: it checks the
 * change the way it would make it and reads what it would replace, then
 * stops before the call (Common/Utils/AiRemediation/CloudChangeDryRunPlan).
 * The card says what came back, in the reader's language; what the agent
 * said stays in its own words below it, like a command's output.
 */
export const CLOUD_DRY_RUN_COPY: {
  running: string;
  wouldRun: string;
  wouldBeRefused: string;
  failed: string;
  agentSaid: string;
  dryRun: string;
  dryRunAgain: string;
  dryRunActionError: string;
} = {
  running: translationKey("Checking this change with a dry run…"),
  wouldRun: translationKey(
    "Dry run {{time}}: this change would run. Nothing was changed.",
  ),
  wouldBeRefused: translationKey(
    "Dry run {{time}}: the agent would refuse this change. Nothing was changed.",
  ),
  failed: translationKey(
    "Dry run {{time}}: it could not finish. Nothing was changed.",
  ),
  agentSaid: translationKey("What the agent said"),
  dryRun: translationKey("Dry run"),
  dryRunAgain: translationKey("Dry run again"),
  dryRunActionError: translationKey(
    "Could not start the dry run: nothing was changed",
  ),
};

/*
 * Whether the card offers a dry run of a fix: it waits for approval, and
 * it changes a cloud account (a change that has not run). "Dry run again"
 * once any of its changes has been checked.
 */
export function getCloudDryRunButtonTitle(data: {
  status: AutoRemediationSuggestionStatus | undefined;
  plan: AiRemediationCommandPlan | null;
}): string | null {
  if (data.status !== AutoRemediationSuggestionStatus.Suggested) {
    return null;
  }

  const changes: Array<AiRemediationCommand> = getCloudChangesToDryRun(
    data.plan,
  );

  if (changes.length === 0) {
    return null;
  }

  return changes.some((change: AiRemediationCommand): boolean => {
    return change.dryRun !== undefined;
  })
    ? CLOUD_DRY_RUN_COPY.dryRunAgain
    : CLOUD_DRY_RUN_COPY.dryRun;
}
