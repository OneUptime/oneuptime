import {
  FIX_PULL_REQUEST_LIMIT_SHOWN,
  FIX_PULL_REQUEST_LIMIT_SHOWN_COUNT,
  FixPullRequestLimit,
  getFixPullRequestLimit,
} from "../CodeRepository/FixPullRequestLimit";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A repository's settings in Code, in words and plain rules - React-free, so
 * the page and App's tests read the same ones.
 *
 * The page asks as little as it can. Connecting GitHub already picked what
 * most teams want (CodeRepositoryService.getNewRepositoryDefaults), so what
 * is left is a switch and what AI works on, in sight:
 *
 *   - GitHub Commands: one switch, saved the moment it is flipped - on by
 *     default;
 *   - Runner: where AI works, with Edit.
 *
 * and, folded under More settings, what most never change: where AI's pull
 * requests open and how many may be open at once, the label that hands an
 * issue to the GitHub App, and - only on a repository that has them - the
 * build and test commands an operator set before AI read how to build and
 * test from the repository's own AGENTS.md. Code no longer asks for those
 * commands: they are shown, run, and can be removed.
 */

// What a repository holds that this page reads.
export interface CodeRepositorySettingsValues {
  mainBranchName?: string | undefined | null;
  maxOpenFixPullRequests?: number | undefined | null;
  gitHubTriggerLabel?: string | undefined | null;
  setupCommand?: string | undefined | null;
  buildCommand?: string | undefined | null;
  testCommand?: string | undefined | null;
}

// The label that hands an issue to the GitHub App when none is set.
export const DEFAULT_GITHUB_TRIGGER_LABEL: string = "oneuptime";

export const CODE_REPOSITORY_SETTINGS_COPY: {
  gitHubCommandsCardTitle: string;
  gitHubCommandsSwitchTitle: string;
  gitHubCommandsSwitchDescription: string;
  runnerCardTitle: string;
  runnerCardDescription: string;
  moreSettingsDescription: string;
  pullRequestsCardTitle: string;
  pullRequestsCardDescription: string;
  mainBranchTitle: string;
  mainBranchFormDescription: string;
  mainBranchDetailDescription: string;
  triggerLabelCardTitle: string;
  triggerLabelCardSummary: string;
  triggerLabelCardDescription: string;
  triggerLabelFieldTitle: string;
  commandsCardTitle: string;
  commandsCardDescription: string;
  commandsSetValue: string;
  removeCommandsButton: string;
  removeCommandsConfirmTitle: string;
  removeCommandsConfirmDescription: string;
} = {
  gitHubCommandsCardTitle: translationKey("GitHub Commands"),
  gitHubCommandsSwitchTitle: translationKey("Respond to GitHub Commands"),
  gitHubCommandsSwitchDescription: translationKey(
    "Let people with write access mention the OneUptime GitHub App, or add the trigger label, to give it work. It never merges anything.",
  ),
  runnerCardTitle: translationKey("Runner"),
  runnerCardDescription: translationKey("Where AI works in this repository."),
  moreSettingsDescription: translationKey(
    "Where AI's pull requests open, how many may be open at once, and the label that hands an issue to the GitHub App.",
  ),
  pullRequestsCardTitle: translationKey("Pull Requests"),
  pullRequestsCardDescription: translationKey(
    "Where AI's pull requests open, and how many may be open at once.",
  ),
  mainBranchTitle: translationKey("Main Branch"),
  mainBranchFormDescription: translationKey(
    "The main branch of the repository (e.g., main, master).",
  ),
  mainBranchDetailDescription: translationKey(
    "The main branch of the repository.",
  ),
  triggerLabelCardTitle: translationKey("GitHub Trigger Label"),
  // The card: what the label does. How to set it is the form's to say.
  triggerLabelCardSummary: translationKey(
    "Adding this label to a GitHub issue hands the issue to the app, as a mention does.",
  ),
  // The Edit form's field: what it does, and what empty means.
  triggerLabelCardDescription: translationKey(
    "Adding this label to an issue hands it to the app, like a mention. Leave empty for 'oneuptime'.",
  ),
  triggerLabelFieldTitle: translationKey("Label"),
  commandsCardTitle: translationKey("Build and Test Commands"),
  /*
   * What the commands do now, why they are no longer needed, and that they
   * may go: in that order, as a reader meeting them asks.
   */
  commandsCardDescription: translationKey(
    "A Runner of your own runs these after AI changes the code. AI now learns how to build and test from the repository's AGENTS.md, so you can remove them.",
  ),
  commandsSetValue: translationKey("Configured"),
  removeCommandsButton: translationKey("Remove Commands"),
  removeCommandsConfirmTitle: translationKey("Remove these commands?"),
  removeCommandsConfirmDescription: translationKey(
    "AI then builds and tests its changes the way the repository's AGENTS.md says. You can set commands again through the API or Terraform.",
  ),
};

// A command that is set: something other than blank.
function isSet(command: string | undefined | null): boolean {
  return typeof command === "string" && command.trim().length > 0;
}

// Whether an operator set any build or test command on the repository.
export function hasRepositoryCommands(
  repository: CodeRepositorySettingsValues | null | undefined,
): boolean {
  if (!repository) {
    return false;
  }

  return (
    isSet(repository.setupCommand) ||
    isSet(repository.buildCommand) ||
    isSet(repository.testCommand)
  );
}

// The label that hands an issue to the GitHub App: the one set, or the default.
export function getGitHubTriggerLabel(
  repository: CodeRepositorySettingsValues | null | undefined,
): string {
  const label: string = (repository?.gitHubTriggerLabel || "").trim();

  return label || DEFAULT_GITHUB_TRIGGER_LABEL;
}

/*
 * What More settings lists while it is folded: its cards by name, and the
 * ones set to something other than their default with what they are set to
 * ("Pull Requests: Up to 3 open at once", "GitHub Trigger Label: ai-fix").
 * The commands card is listed only on a repository that has commands.
 */
export function getRepositoryMoreSettingsItems(
  repository: CodeRepositorySettingsValues | null | undefined,
  translator: Translator,
): Array<FoldedSectionItem> {
  const limit: FixPullRequestLimit = getFixPullRequestLimit(repository || {});
  const label: string = (repository?.gitHubTriggerLabel || "").trim();
  const hasCustomLabel: boolean =
    Boolean(label) &&
    label.toLowerCase() !== DEFAULT_GITHUB_TRIGGER_LABEL.toLowerCase();

  const items: Array<FoldedSectionItem> = [
    {
      key: "pull-requests",
      title: CODE_REPOSITORY_SETTINGS_COPY.pullRequestsCardTitle,
      isSet: limit !== FixPullRequestLimit.NoLimit,
      ...(limit === FixPullRequestLimit.Limit
        ? {
            value: translator.translateTemplate(
              FIX_PULL_REQUEST_LIMIT_SHOWN_COUNT,
              {
                limit: translator.formatNumber(
                  Number(repository?.maxOpenFixPullRequests),
                ),
              },
            ),
          }
        : limit === FixPullRequestLimit.Blocked
          ? {
              value: FIX_PULL_REQUEST_LIMIT_SHOWN[FixPullRequestLimit.Blocked],
              translateValue: true,
            }
          : {}),
    },
    {
      key: "trigger-label",
      title: CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardTitle,
      isSet: hasCustomLabel,
      ...(hasCustomLabel ? { value: label } : {}),
    },
  ];

  if (hasRepositoryCommands(repository)) {
    items.push({
      key: "commands",
      title: CODE_REPOSITORY_SETTINGS_COPY.commandsCardTitle,
      isSet: true,
      value: CODE_REPOSITORY_SETTINGS_COPY.commandsSetValue,
      translateValue: true,
    });
  }

  return items;
}
