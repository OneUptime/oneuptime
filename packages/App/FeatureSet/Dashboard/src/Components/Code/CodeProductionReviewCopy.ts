import {
  CodeTaskOriginJSON,
  CodeTaskOriginType,
} from "Common/Types/AI/CodeTask";
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
 * same ones. The review itself, and the rules the server applies to it, are
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
  statusNotConnectedLabel: string;
  statusNotConnected: string;
  gitHubOnly: string;
  connectGitHub: string;
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
  viewComment: string;
  updatesOnChange: string;
  updatesWhenAsked: string;
  updatesWhenAskedForAuthor: string;
  cannotReviewAgain: string;
  notConnected: string;
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
  // Off, and the GitHub App answers no command in the repository either.
  statusOffNoCommands: translationKey(
    "Pull requests are not reviewed against production.",
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
   * A repository that is not on GitHub (GitLab, Forgejo, Gitea, a Git
   * server): the GitHub App reviews pull requests, so none of its are.
   */
  gitHubOnly: translationKey(
    "Production reviews work in GitHub repositories only, for now: the OneUptime GitHub App reviews each pull request against production. Ask AI about a change in this repository from its Tasks.",
  ),
  // Repositories, where GitHub is connected - as a task's blocker links it.
  connectGitHub: translationKey("Connect GitHub"),
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
    "Its author cannot write to this repository, so it is reviewed again only when someone with write access asks.",
  ),
  cannotReviewAgain: translationKey(
    "You can read this review. Reviewing it again takes permission to edit the repository - ask a project admin for it.",
  ),
  notConnected: translationKey(
    "This repository is no longer connected through the GitHub App, so its pull requests cannot be reviewed again.",
  ),
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
   * line says what it is for, the field's what empty means - the box names
   * the default it stands for.
   */
  providerCardTitle: translationKey("Production Review LLM Provider"),
  providerCardDescription: translationKey(
    "The LLM provider OneUptime AI reads pull requests with in production reviews.",
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
 * The pull request a review is of, by its number, from what started it
 * ("#42", a GitHub pull request) - none for anything else.
 */
export function getReviewedPullRequestNumber(
  origin: CodeTaskOriginJSON | undefined,
): number | null {
  if (
    !origin ||
    origin.type !== CodeTaskOriginType.GitHubPullRequest ||
    !origin.label.startsWith("#")
  ) {
    return null;
  }

  const number: number = Number(origin.label.substring(1));

  return Number.isInteger(number) && number > 0 ? number : null;
}

// Which sentence says what the pull request shows of a review.
export function getProductionReviewPostingSentence(
  report: Pick<ProductionReviewReport, "posting" | "isPublicRepository">,
): string {
  if (report.posting === ProductionReviewPosting.Review) {
    return PRODUCTION_REVIEW_COPY.postedReview;
  }

  if (report.posting === ProductionReviewPosting.Link) {
    return report.isPublicRepository === false
      ? PRODUCTION_REVIEW_COPY.postedLinkChosen
      : PRODUCTION_REVIEW_COPY.postedLinkPublic;
  }

  return PRODUCTION_REVIEW_COPY.postedNothing;
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
): string {
  if (report.codeFileCount === 0) {
    return translator.translateText(PRODUCTION_REVIEW_COPY.noCodeChanged) || "";
  }

  if (report.services.length === 0 && report.noServicesReason) {
    return translator.translateText(PRODUCTION_REVIEW_COPY.noServices) || "";
  }

  return translator.translateTemplate(PRODUCTION_REVIEW_COPY.nothingFound, {
    days: translator.formatNumber(PRODUCTION_REVIEW_WINDOWS.exceptionsDays),
  });
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
