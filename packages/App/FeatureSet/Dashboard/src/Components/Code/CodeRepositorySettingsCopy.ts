import {
  FIX_PULL_REQUEST_LIMIT_SHOWN,
  FIX_PULL_REQUEST_LIMIT_SHOWN_COUNT,
  FixPullRequestLimit,
  getFixPullRequestLimit,
} from "../CodeRepository/FixPullRequestLimit";
import {
  PRODUCTION_REVIEW_CONTENT_COPY,
  PRODUCTION_REVIEW_SETTINGS_COPY,
  readProductionReviewContent,
} from "./CodeProductionReviewCopy";
import type { RunnerChoices } from "../Runner/RunnerChoices";
import {
  CODE_HIDDEN_RUNNER_LABEL,
  RunnerPickerModel,
  RunnerPickerOptionKind,
  RunnerPickerOutcome,
  RunnerPickerWork,
  buildRunnerPickerModel,
} from "../Runner/RunnerPickerModel";
import { ProductionReviewPullRequestContent } from "Common/Types/CodeRepository/ProductionReview";
import {
  CodeHost,
  CodeHostCapability,
} from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import RunnerLiveStatus, {
  getRunnerLiveStatusLabel,
} from "Common/Types/Runner/RunnerLiveStatus";
import {
  FOLDED_SECTION_OFF,
  FoldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A repository's settings in Code, in words and plain rules - React-free, so
 * the page and App's tests read the same ones.
 *
 * The page asks as little as it can. Connecting GitHub already picked what
 * most teams want (CodeRepositoryService.getNewRepositoryDefaults), so its
 * top holds the repository itself - Repository Details: its name, where
 * its code lives and how it connects - and everything else is folded under
 * More settings, which names what it holds while it is folded:
 *
 *   - GitHub Commands: one switch, saved the moment it is flipped - on by
 *     default;
 *   - Production Review: one switch - on for repositories connected from
 *     now on - that has OneUptime review pull requests against production;
 *   - Runner: where AI works, with Edit - a global Runner unless one of
 *     the project's own is picked;
 *   - Pull Requests: where AI's pull requests open and how many may be open
 *     at once;
 *   - GitHub Trigger Label: the label that hands an issue to the GitHub
 *     App;
 *   - Production Review Comment: what a production review posts on a pull
 *     request;
 *   - Build and Test Commands - only on a repository that has them: the
 *     commands an operator set before AI read how to build and test from
 *     the repository's own AGENTS.md. Code no longer asks for those
 *     commands: they are shown, run, and can be removed.
 *
 * A repository that is not on GitHub has no GitHub App to answer commands
 * or review its pull requests: its More settings hold the Runner, its pull
 * requests (GitLab, Forgejo, Gitea) or - for a Git server, where AI pushes
 * a branch and opens no pull request - its Branches, and the commands, with
 * one plain line saying what works in GitHub repositories only
 * (getRepositorySettingsFor).
 *
 * The maintainer, on the page that kept GitHub Commands and Runner in sight
 * above More settings: "GitHub commands and runner should be inside of more
 * settings as well." Production Review followed them, by the same rule: a
 * setting whose default works for most repositories is folded. The ones
 * that were in sight come first in the fold, in the order they had.
 *
 * Each setting has a place on the page (CodeRepositorySetting): its card's
 * id, the key More settings lists it by, and what a link names after the
 * page's "#" to land on it - More settings then opens by itself there
 * (Common/UI/Utils/PageAnchor). "Pick a Runner" opens ".../settings#runner".
 */

/*
 * The settings of a repository, by their places on its Settings page, in
 * the order the page draws them under More settings.
 */
export enum CodeRepositorySetting {
  GitHubCommands = "github-commands",
  ProductionReview = "production-review",
  Runner = "runner",
  PullRequests = "pull-requests",
  TriggerLabel = "trigger-label",
  ProductionReviewComment = "production-review-comment",
  // Only on a repository whose operator set build and test commands.
  Commands = "commands",
  /*
   * A Git repository's Pull Requests: AI pushes a branch there and opens no
   * pull request, so only the branch it starts from is asked.
   */
  Branches = "branches",
}

export const CODE_REPOSITORY_SETTINGS_IN_ORDER: ReadonlyArray<CodeRepositorySetting> =
  [
    CodeRepositorySetting.GitHubCommands,
    CodeRepositorySetting.ProductionReview,
    CodeRepositorySetting.Runner,
    CodeRepositorySetting.PullRequests,
    CodeRepositorySetting.TriggerLabel,
    CodeRepositorySetting.ProductionReviewComment,
    CodeRepositorySetting.Commands,
  ];

/*
 * The settings of a repository on GitHub, and the ones a repository on
 * another host has: the GitHub App's commands, its trigger label and the
 * production reviews it posts are GitHub's alone; a Git repository has
 * Branches where the others have Pull Requests.
 */
const GITHUB_ONLY_SETTINGS: ReadonlyArray<CodeRepositorySetting> = [
  CodeRepositorySetting.GitHubCommands,
  CodeRepositorySetting.ProductionReview,
  CodeRepositorySetting.TriggerLabel,
  CodeRepositorySetting.ProductionReviewComment,
];

export const getRepositorySettingsFor: (
  provider: string | null | undefined,
) => Array<CodeRepositorySetting> = (
  provider: string | null | undefined,
): Array<CodeRepositorySetting> => {
  const type: CodeRepositoryType = CodeHost.readType(provider);

  if (type === CodeRepositoryType.GitHub) {
    return [...CODE_REPOSITORY_SETTINGS_IN_ORDER];
  }

  return CODE_REPOSITORY_SETTINGS_IN_ORDER.filter(
    (setting: CodeRepositorySetting): boolean => {
      return !GITHUB_ONLY_SETTINGS.includes(setting);
    },
  ).map((setting: CodeRepositorySetting): CodeRepositorySetting => {
    return setting === CodeRepositorySetting.PullRequests &&
      !CodeHost.can(type, CodeHostCapability.PullRequests)
      ? CodeRepositorySetting.Branches
      : setting;
  });
};

/*
 * What a repository holds that this page reads - and, for the two switches
 * and the Runner, what the page has learnt of them so far: unknown
 * (undefined) until their cards have read the repository.
 */
export interface CodeRepositorySettingsValues {
  mainBranchName?: string | undefined | null;
  maxOpenFixPullRequests?: number | undefined | null;
  gitHubTriggerLabel?: string | undefined | null;
  setupCommand?: string | undefined | null;
  buildCommand?: string | undefined | null;
  testCommand?: string | undefined | null;
  productionReviewPullRequestContent?: string | undefined | null;
  /*
   * Where Respond to GitHub Commands is, as its switch shows it: a
   * repository that never set it is on, as the server reads it.
   */
  isGitHubCommandsEnabled?: boolean | undefined;
  /*
   * Where Review Pull Requests Against Production is, as its switch shows
   * it: a repository that never set it is off, as the server reads it.
   */
  isProductionReviewEnabled?: boolean | undefined;
  /*
   * The Runner the repository picks, as getRepositoryRunnerId reads it:
   * empty for none (a global Runner).
   */
  runnerId?: string | undefined;
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
  moreSettingsDescriptionPullRequests: string;
  moreSettingsDescriptionBranches: string;
  noRunnerValue: string;
  branchesCardTitle: string;
  branchesCardDescription: string;
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
  /*
   * Under More settings' title once it is open: what it holds, in the order
   * it holds it, in the words its cards use ("Where AI works in this
   * repository.", "Where AI's pull requests open") - never "the Runner AI
   * works on", which read as one name, "Runner AI".
   */
  moreSettingsDescription: translationKey(
    "GitHub commands, production reviews, where AI works, and where its pull requests open.",
  ),
  // The same, for a repository on GitLab, Forgejo or Gitea.
  moreSettingsDescriptionPullRequests: translationKey(
    "Where AI works, and where its pull requests open.",
  ),
  // The same, for a repository on a Git server.
  moreSettingsDescriptionBranches: translationKey(
    "Where AI works, and the branch it starts from.",
  ),
  /*
   * More settings' chip for a repository that picks no Runner where there
   * is no global Runner to work on: "Runner: None".
   */
  noRunnerValue: translationKey("None"),
  // A Git repository's Pull Requests: the branch AI starts from, alone.
  branchesCardTitle: translationKey("Branches"),
  branchesCardDescription: translationKey(
    "AI starts from the main branch and pushes its work to a new branch, for you to open a pull request from on your Git server.",
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
 * A switch, as More settings lists it: by its card's title, and - only
 * while it is off, which is not its default for either switch here - set,
 * with "Off". Not known yet: listed by name alone.
 */
function getSwitchItem(data: {
  setting: CodeRepositorySetting;
  title: string;
  isOn: boolean | undefined;
}): FoldedSectionItem {
  const isOff: boolean = data.isOn === false;

  return {
    key: data.setting,
    title: data.title,
    isSet: isOff,
    ...(isOff ? { value: FOLDED_SECTION_OFF, translateValue: true } : {}),
  };
}

/*
 * The Runner, as More settings lists it while it is folded: by name alone
 * while the repository works on a global Runner (the default) or while the
 * page has not read where it works yet; otherwise set, with what it works
 * on -
 *
 *   - one of the project's own Runners: its name ("Runner:
 *     prod-eu-west-1"), and how it is doing when it is not connected
 *     ("Runner: office-runner · Disconnected"), as an auto remediation
 *     rule's folded Runner says it;
 *   - one the reader does not have access to: says so, never its id;
 *   - none, where there is no global Runner to work on (the project turned
 *     them off, or the server runs none): "Runner: None".
 */
export function getRepositoryRunnerItem(
  data: {
    runnerId: string | undefined;
    choices: RunnerChoices | null | undefined;
  },
  translator: Translator,
): FoldedSectionItem {
  const unset: FoldedSectionItem = {
    key: CodeRepositorySetting.Runner,
    title: CODE_REPOSITORY_SETTINGS_COPY.runnerCardTitle,
    isSet: false,
  };

  if (data.runnerId === undefined || !data.choices) {
    return unset;
  }

  const model: RunnerPickerModel = buildRunnerPickerModel({
    work: RunnerPickerWork.CodeRepository,
    stepType: "",
    currentRunnerId: data.runnerId,
    projectRunners: data.choices.projectRunners,
    globalRunners: data.choices.globalRunners,
    projectUsesGlobalRunners: data.choices.projectUsesGlobalRunners,
  });

  if (model.selected?.kind === RunnerPickerOptionKind.Project) {
    const liveStatus: RunnerLiveStatus | undefined = model.selected.liveStatus;
    const status: string | undefined =
      liveStatus && liveStatus !== RunnerLiveStatus.Connected
        ? translator.translateText(getRunnerLiveStatusLabel(liveStatus))
        : undefined;

    return {
      ...unset,
      isSet: true,
      value: status
        ? `${model.selected.name} · ${status}`
        : model.selected.name,
    };
  }

  if (model.outcome === RunnerPickerOutcome.UnknownRunner) {
    return {
      ...unset,
      isSet: true,
      value: CODE_HIDDEN_RUNNER_LABEL,
      translateValue: true,
    };
  }

  if (
    model.outcome === RunnerPickerOutcome.GlobalRunnersOff ||
    model.outcome === RunnerPickerOutcome.NoGlobalRunner
  ) {
    return {
      ...unset,
      isSet: true,
      value: CODE_REPOSITORY_SETTINGS_COPY.noRunnerValue,
      translateValue: true,
    };
  }

  return unset;
}

/*
 * What More settings lists while it is folded: its cards by name, in the
 * order it draws them, and the ones set to something other than their
 * default with what they are set to ("GitHub Commands: Off", "Runner:
 * prod-eu-west-1", "Pull Requests: Up to 3 open at once", "GitHub Trigger
 * Label: ai-fix", "Production Review Comment: Only a link to the review").
 * The commands card is listed only on a repository that has commands.
 * Folded, the header names four of them and counts the rest; a set one is
 * always named (FoldedSectionItem).
 */
export function getRepositoryMoreSettingsItems(
  repository: CodeRepositorySettingsValues | null | undefined,
  translator: Translator,
  runnerChoices?: RunnerChoices | null | undefined,
  provider?: string | null | undefined,
): Array<FoldedSectionItem> {
  const limit: FixPullRequestLimit = getFixPullRequestLimit(repository || {});
  const label: string = (repository?.gitHubTriggerLabel || "").trim();
  const hasCustomLabel: boolean =
    Boolean(label) &&
    label.toLowerCase() !== DEFAULT_GITHUB_TRIGGER_LABEL.toLowerCase();
  const reviewContent: ProductionReviewPullRequestContent =
    readProductionReviewContent(repository?.productionReviewPullRequestContent);

  const items: Array<FoldedSectionItem> = [
    getSwitchItem({
      setting: CodeRepositorySetting.GitHubCommands,
      title: CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsCardTitle,
      isOn: repository?.isGitHubCommandsEnabled,
    }),
    getSwitchItem({
      setting: CodeRepositorySetting.ProductionReview,
      title: PRODUCTION_REVIEW_SETTINGS_COPY.cardTitle,
      isOn: repository?.isProductionReviewEnabled,
    }),
    getRepositoryRunnerItem(
      { runnerId: repository?.runnerId, choices: runnerChoices },
      translator,
    ),
    {
      key: CodeRepositorySetting.PullRequests,
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
      key: CodeRepositorySetting.TriggerLabel,
      title: CODE_REPOSITORY_SETTINGS_COPY.triggerLabelCardTitle,
      isSet: hasCustomLabel,
      ...(hasCustomLabel ? { value: label } : {}),
    },
    {
      key: CodeRepositorySetting.ProductionReviewComment,
      title: PRODUCTION_REVIEW_SETTINGS_COPY.contentCardTitle,
      isSet: reviewContent !== ProductionReviewPullRequestContent.Review,
      ...(reviewContent !== ProductionReviewPullRequestContent.Review
        ? {
            value: PRODUCTION_REVIEW_CONTENT_COPY[reviewContent].title,
            translateValue: true,
          }
        : {}),
    },
  ];

  if (hasRepositoryCommands(repository)) {
    items.push({
      key: CodeRepositorySetting.Commands,
      title: CODE_REPOSITORY_SETTINGS_COPY.commandsCardTitle,
      isSet: true,
      value: CODE_REPOSITORY_SETTINGS_COPY.commandsSetValue,
      translateValue: true,
    });
  }

  /*
   * A repository on another host: only the settings it has, a Git
   * repository's Branches - named alone, it has nothing set - where the
   * others have Pull Requests.
   */
  const settings: Array<CodeRepositorySetting> =
    getRepositorySettingsFor(provider);

  if (settings.includes(CodeRepositorySetting.Branches)) {
    items.push({
      key: CodeRepositorySetting.Branches,
      title: CODE_REPOSITORY_SETTINGS_COPY.branchesCardTitle,
      isSet: false,
    });
  }

  return settings
    .map((setting: CodeRepositorySetting): FoldedSectionItem | undefined => {
      return items.find((item: FoldedSectionItem): boolean => {
        return item.key === setting;
      });
    })
    .filter(
      (item: FoldedSectionItem | undefined): item is FoldedSectionItem => {
        return Boolean(item);
      },
    );
}

/*
 * What More settings says it holds, once it is open, for the repository's
 * host: GitHub's commands and production reviews only on GitHub; a Git
 * repository's branch where the others' pull requests open.
 */
export function getRepositoryMoreSettingsDescription(
  provider: string | null | undefined,
): string {
  const type: CodeRepositoryType = CodeHost.readType(provider);

  if (type === CodeRepositoryType.GitHub) {
    return CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescription;
  }

  return CodeHost.can(type, CodeHostCapability.PullRequests)
    ? CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescriptionPullRequests
    : CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescriptionBranches;
}
