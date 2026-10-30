import {
  CodeTaskOriginJSON,
  CodeTaskOriginType,
} from "Common/Types/AI/CodeTask";
import {
  LlmProviderActivity,
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "Common/Types/AI/LlmProviderChoice";
import { CODE_REPOSITORY_CONNECTION_COPY } from "./CodeHostCopy";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { env } from "Common/UI/Config";
import {
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewAiNoteCode,
  ProductionReviewOperationMatch,
  ProductionReviewPosting,
  ProductionReviewPullRequestContent,
  ProductionReviewReport,
  ProductionReviewSection,
  ProductionReviewSummaryJSON,
  ProductionReviewWhere,
} from "Common/Types/CodeRepository/ProductionReview";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A pull request's production review in Code, in words and plain rules -
 * React-free, so the pages, the offline fixture and App's tests read the
 * same ones. A repository on GitHub, GitLab, Forgejo or Gitea has them; on
 * GitLab every sentence that names a pull request says merge request
 * (inReviewHostWords). The review itself, and the rules the server applies to it, are
 * Types/CodeRepository/ProductionReview's.
 *
 * OneUptime reviews a pull request against what production shows of the
 * code it changes and says it where the author looks - one comment on the
 * pull request, edited on every push - and on the review's page here. A
 * repository has one switch for it (CodeRepository.isProductionReviewEnabled,
 * on for repositories connected from now on), and one choice of what the
 * comment shows (productionReviewPullRequestContent): on a public
 * repository, only a link to the review here unless someone chose more.
 *
 * English keys (translationKey), translated where they are drawn.
 */

export const PRODUCTION_REVIEW_COPY: {
  recipeLabel: string;
  pageTitle: string;
  pageDescription: string;
  statusOnLabel: string;
  statusOn: string;
  statusOnOthers: string;
  statusOffLabel: string;
  statusOff: string;
  statusOffNoCommands: string;
  statusOnOthersAsk: string;
  statusNotConnectedLabel: string;
  statusNotConnected: string;
  statusNotConnectedHost: string;
  noPullRequests: string;
  connectGitHub: string;
  goToSettings: string;
  openSettings: string;
  turnOnInSettings: string;
  listTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  pullRequestFallbackTitle: string;
  reviewAgain: string;
  reviewingAgain: string;
  rowReviewing: string;
  queued: string;
  reviewing: string;
  failedTitle: string;
  reviewedAt: string;
  commitLabel: string;
  runsIn: string;
  p99: string;
  pointsTitle: string;
  pointsBy: string;
  exceptionsTitle: string;
  exceptionsWindow: string;
  operationsTitle: string;
  operationsWindow: string;
  hotCodeTitle: string;
  hotCodeWindow: string;
  incidentsTitle: string;
  incidentsWindow: string;
  deploysTitle: string;
  deploysWindow: string;
  p95: string;
  newBadge: string;
  unhandledBadge: string;
  allTimeCount: string;
  hotFunctionSelf: string;
  incidentNames: string;
  lastThrown: string;
  declared: string;
  deployAfter: string;
  unreadTitle: string;
  unreadDescription: string;
  aggregatesOnly: string;
  nothingFoundTitle: string;
  nothingFound: string;
  noCodeChanged: string;
  noServices: string;
  postedReview: string;
  postedLinkPublic: string;
  postedLinkChosen: string;
  postedNothing: string;
  commentRefused: string;
  commentRefusedIssues: string;
  aggregatesOnlyHost: string;
  viewComment: string;
  updatesOnChange: string;
  updatesWhenAsked: string;
  updatesWhenAskedForAuthor: string;
  cannotReviewAgain: string;
  notConnected: string;
  notConnectedHost: string;
} = {
  // The recipe, as a task's kind is named.
  recipeLabel: translationKey("Production Review"),
  // The repository's page of them, as its menu names it.
  pageTitle: translationKey("Production Reviews"),
  pageDescription: translationKey(
    "OneUptime reviews pull requests against what production shows of the code they change, posts each review on its pull request and keeps it here.",
  ),
  statusOnLabel: translationKey("On"),
  statusOn: translationKey(
    "A pull request from someone with write access is reviewed when it opens and each time it changes.",
  ),
  /*
   * After statusOn, while the GitHub App answers commands: how a pull
   * request from an outside contributor or a fork is reviewed. {{command}}
   * is the mention, drawn as code.
   */
  statusOnOthers: translationKey(
    "A pull request from anyone else is reviewed when someone with write access comments {{command}} on it.",
  ),
  statusOffLabel: translationKey("Off"),
  // {{command}} is the mention, drawn as code.
  statusOff: translationKey(
    "A pull request is reviewed only when someone with write access comments {{command}} on it.",
  ),
  /*
   * Off, where no command is answered - the GitHub App answers none in the
   * repository, or it is on GitLab, Forgejo or Gitea: Review a pull
   * request, on this page, still asks for one. "Someone", not "someone
   * with write access": what asking here takes is permission to edit the
   * repository in OneUptime, not write access on its host - and only those
   * who have it see the button.
   */
  statusOffNoCommands: translationKey(
    "Pull requests are reviewed only when someone asks for one here.",
  ),
  /*
   * After statusOn, where no command is answered: how a pull request from
   * an outside contributor, a fork or a bot is reviewed - Review a pull
   * request, on this page.
   */
  statusOnOthersAsk: translationKey(
    "A pull request from anyone else is reviewed only when someone asks for it here.",
  ),
  /*
   * The GitHub App no longer reaches the repository (Code's Repositories
   * folds it under Not connected): nothing is reviewed, whatever the switch.
   */
  statusNotConnectedLabel: translationKey("Not connected"),
  statusNotConnected: translationKey(
    "This repository is not connected through the GitHub App, so its pull requests are not reviewed.",
  ),
  /*
   * The same on GitLab, Forgejo or Gitea: the repository's connection - its
   * access token - was refused, or is gone. {{host}} is "GitLab",
   * "Forgejo" or "Gitea".
   */
  statusNotConnectedHost: translationKey(
    "This repository's connection to {{host}} does not work, so its pull requests are not reviewed.",
  ),
  /*
   * A repository on a Git server, which has no pull requests: there is
   * nothing to review (its menu does not offer the page; an address can).
   */
  noPullRequests: translationKey(
    "A Git server has no pull requests for OneUptime to review: production reviews work in GitHub, GitLab, Forgejo and Gitea repositories. Ask AI about a change in this repository from its Tasks.",
  ),
  // Repositories, where GitHub is connected - as a task's blocker links it.
  connectGitHub: translationKey("Connect GitHub"),
  /*
   * The repository's Settings, where a connection that stopped working is
   * fixed (Replace access token).
   */
  goToSettings: translationKey("Go to Settings"),
  openSettings: translationKey("Change in Settings"),
  turnOnInSettings: translationKey("Turn on in Settings"),
  // The list's heading: what its rows are.
  listTitle: translationKey("Pull Requests"),
  emptyTitle: translationKey("No pull request reviewed yet"),
  /*
   * What the list will hold. How a review comes is the status line's to
   * say, above it.
   */
  emptyDescription: translationKey(
    "Each pull request's latest review shows up here.",
  ),
  // A review whose pull request's title is not known yet.
  pullRequestFallbackTitle: translationKey("Pull request {{label}}"),
  reviewAgain: translationKey("Review again"),
  reviewingAgain: translationKey("Reviewing again…"),
  // A list row's state while a review runs.
  rowReviewing: translationKey("Reviewing…"),
  /*
   * Queued: a push waits a minute (so a burst is reviewed once) and Review
   * again is due at once, and a worker takes due reviews every minute.
   */
  queued: translationKey("Starting in a minute or so."),
  reviewing: translationKey("Reviewing against production…"),
  failedTitle: translationKey("The review could not finish."),
  reviewedAt: translationKey("Reviewed {{time}}"),
  commitLabel: translationKey("Commit {{sha}}"),
  runsIn: translationKey("The changed code runs in"),
  p99: translationKey("p99 {{duration}}"),
  pointsTitle: translationKey("What to watch"),
  pointsBy: translationKey("OneUptime AI read the facts below and the diff."),
  exceptionsTitle: translationKey("Exceptions in the changed code"),
  exceptionsWindow: translationKey("Last {{days}} days"),
  operationsTitle: translationKey("Operations that run the changed code"),
  operationsWindow: translationKey("Last hour"),
  hotCodeTitle: translationKey("Hot functions in the changed code"),
  hotCodeWindow: translationKey("Last hour"),
  incidentsTitle: translationKey("Incidents"),
  incidentsWindow: translationKey("Last {{days}} days"),
  deploysTitle: translationKey("Recent deploys"),
  deploysWindow: translationKey("Last {{days}} days"),
  p95: translationKey("p95 {{duration}}"),
  newBadge: translationKey("New"),
  unhandledBadge: translationKey("Unhandled"),
  // A count the exceptions window could not read: the group's own.
  allTimeCount: translationKey("{{count}} in all"),
  // A hot function's own share; the row's figure is its share with what it calls.
  hotFunctionSelf: translationKey("{{self}} in its own code"),
  // {{subject}} is a changed file or function, drawn as code.
  incidentNames: translationKey(
    "Its root cause or postmortem names {{subject}}",
  ),
  /*
   * When an exception was last thrown. {{time}} is "5 minutes ago" in the
   * reader's words - its own sentence, not the shared "Last seen {{time}}":
   * an exception is thrown, not seen.
   */
  lastThrown: translationKey("Last thrown {{time}}"),
  declared: translationKey("Declared {{time}}"),
  deployAfter: translationKey("Deployed {{time}}"),
  unreadTitle: translationKey("Not read this time"),
  unreadDescription: translationKey(
    "These parts of production could not be read. They are read again on the next review.",
  ),
  aggregatesOnly: translationKey(
    "Only counts, durations and the names of code are posted on GitHub: never an exception's message, a log line, an incident's title or personal data.",
  ),
  nothingFoundTitle: translationKey("Nothing found in production"),
  nothingFound: translationKey(
    "Nothing in production runs through this pull request's changes: no exception thrown in them in the last {{days}} days, no traced operation or profiled function that runs them in the last hour, and no open incident or suspect deploy on their services.",
  ),
  noCodeChanged: translationKey(
    "This pull request changes no code production runs, so production has nothing to say about it.",
  ),
  noServices: translationKey(
    "No service OneUptime monitors is known to run this repository's code yet. OneUptime matches services to a repository by the files in their stack traces and by their names.",
  ),
  postedReview: translationKey("Posted on the pull request."),
  postedLinkPublic: translationKey(
    "This repository is public, so the pull request only links to this review.",
  ),
  postedLinkChosen: translationKey(
    "This repository's pull requests only link to their review, as its settings ask.",
  ),
  // The review below says why: it found nothing.
  postedNothing: translationKey("Nothing was posted on the pull request."),
  /*
   * GitLab, Forgejo or Gitea would not let the access token comment on the
   * pull request (a Forgejo or Gitea token without write access to issues,
   * a locked discussion): the review is only here. {{host}} is the host's
   * name.
   */
  commentRefused: translationKey(
    "{{host}} did not let the access token comment on this pull request, so this review is only here.",
  ),
  // After commentRefused, on Forgejo and Gitea: what lets it comment.
  commentRefusedIssues: translationKey(
    "Replace the access token with one that can also write issues.",
  ),
  /*
   * Under a review posted on GitLab, Forgejo or Gitea: what it holds.
   * {{host}} is the host's name. GitHub's is aggregatesOnly.
   */
  aggregatesOnlyHost: translationKey(
    "Only counts, durations and the names of code are posted on {{host}}: never an exception's message, a log line, an incident's title or personal data.",
  ),
  viewComment: translationKey("View comment"),
  updatesOnChange: translationKey(
    "Reviewed again each time the pull request changes.",
  ),
  updatesWhenAsked: translationKey(
    "Production review is off for this repository, so this pull request is reviewed again only when someone asks.",
  ),
  /*
   * On, but its author cannot write to the repository (an outside
   * contributor, a fork): its pushes are not reviewed on their own.
   */
  updatesWhenAskedForAuthor: translationKey(
    "Its author cannot write to this repository, so it is reviewed again only when someone asks.",
  ),
  cannotReviewAgain: translationKey(
    "You can read this review. Reviewing it again takes permission to edit the repository - ask a project admin for it.",
  ),
  notConnected: translationKey(
    "This repository is no longer connected through the GitHub App, so its pull requests cannot be reviewed again.",
  ),
  // The same on GitLab, Forgejo or Gitea. {{host}} is the host's name.
  notConnectedHost: translationKey(
    "This repository's connection to {{host}} does not work now, so its pull requests cannot be reviewed again.",
  ),
};

/*
 * Review a pull request, on a repository's Production Reviews page: any
 * of its open pull requests, by number - one from a fork, a bot or anyone
 * else too, which is never reviewed on its own. GitHub's command asks the
 * same; on GitLab, Forgejo and Gitea it is the one way.
 */
export const PRODUCTION_REVIEW_ASK_COPY: {
  button: string;
  numberTitle: string;
  numberDescription: string;
  numberHint: string;
  submit: string;
} = {
  // The button, and the dialog's title.
  button: translationKey("Review a pull request"),
  numberTitle: translationKey("Pull request number"),
  /*
   * Forks and bots are the pull requests that are never reviewed on their
   * own, so the ones this is most often for.
   */
  numberDescription: translationKey(
    "Any open pull request in this repository, even one from a fork or a bot.",
  ),
  /*
   * Under the field while what is typed is not a number (Review now waits
   * for one): said as soon as it cannot become one, never for a lone "#"
   * or "!" on its way to one.
   */
  numberHint: translationKey("Enter the number of a pull request, such as 12."),
  /*
   * "Review now", not "Review": several languages word a bare Review as
   * View (Network traffic's Review is), and this one starts a review.
   */
  submit: translationKey("Review now"),
};

/*
 * What a list row says a review found, part by part: "2 exceptions",
 * "1 incident" - each a sentence of its own, so a locale words its count.
 */
export const PRODUCTION_REVIEW_GLANCE: {
  exceptions: PluralTemplate;
  operations: PluralTemplate;
  hotFunctions: PluralTemplate;
  incidents: PluralTemplate;
  suspectDeploys: PluralTemplate;
  nothingFound: string;
} = {
  exceptions: {
    one: "{{count}} exception",
    other: "{{count}} exceptions",
  },
  operations: {
    one: "{{count}} operation",
    other: "{{count}} operations",
  },
  hotFunctions: {
    one: "{{count}} hot function",
    other: "{{count}} hot functions",
  },
  incidents: {
    one: "{{count}} incident",
    other: "{{count}} incidents",
  },
  suspectDeploys: {
    one: "{{count}} suspect deploy",
    other: "{{count}} suspect deploys",
  },
  nothingFound: translationKey("Nothing found"),
};

export const PRODUCTION_REVIEW_SPANS_LAST_HOUR: PluralTemplate = {
  one: "{{count}} span in the last hour",
  other: "{{count}} spans in the last hour",
};

export const PRODUCTION_REVIEW_INCIDENTS_IN_ALL: PluralTemplate = {
  one: "{{count}} incident on these services in all",
  other: "{{count}} incidents on these services in all",
};

// How close to the change an exception was thrown.
export const PRODUCTION_REVIEW_WHERE_LABELS: Record<
  ProductionReviewWhere,
  string
> = {
  [ProductionReviewWhere.ChangedLine]: translationKey("At a changed line"),
  [ProductionReviewWhere.ChangedFunction]: translationKey(
    "In a changed function",
  ),
  [ProductionReviewWhere.ChangedFile]: translationKey("In a changed file"),
};

// Why an operation is said to run the changed code.
export const PRODUCTION_REVIEW_MATCH_LABELS: Record<
  ProductionReviewOperationMatch,
  string
> = {
  [ProductionReviewOperationMatch.CodeAttribute]: translationKey(
    "Its spans name the changed file",
  ),
  [ProductionReviewOperationMatch.Route]: translationKey(
    "Serves a changed route",
  ),
  [ProductionReviewOperationMatch.FunctionName]: translationKey(
    "Named after a changed function",
  ),
};

// The parts of a review, as they are named when one could not be read.
export const PRODUCTION_REVIEW_SECTION_LABELS: Record<
  ProductionReviewSection,
  string
> = {
  [ProductionReviewSection.Services]: translationKey("Services"),
  [ProductionReviewSection.Exceptions]: translationKey("Exceptions"),
  [ProductionReviewSection.Operations]: translationKey("Traces"),
  [ProductionReviewSection.Profiles]: translationKey("Profiles"),
  [ProductionReviewSection.Incidents]: translationKey("Incidents"),
  [ProductionReviewSection.Deploys]: translationKey("Deployments"),
};

/*
 * What a hot function's profile measures, as the server names it
 * (getProfileCategoryNoun: "CPU time", "wall time"...), drawn as a fact of
 * its own. A profile the server names any other way is shown as named.
 */
export const PRODUCTION_REVIEW_PROFILE_KIND_LABELS: Record<string, string> = {
  "CPU time": translationKey("CPU time"),
  "wall time": translationKey("Wall time"),
  "memory in use": translationKey("Memory in use"),
  "memory allocations": translationKey("Memory allocations"),
  "time waiting on locks": translationKey("Time waiting on locks"),
  goroutines: translationKey("Goroutines"),
  samples: translationKey("Samples"),
};

// What a hot function's profile measures, in the reader's words.
export function getProfileKindLabel(
  profileKind: string,
  translator: Translator,
): string {
  const label: string | undefined =
    PRODUCTION_REVIEW_PROFILE_KIND_LABELS[profileKind];

  return label ? translator.translateText(label) || label : profileKind;
}

// Why a review has no read from OneUptime AI.
export const PRODUCTION_REVIEW_AI_NOTES: Record<
  ProductionReviewAiNoteCode,
  string
> = {
  [ProductionReviewAiNoteCode.AiOff]: translationKey(
    "OneUptime AI did not read this review: AI is turned off for this project. The facts below are read without it.",
  ),
  [ProductionReviewAiNoteCode.DailyLimit]: translationKey(
    "OneUptime AI already read this pull request, or this repository, as often as it may today. The facts below are read every time.",
  ),
  [ProductionReviewAiNoteCode.Failed]: translationKey(
    "OneUptime AI could not read this review this time. The facts below are complete.",
  ),
};

/*
 * Which LLM provider read the review, when the repository picks one for its
 * production reviews (Production Review LLM Provider, under More settings):
 * the pick, named where What to watch says OneUptime AI read the facts -
 * or, when the pick could not be used, a warning that says which provider
 * read the review instead, and why. The reasons are the AI rules'
 * (Types/AI/LlmProviderChoice), in the repository's words for its pick.
 */
export const PRODUCTION_REVIEW_PROVIDER_COPY: {
  readWith: string;
  unavailableToProjectDefault: string;
  unavailableToGlobal: string;
  unavailableToNone: string;
  creditsUsedUp: string;
  spendLimitReached: string;
} = {
  readWith: translationKey(
    "OneUptime AI read the facts below and the diff, with {{provider}}.",
  ),
  unavailableToProjectDefault: translationKey(
    "This repository's LLM provider for production reviews is no longer available, so {{provider}}, the project's default, read this review.",
  ),
  unavailableToGlobal: translationKey(
    "This repository's LLM provider for production reviews is no longer available, so {{provider}}, the global LLM provider, read this review.",
  ),
  unavailableToNone: translationKey(
    "This repository's LLM provider for production reviews is no longer available, and there is no other to use.",
  ),
  creditsUsedUp: translationKey(
    "This repository's LLM provider for production reviews runs on AI credits, which are used up, so {{provider}}, the project's default, read this review.",
  ),
  spendLimitReached: translationKey(
    "The daily AI spend limit stops this repository's LLM provider for production reviews, so {{provider}}, the project's default, read this review.",
  ),
};

export interface ProductionReviewProviderLine {
  // The sentence, with its {{provider}} slot.
  template: string;
  // The provider that read the review: "" when there was none to use.
  providerName: string;
  // The repository's pick was not used.
  isWarning: boolean;
}

/*
 * The line the review's page says of its LLM provider, or null when the
 * repository picks none - the project's default provider read it, as every
 * review's did before a repository could pick one, so there is nothing new
 * to say.
 */
export function getProductionReviewProviderLine(
  activity: LlmProviderActivity | null | undefined,
): ProductionReviewProviderLine | null {
  if (!activity) {
    return null;
  }

  const providerName: string = activity.providerName || "";
  const copy: typeof PRODUCTION_REVIEW_PROVIDER_COPY =
    PRODUCTION_REVIEW_PROVIDER_COPY;

  if (!activity.source || !providerName) {
    return {
      template: copy.unavailableToNone,
      providerName: "",
      isWarning: true,
    };
  }

  switch (activity.fallbackReason) {
    case LlmProviderFallbackReason.Unavailable:
      return {
        template:
          activity.source === LlmProviderSource.Global
            ? copy.unavailableToGlobal
            : copy.unavailableToProjectDefault,
        providerName,
        isWarning: true,
      };
    case LlmProviderFallbackReason.CreditsUsedUp:
      return {
        template: copy.creditsUsedUp,
        providerName,
        isWarning: true,
      };
    case LlmProviderFallbackReason.SpendLimitReached:
      return {
        template: copy.spendLimitReached,
        providerName,
        isWarning: true,
      };
    default:
      return { template: copy.readWith, providerName, isWarning: false };
  }
}

/*
 * The repository's choice of what a pull request's comment shows: the
 * More settings card's answers, in the order it lists them.
 */
export const PRODUCTION_REVIEW_CONTENT_ANSWERS: Array<ProductionReviewPullRequestContent> =
  [
    ProductionReviewPullRequestContent.Review,
    ProductionReviewPullRequestContent.Link,
    ProductionReviewPullRequestContent.ReviewEvenIfPublic,
  ];

export const PRODUCTION_REVIEW_CONTENT_COPY: Record<
  ProductionReviewPullRequestContent,
  { title: string; description: string }
> = {
  [ProductionReviewPullRequestContent.Review]: {
    title: translationKey("The review, or a link on a public repository"),
    description: translationKey(
      "Private repositories show the review. Public ones only link to it in OneUptime, since anyone on the internet can read them.",
    ),
  },
  [ProductionReviewPullRequestContent.Link]: {
    title: translationKey("Only a link to the review"),
    description: translationKey(
      "Every pull request links to its review in OneUptime, which only members of this project can open. Nothing from production is posted.",
    ),
  },
  [ProductionReviewPullRequestContent.ReviewEvenIfPublic]: {
    title: translationKey("The review, even on a public repository"),
    description: translationKey(
      "Anyone who can read the repository sees its exception counts, slow operations and incident numbers. Never a message or a log line.",
    ),
  },
};

/*
 * The Edit form's value for the choice: never sent (formOnly) - a pick
 * writes the column itself (getValuesForProductionReviewContent), so a
 * repository that never chose opens on the default rather than on nothing.
 */
export const PRODUCTION_REVIEW_CONTENT_FIELD_KEY: string =
  "productionReviewComment";

export const PRODUCTION_REVIEW_SETTINGS_COPY: {
  cardTitle: string;
  switchTitle: string;
  switchDescription: string;
  contentCardTitle: string;
  contentCardDescription: string;
  contentFieldTitle: string;
  providerCardTitle: string;
  providerCardDescription: string;
  providerFieldDescription: string;
} = {
  cardTitle: translationKey("Production Review"),
  switchTitle: translationKey("Review Pull Requests Against Production"),
  switchDescription: translationKey(
    "When someone with write access opens or updates a pull request, OneUptime comments with what production shows of the code it changes.",
  ),
  contentCardTitle: translationKey("Production Review Comment"),
  contentCardDescription: translationKey(
    "What a production review posts on a pull request.",
  ),
  contentFieldTitle: translationKey("What the Comment Shows"),
  /*
   * The LLM provider OneUptime AI reads the pull requests with: the card's
   * line says what it is for, as its neighbours say theirs ("What a
   * production review posts on a pull request."), the field's what empty
   * means - the box names the default it stands for.
   */
  providerCardTitle: translationKey("Production Review LLM Provider"),
  providerCardDescription: translationKey(
    "Which LLM provider a production review uses.",
  ),
  providerFieldDescription: translationKey(
    "OneUptime AI uses the default LLM provider for production reviews, unless you pick another.",
  ),
};

// The repository's choice, read: unset or unknown is the default (Review).
export function readProductionReviewContent(
  value: string | null | undefined,
): ProductionReviewPullRequestContent {
  if (
    value &&
    (PRODUCTION_REVIEW_CONTENT_ANSWERS as Array<string>).includes(value)
  ) {
    return value as ProductionReviewPullRequestContent;
  }

  return ProductionReviewPullRequestContent.Review;
}

function asValues(values: unknown): Record<string, unknown> {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
}

/*
 * The answer the Edit form shows: the one picked, else the stored one's -
 * the default for a repository that never chose.
 */
export function getPickedProductionReviewContent(
  values: unknown,
): ProductionReviewPullRequestContent {
  const picked: unknown = asValues(values)[PRODUCTION_REVIEW_CONTENT_FIELD_KEY];

  if (
    typeof picked === "string" &&
    (PRODUCTION_REVIEW_CONTENT_ANSWERS as Array<string>).includes(picked)
  ) {
    return picked as ProductionReviewPullRequestContent;
  }

  return readProductionReviewContent(
    asValues(values)["productionReviewPullRequestContent"] as
      | string
      | null
      | undefined,
  );
}

// The form values a pick makes: the choice, and the column it writes.
export function getValuesForProductionReviewContent<TValues>(data: {
  values: TValues;
  content: ProductionReviewPullRequestContent;
}): TValues {
  return {
    ...asValues(data.values),
    [PRODUCTION_REVIEW_CONTENT_FIELD_KEY]: data.content,
    productionReviewPullRequestContent: data.content,
  } as unknown as TValues;
}

/*
 * The GitHub App's mention, as people type it on a pull request: its slug,
 * which GitHub makes from the app's name - lowercase, every run of other
 * characters one hyphen. The server reads the slug from GitHub itself; the
 * Dashboard knows only the name it was configured with.
 */
export function getGitHubAppSlug(appName: string | null | undefined): string {
  const name: string = (appName || "").trim().toLowerCase();
  let slug: string = "";
  let isPendingHyphen: boolean = false;

  for (const character of name) {
    const isWordCharacter: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (!isWordCharacter) {
      isPendingHyphen = slug.length > 0;
      continue;
    }

    if (isPendingHyphen) {
      slug += "-";
      isPendingHyphen = false;
    }

    slug += character;
  }

  return slug || "oneuptime";
}

// "@oneuptime production review": the command that asks for a review.
export function getProductionReviewCommand(): string {
  return `@${getGitHubAppSlug(env("GITHUB_APP_NAME") || null)} production review`;
}

// What a list row says a review found, a part per kind, in the reader's words.
export function getProductionReviewGlance(
  summary: ProductionReviewSummaryJSON,
  translator: Translator,
): Array<string> {
  if (!summary.hasSignal) {
    return [
      translator.translateText(PRODUCTION_REVIEW_GLANCE.nothingFound) ||
        PRODUCTION_REVIEW_GLANCE.nothingFound,
    ];
  }

  const parts: Array<string> = [];
  const counts: Array<[number, PluralTemplate]> = [
    [summary.exceptionCount, PRODUCTION_REVIEW_GLANCE.exceptions],
    [summary.operationCount, PRODUCTION_REVIEW_GLANCE.operations],
    [summary.hotFunctionCount, PRODUCTION_REVIEW_GLANCE.hotFunctions],
    [summary.incidentCount, PRODUCTION_REVIEW_GLANCE.incidents],
    [summary.suspectDeployCount, PRODUCTION_REVIEW_GLANCE.suspectDeploys],
  ];

  for (const [count, template] of counts) {
    if (count > 0) {
      parts.push(translator.translatePlural(template, count));
    }
  }

  return parts;
}

/*
 * How each host's pull request is written where a review names what
 * started it: GitHub's and Forgejo's or Gitea's "#42", GitLab's merge
 * request "!42".
 */
const REVIEWED_PULL_REQUEST_LABEL_PREFIXES: Partial<
  Record<CodeTaskOriginType, string>
> = {
  [CodeTaskOriginType.GitHubPullRequest]: "#",
  [CodeTaskOriginType.CodeHostPullRequest]: "#",
  [CodeTaskOriginType.GitLabMergeRequest]: "!",
};

/*
 * The pull request a review is of, by its number, from what started it
 * ("#42" on GitHub, Forgejo or Gitea; "!42", a GitLab merge request) -
 * none for anything else.
 */
export function getReviewedPullRequestNumber(
  origin: CodeTaskOriginJSON | undefined,
): number | null {
  const prefix: string | undefined = origin
    ? REVIEWED_PULL_REQUEST_LABEL_PREFIXES[origin.type]
    : undefined;

  if (!origin || !prefix || !origin.label.startsWith(prefix)) {
    return null;
  }

  const number: number = Number(origin.label.substring(prefix.length));

  return Number.isInteger(number) && number > 0 ? number : null;
}

/*
 * Which sentence says what the pull request shows of a review, in its
 * host's words.
 */
export function getProductionReviewPostingSentence(
  report: Pick<ProductionReviewReport, "posting" | "isPublicRepository">,
  provider?: string | null | undefined,
): string {
  if (report.posting === ProductionReviewPosting.Review) {
    return inReviewHostWords(PRODUCTION_REVIEW_COPY.postedReview, provider);
  }

  if (report.posting === ProductionReviewPosting.Link) {
    return inReviewHostWords(
      report.isPublicRepository === false
        ? PRODUCTION_REVIEW_COPY.postedLinkChosen
        : PRODUCTION_REVIEW_COPY.postedLinkPublic,
      provider,
    );
  }

  return inReviewHostWords(PRODUCTION_REVIEW_COPY.postedNothing, provider);
}

/*
 * What a review that found nothing says: no code changed, no service known
 * to run the repository's code, or nothing found where it runs.
 */
export function getProductionReviewNothingSentence(
  report: Pick<
    ProductionReviewReport,
    "codeFileCount" | "services" | "noServicesReason"
  >,
  translator: Translator,
  provider?: string | null | undefined,
): string {
  if (report.codeFileCount === 0) {
    return (
      translator.translateText(
        inReviewHostWords(PRODUCTION_REVIEW_COPY.noCodeChanged, provider),
      ) || ""
    );
  }

  if (report.services.length === 0 && report.noServicesReason) {
    return translator.translateText(PRODUCTION_REVIEW_COPY.noServices) || "";
  }

  return translator.translateTemplate(
    inReviewHostWords(PRODUCTION_REVIEW_COPY.nothingFound, provider),
    {
      days: translator.formatNumber(PRODUCTION_REVIEW_WINDOWS.exceptionsDays),
    },
  );
}

// A duration in milliseconds, short: "840 ms", "1.2 s".
export function formatReviewDuration(
  milliseconds: number,
  translator: Translator,
): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "";
  }

  if (milliseconds < 1000) {
    return `${translator.formatNumber(Math.round(milliseconds))} ms`;
  }

  return `${translator.formatNumber(Math.round(milliseconds / 100) / 10)} s`;
}

// A share, short: "12%", "0.4%".
export function formatReviewPercent(
  percent: number,
  translator: Translator,
): string {
  if (!Number.isFinite(percent) || percent < 0) {
    return "";
  }

  const rounded: number =
    percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;

  return `${translator.formatNumber(rounded)}%`;
}

// Where the name of a piece of code may break onto a new line, after it.
const CODE_NAME_BREAKS_ALWAYS: string = "/\\_";
// ...and after these only before a long part: "charge.ts" stays whole.
const CODE_NAME_BREAKS_BEFORE_LONG: string = ".:";
const CODE_NAME_LONG_PART: number = 5;

/*
 * The name of a piece of code - a path, an operation, a function - in the
 * pieces a narrow screen may wrap it between: after each "/", "\" and "_",
 * and after a "." or ":" that a long part follows. So
 * "PaymentClient.chargeWithRetries" wraps as "PaymentClient." and
 * "chargeWithRetries", a path at its folders, and "charge.ts:88" or
 * "v2.14.0" never. One pass, in time in line with the name.
 */
export function splitCodeNameAtBreaks(name: string): Array<string> {
  const characters: Array<string> = Array.from(name);
  // The length of the part that starts at each character: up to its next break.
  const partLengths: Array<number> = new Array<number>(characters.length + 1);
  partLengths[characters.length] = 0;

  for (let index: number = characters.length - 1; index >= 0; index--) {
    const character: string = characters[index] as string;
    const isBreak: boolean =
      CODE_NAME_BREAKS_ALWAYS.includes(character) ||
      CODE_NAME_BREAKS_BEFORE_LONG.includes(character);

    partLengths[index] = isBreak ? 0 : (partLengths[index + 1] as number) + 1;
  }

  const pieces: Array<string> = [];
  let current: string = "";

  characters.forEach((character: string, index: number) => {
    current += character;

    const breaksAfter: boolean =
      CODE_NAME_BREAKS_ALWAYS.includes(character) ||
      (CODE_NAME_BREAKS_BEFORE_LONG.includes(character) &&
        (partLengths[index + 1] as number) >= CODE_NAME_LONG_PART);

    if (breaksAfter && index < characters.length - 1) {
      pieces.push(current);
      current = "";
    }
  });

  if (current) {
    pieces.push(current);
  }

  return pieces;
}

/*
 * A point of OneUptime AI's, in pieces: its words, and the names of code it
 * wrapped in backticks - drawn as code, never read as markup.
 */
export function splitPointText(
  text: string,
): Array<{ text: string; isCode: boolean }> {
  const parts: Array<{ text: string; isCode: boolean }> = [];
  const pieces: Array<string> = text.split("`");

  pieces.forEach((piece: string, index: number) => {
    // An odd piece is inside backticks - unless its closing tick is missing.
    const isCode: boolean = index % 2 === 1 && index < pieces.length - 1;

    if (!piece) {
      return;
    }

    if (!isCode && index % 2 === 1) {
      parts.push({ text: `\`${piece}`, isCode: false });
      return;
    }

    parts.push({ text: piece, isCode });
  });

  return parts;
}
/*
 * The sentences above that name a pull request, on GitLab - which calls it
 * a merge request - by the sentence GitHub, Forgejo and Gitea say. Each is
 * the same sentence with the host's word (CodeProductionReviewCopy.test
 * holds them to it).
 */
export const PRODUCTION_REVIEW_MERGE_REQUEST_COPY: Record<string, string> = {
  [PRODUCTION_REVIEW_COPY.pageDescription]: translationKey(
    "OneUptime reviews merge requests against what production shows of the code they change, posts each review on its merge request and keeps it here.",
  ),
  [PRODUCTION_REVIEW_COPY.statusOn]: translationKey(
    "A merge request from someone with write access is reviewed when it opens and each time it changes.",
  ),
  [PRODUCTION_REVIEW_COPY.statusOffNoCommands]: translationKey(
    "Merge requests are reviewed only when someone asks for one here.",
  ),
  [PRODUCTION_REVIEW_COPY.statusOnOthersAsk]: translationKey(
    "A merge request from anyone else is reviewed only when someone asks for it here.",
  ),
  [PRODUCTION_REVIEW_COPY.statusNotConnectedHost]: translationKey(
    "This repository's connection to {{host}} does not work, so its merge requests are not reviewed.",
  ),
  [PRODUCTION_REVIEW_COPY.listTitle]: translationKey("Merge Requests"),
  [PRODUCTION_REVIEW_COPY.emptyTitle]: translationKey(
    "No merge request reviewed yet",
  ),
  [PRODUCTION_REVIEW_COPY.emptyDescription]: translationKey(
    "Each merge request's latest review shows up here.",
  ),
  [PRODUCTION_REVIEW_COPY.pullRequestFallbackTitle]: translationKey(
    "Merge request {{label}}",
  ),
  [PRODUCTION_REVIEW_COPY.nothingFound]: translationKey(
    "Nothing in production runs through this merge request's changes: no exception thrown in them in the last {{days}} days, no traced operation or profiled function that runs them in the last hour, and no open incident or suspect deploy on their services.",
  ),
  [PRODUCTION_REVIEW_COPY.noCodeChanged]: translationKey(
    "This merge request changes no code production runs, so production has nothing to say about it.",
  ),
  [PRODUCTION_REVIEW_COPY.postedReview]: translationKey(
    "Posted on the merge request.",
  ),
  [PRODUCTION_REVIEW_COPY.postedLinkPublic]: translationKey(
    "This repository is public, so the merge request only links to this review.",
  ),
  [PRODUCTION_REVIEW_COPY.postedLinkChosen]: translationKey(
    "This repository's merge requests only link to their review, as its settings ask.",
  ),
  [PRODUCTION_REVIEW_COPY.postedNothing]: translationKey(
    "Nothing was posted on the merge request.",
  ),
  [PRODUCTION_REVIEW_COPY.commentRefused]: translationKey(
    "{{host}} did not let the access token comment on this merge request, so this review is only here.",
  ),
  [PRODUCTION_REVIEW_COPY.updatesOnChange]: translationKey(
    "Reviewed again each time the merge request changes.",
  ),
  [PRODUCTION_REVIEW_COPY.updatesWhenAsked]: translationKey(
    "Production review is off for this repository, so this merge request is reviewed again only when someone asks.",
  ),
  [PRODUCTION_REVIEW_COPY.notConnectedHost]: translationKey(
    "This repository's connection to {{host}} does not work now, so its merge requests cannot be reviewed again.",
  ),
  [PRODUCTION_REVIEW_ASK_COPY.button]: translationKey("Review a merge request"),
  [PRODUCTION_REVIEW_ASK_COPY.numberTitle]: translationKey(
    "Merge request number",
  ),
  [PRODUCTION_REVIEW_ASK_COPY.numberDescription]: translationKey(
    "Any open merge request in this repository, even one from a fork or a bot.",
  ),
  [PRODUCTION_REVIEW_ASK_COPY.numberHint]: translationKey(
    "Enter the number of a merge request, such as 12.",
  ),
  [PRODUCTION_REVIEW_AI_NOTES[ProductionReviewAiNoteCode.DailyLimit]]:
    translationKey(
      "OneUptime AI already read this merge request, or this repository, as often as it may today. The facts below are read every time.",
    ),
  [PRODUCTION_REVIEW_SETTINGS_COPY.switchTitle]: translationKey(
    "Review Merge Requests Against Production",
  ),
  [PRODUCTION_REVIEW_SETTINGS_COPY.switchDescription]: translationKey(
    "When someone with write access opens or updates a merge request, OneUptime comments with what production shows of the code it changes.",
  ),
  [PRODUCTION_REVIEW_SETTINGS_COPY.contentCardDescription]: translationKey(
    "What a production review posts on a merge request.",
  ),
  [PRODUCTION_REVIEW_CONTENT_COPY[ProductionReviewPullRequestContent.Link]
    .description]: translationKey(
    "Every merge request links to its review in OneUptime, which only members of this project can open. Nothing from production is posted.",
  ),
};

/*
 * Where a repository OneUptime no longer reaches is connected again, and
 * what the link there says - one fix, as the repository's Tasks name it:
 * a GitHub repository from Code's Repositories (Connect GitHub); one on
 * GitLab, Forgejo or Gitea from its own Settings - Replace access token
 * when its server refused the token, which is replaced right there, and
 * Go to Settings when its connection is gone, which they explain.
 */
export interface ProductionReviewReconnect {
  title: string;
  place: "repositories" | "settings";
}

export function getProductionReviewReconnect(repository: {
  provider?: string | null | undefined;
  connection?: { isTokenRefused?: boolean | undefined } | undefined;
}): ProductionReviewReconnect {
  if (CodeHost.readType(repository.provider) === CodeRepositoryType.GitHub) {
    return {
      title: PRODUCTION_REVIEW_COPY.connectGitHub,
      place: "repositories",
    };
  }

  return {
    title:
      repository.connection?.isTokenRefused === true
        ? CODE_REPOSITORY_CONNECTION_COPY.replaceButton
        : PRODUCTION_REVIEW_COPY.goToSettings,
    place: "settings",
  };
}

/*
 * A production review sentence in the host's words: on GitLab, its merge
 * request sentence; everywhere else, as written.
 */
export function inReviewHostWords(
  sentence: string,
  provider: string | null | undefined,
): string {
  if (CodeHost.getFacts(provider).pullRequestTerm !== "merge request") {
    return sentence;
  }

  return PRODUCTION_REVIEW_MERGE_REQUEST_COPY[sentence] || sentence;
}
