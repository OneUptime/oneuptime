import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import { toTracesExplorerQueryParams } from "../../../../Utils/Telemetry/CrossSignalScope";
import {
  PRODUCTION_REVIEW_COMMENT_MARKER,
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewDataChange,
  ProductionReviewDataImpactJSON,
  ProductionReviewDataServiceJSON,
  ProductionReviewDataStagingJSON,
  ProductionReviewDeployJSON,
  ProductionReviewExceptionJSON,
  ProductionReviewHotFunctionJSON,
  ProductionReviewIncidentJSON,
  ProductionReviewOperationJSON,
  ProductionReviewOperationMatch,
  ProductionReviewPointJSON,
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewSection,
  ProductionReviewServiceJSON,
  ProductionReviewUtil,
  ProductionReviewWhere,
} from "../../../../Types/CodeRepository/ProductionReview";
import {
  ProductionReviewLeakHeldBeforeJSON,
  ProductionReviewLeakJSON,
  ProductionReviewLeakProductionJSON,
  ProductionReviewLeakSuggestionJSON,
  ProductionReviewSensitiveDataJSON,
  ProductionReviewSensitiveDataUtil,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataPosting,
} from "../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import { PullRequestTerm } from "../../../../Types/CodeRepository/CodeHost";
import { GitHubCheckConclusion } from "../GitHub/GitHubCheckRuns";
import { withArticle } from "./SensitiveData/SensitiveDataWords";

/*
 * THE PRODUCTION REVIEW COMMENT, AS GITHUB, GITLAB, FORGEJO AND GITEA SHOW IT.
 *
 * Their markdown is GitHub's for all this comment uses - headings, bold,
 * code spans, links, tables, <sub> - and each names a pull request its own
 * way (a GitLab merge request), which the comment says as its host does.
 *
 * One comment per pull request, edited in place on every review, so it is
 * written to be read again and again: what production says about this
 * change first, the facts it comes from after, and nothing when there is
 * nothing to say. Pure string building, so a test can pin every word.
 *
 * Every value in it that OneUptime did not write - a service's name, an
 * exception's type, an operation's name, a function, a path, a version,
 * OneUptime AI's words - is placed with FeedMarkdown's mdText, escaped for
 * where it sits (a sentence, a table cell, a code span, a link's words or
 * address), and has every "@" broken by an invisible word joiner first: a
 * GitHub mention in a comment notifies whoever it names, and a mention of
 * this app would be read as a command (GitHubCommandParser ignores this
 * app's own comments as well, but that is one guard, not two). The comment
 * names the command it suggests in a code span, where nothing is read as a
 * mention. A web address in any of them is broken the same way, so it shows
 * as text and is no link: OneUptime AI reads text other people wrote, and
 * neither it nor a name telemetry sent may point a reader anywhere. And in
 * a table row a "|" would start a cell of its own - even inside a code span,
 * since GitHub splits a row before it reads what is in it - so there it is
 * shown as a broken bar.
 */

// GitHub's "@" never opens a mention when this follows it.
const WORD_JOINER: string = "⁠";

// How many of each part the comment lists; the rest are in OneUptime.
export const MAX_LISTED_IN_COMMENT: number = 5;

export interface ProductionReviewCommentInput {
  report: ProductionReviewReport;
  // What the comment shows: the review, or a link to it.
  posting: ProductionReviewPosting.Review | ProductionReviewPosting.Link;
  // The review's page in Code.
  reviewUrl: string;
  // The Dashboard's address, and the project's id, for links into OneUptime.
  dashboardUrl: string;
  projectId: string;
  // The product's name, as a licence may rename it.
  productName: string;
  /*
   * The command that asks for a review on the host ("@oneuptime production
   * review", GitHub's), for the footer to suggest; null where there is none
   * or it is not known.
   */
  reviewCommand: string | null;
  // Whether the pull request's next push is reviewed on its own.
  updatesOnPush: boolean;
  isPublicRepository: boolean | null;
  // The host's word for a pull request; "pull request" when unsaid.
  pullRequestTerm?: PullRequestTerm | undefined;
  /*
   * A host OneUptime reads no commands from (GitLab, Forgejo, Gitea): the
   * footer says to press Review again in OneUptime, with a link to it.
   */
  asksAgainInProduct?: boolean | undefined;
  /*
   * What the comment shows of the Sensitive data section
   * (ProductionReviewUtil.getSensitiveDataPosting): everything, only what
   * the diff shows, or nothing. Unset: worked out from `posting` and
   * whether the repository is public - none for a link.
   */
  sensitiveDataPosting?: SensitiveDataPosting | undefined;
}

/*
 * What a review's GitHub check run says: its conclusion - success when
 * the review has nothing to say, neutral when there is something worth a
 * look, failure only when the change leaks sensitive data the repository
 * asked its check to fail on (#10376) - a title, and a summary that holds
 * what the comment holds: the review, or only a link to it.
 */
export interface ProductionReviewCheckRunText {
  conclusion: GitHubCheckConclusion;
  title: string;
  summary: string;
}

// The titles a review's check run has.
export const PRODUCTION_REVIEW_CHECK_TITLES: {
  worthALook: string;
  nothingFound: string;
  sensitiveDataFails: string;
  sensitiveData: string;
  sensitiveDataAndProduction: string;
  noLeakFails: string;
} = {
  worthALook: "Something in production is worth a look",
  nothingFound: "Nothing in production runs through these changes",
  sensitiveDataFails: "Sensitive data in these changes fails this check",
  sensitiveData: "Sensitive data in these changes is worth a look",
  sensitiveDataAndProduction:
    "Sensitive data in these changes, and production, are worth a look",
  // A commit status's description on GitLab, Forgejo and Gitea.
  noLeakFails: "No leak of sensitive data in these changes fails this check",
};

/*
 * What the comment shows of a review's Sensitive data section, as its
 * input says - or, when it says nothing, as `posting` and the repository's
 * visibility say: a link shows none of it.
 */
export function getSensitiveDataPostingOf(
  input: Pick<
    ProductionReviewCommentInput,
    "sensitiveDataPosting" | "posting" | "isPublicRepository"
  >,
): SensitiveDataPosting {
  if (input.sensitiveDataPosting) {
    return input.sensitiveDataPosting;
  }

  if (input.posting === ProductionReviewPosting.Link) {
    return SensitiveDataPosting.None;
  }

  return input.isPublicRepository === false
    ? SensitiveDataPosting.Full
    : SensitiveDataPosting.DiffOnly;
}

// A fence no backtick run of `lines` can close: three backticks, or more.
export function fenceFor(lines: ReadonlyArray<string>): string {
  let longest: number = 0;

  for (const line of lines) {
    let run: number = 0;

    for (const character of line) {
      run = character === "`" ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }

  return "`".repeat(Math.max(3, longest + 1));
}

/*
 * A suggested change as a diff block, indented under a list item: each
 * line as the change has it, minus, and as it would be, plus. Code is
 * shown as written: a fence is where nothing in it is read as Markdown, a
 * mention or a link.
 */
export function suggestionDiff(
  suggestion: ProductionReviewLeakSuggestionJSON,
  indent: string,
): string {
  const lines: Array<string> = [
    ...suggestion.original.map((line: string): string => {
      return `- ${line}`;
    }),
    ...suggestion.replacement.map((line: string): string => {
      return `+ ${line}`;
    }),
  ].map((line: string): string => {
    return line.slice(0, SENSITIVE_DATA_LIMITS.maxSuggestionLineLength + 2);
  });

  if (lines.length === 0) {
    return "";
  }

  const fence: string = fenceFor(lines);

  return [`${fence}diff`, ...lines, fence]
    .map((line: string): string => {
      return `${indent}${line}`;
    })
    .join("\n");
}

// The input's word for a pull request.
function termOf(input: {
  pullRequestTerm?: PullRequestTerm | undefined;
}): PullRequestTerm {
  return input.pullRequestTerm || "pull request";
}

/*
 * Text from outside OneUptime, made safe for a GitHub comment before it is
 * escaped for its place: one line, held to a length, no "@" that could
 * mention anyone, and every web address broken (an invisible word joiner
 * after "://" and in "www.") so it shows as text and is never a link.
 */
export function githubSafeText(
  value: string | null | undefined,
  maxLength: number,
): string {
  const oneLine: string = (value || "")
    .slice(0, maxLength * 4)
    .split(/\s+/)
    .join(" ")
    .trim();

  const codePoints: Array<string> = Array.from(oneLine);
  const cut: string =
    codePoints.length > maxLength
      ? `${codePoints.slice(0, maxLength - 1).join("")}…`
      : oneLine;

  return cut
    .split("@")
    .join(`@${WORD_JOINER}`)
    .split("://")
    .join(`:${WORD_JOINER}//`)
    .split("www.")
    .join(`www${WORD_JOINER}.`);
}

// Words OneUptime AI wrote, for a GitHub comment: as any text from outside.
export function githubSafeAiText(
  value: string | null | undefined,
  maxLength: number,
): string {
  return githubSafeText(value, maxLength);
}

// Text from outside OneUptime for a table row: no "|" splits its cell.
export function githubSafeCell(
  value: string | null | undefined,
  maxLength: number,
): string {
  return githubSafeText(value, maxLength).split("|").join("¦");
}

// 1,240 - in the comment's own language, English.
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Math.round(value).toLocaleString("en-US");
}

// "840 ms", "1.2 s", "2.5 min".
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "0 ms";
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }

  if (milliseconds < 60000) {
    return `${(milliseconds / 1000).toFixed(1).replace(/\.0$/, "")} s`;
  }

  return `${(milliseconds / 60000).toFixed(1).replace(/\.0$/, "")} min`;
}

// "0.4%", "12%", "under 0.1%".
export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }

  if (value < 0.1) {
    return "under 0.1%";
  }

  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }

  return `${Math.round(value)}%`;
}

// "5 min", "2 h", "3 days" before `now`.
export function formatAge(at: string | undefined, now: Date): string {
  if (!at) {
    return "";
  }

  const time: number = new Date(at).getTime();

  if (Number.isNaN(time)) {
    return "";
  }

  const minutes: number = Math.max(
    0,
    Math.floor((now.getTime() - time) / 60000),
  );

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours: number = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} h ago`;
  }

  const days: number = Math.floor(hours / 24);

  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/*
 * An address without the slashes it ends with, read one character at a
 * time from the end: in time in line with the address, whatever it holds.
 */
export function withoutTrailingSlashes(url: string): string {
  let end: number = url.length;

  while (end > 0 && url[end - 1] === "/") {
    end--;
  }

  return url.substring(0, end);
}

// "a, b and c" of pieces already Markdown.
function listing(items: Array<MarkdownText>): MarkdownText {
  if (items.length <= 1) {
    return items[0] || FeedMarkdown.empty();
  }

  return mdText`${FeedMarkdown.join(items.slice(0, -1))} and ${items[
    items.length - 1
  ]!}`;
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

// How a service uses a table: the column in its queries, or reads and writes.
export function describeDataUse(
  service: ProductionReviewDataServiceJSON,
): string {
  if (service.columnQueryCount && service.columnQueryCount > 0) {
    return `names the column in ${plural(service.columnQueryCount, "query", "queries")} of the last day`;
  }

  return service.reads && service.writes
    ? "reads and writes it"
    : service.writes
      ? "writes it"
      : "reads it";
}

// What a change does to its table, in words: "Drops column `total` of `public.orders`".
export function describeDataChangeMarkdown(
  impact: ProductionReviewDataImpactJSON,
): MarkdownText {
  const table: MarkdownText = FeedMarkdown.code(
    githubSafeText(impact.table, 120),
  );
  const column: MarkdownText = FeedMarkdown.code(
    githubSafeText(impact.column || "", 120),
  );
  const newName: MarkdownText = FeedMarkdown.code(
    githubSafeText(impact.newName || "", 120),
  );

  switch (impact.change) {
    case ProductionReviewDataChange.DropTable:
      return mdText`Drops ${table}`;
    case ProductionReviewDataChange.RenameTable:
      return mdText`Renames ${table} to ${newName}`;
    case ProductionReviewDataChange.DropColumn:
      return mdText`Drops column ${column} of ${table}`;
    case ProductionReviewDataChange.RenameColumn:
      return mdText`Renames column ${column} of ${table} to ${newName}`;
    case ProductionReviewDataChange.AlterColumn:
      return mdText`Changes the type of column ${column} of ${table}`;
    default:
      return mdText`Changes the dbt model that builds ${table}`;
  }
}

// How a table's copy on staging differs: its rows, its columns, and what its checks read there.
export function describeStagingMarkdown(
  staging: ProductionReviewDataStagingJSON,
): MarkdownText {
  const parts: Array<MarkdownText> = [];

  if (staging.stagingRows !== null && staging.productionRows !== null) {
    parts.push(
      mdText`${String(staging.stagingRows)} rows there, ${String(staging.productionRows)} in production`,
    );
  }

  for (const difference of staging.columnDifferences.slice(0, 3)) {
    parts.push(mdText`${githubSafeText(difference, 160)}`);
  }

  for (const check of staging.checks.slice(0, 3)) {
    const name: string = githubSafeText(check.name, 80);

    parts.push(
      check.error
        ? mdText`check **${name}** could not run there: ${githubSafeText(check.error, 160)}`
        : mdText`check **${name}** reads ${check.staging === null ? "nothing" : String(check.staging)} there, ${check.production === null ? "nothing" : String(check.production)} in production`,
    );
  }

  if (!staging.areChecksRun) {
    parts.push(mdText`its checks were not run, as only a probe can reach it`);
  }

  return parts.length > 0
    ? mdText`on staging (${githubSafeText(staging.storeName, 80)}), ${FeedMarkdown.join(parts, ", ")}`
    : mdText`on staging (${githubSafeText(staging.storeName, 80)}) it looks the same`;
}

export default class ProductionReviewComposer {
  /*
   * The comment: the hidden marker, the heading, then the review or the
   * link to it, then a footer that says what was read and when.
   */
  public static compose(input: ProductionReviewCommentInput): string {
    const parts: Array<MarkdownText> = [
      ProductionReviewComposer.heading(input),
      ProductionReviewComposer.sensitiveDataSection(input),
      input.posting === ProductionReviewPosting.Link
        ? ProductionReviewComposer.linkBody(input)
        : ProductionReviewComposer.reviewBody(input),
      ProductionReviewComposer.footer(input),
    ];

    return [
      PRODUCTION_REVIEW_COMMENT_MARKER,
      ...parts
        .filter((part: MarkdownText): boolean => {
          return !part.isEmpty();
        })
        .map((part: MarkdownText): string => {
          return part.toString();
        }),
    ].join("\n\n");
  }

  /*
   * The review as its GitHub check run says it: what it concluded, a title
   * that says only whether production has something to say - which the
   * comment says too, on a public repository - and as its summary the
   * comment's body, the review or the link to it, and its footer: not the
   * comment's marker, nor its heading, which would only say again what the
   * check's own name says above it ("OneUptime production review").
   */
  public static composeCheckRun(
    input: ProductionReviewCommentInput,
  ): ProductionReviewCheckRunText {
    const summary: string = [
      ProductionReviewComposer.sensitiveDataSection(input),
      input.posting === ProductionReviewPosting.Link
        ? ProductionReviewComposer.linkBody(input)
        : ProductionReviewComposer.reviewBody(input),
      ProductionReviewComposer.footer(input),
    ]
      .filter((part: MarkdownText): boolean => {
        return !part.isEmpty();
      })
      .map((part: MarkdownText): string => {
        return part.toString();
      })
      .join("\n\n");

    return {
      ...ProductionReviewComposer.checkOutcome(input.report),
      summary,
    };
  }

  /*
   * What a review's check concludes, and its title: failure only when a
   * point of the Sensitive data section fails it - the repository asked -
   * neutral when the review says something, success when it says nothing.
   */
  public static checkOutcome(
    report: ProductionReviewReport,
  ): Omit<ProductionReviewCheckRunText, "summary"> {
    const hasProduction: boolean =
      ProductionReviewUtil.hasProductionSignal(report);
    const hasSensitiveData: boolean =
      ProductionReviewSensitiveDataUtil.getPoints(report.sensitiveData).length >
      0;

    if (ProductionReviewSensitiveDataUtil.failsCheck(report.sensitiveData)) {
      return {
        conclusion: GitHubCheckConclusion.Failure,
        title: PRODUCTION_REVIEW_CHECK_TITLES.sensitiveDataFails,
      };
    }

    if (hasSensitiveData) {
      return {
        conclusion: GitHubCheckConclusion.Neutral,
        title: hasProduction
          ? PRODUCTION_REVIEW_CHECK_TITLES.sensitiveDataAndProduction
          : PRODUCTION_REVIEW_CHECK_TITLES.sensitiveData,
      };
    }

    if (hasProduction) {
      return {
        conclusion: GitHubCheckConclusion.Neutral,
        title: PRODUCTION_REVIEW_CHECK_TITLES.worthALook,
      };
    }

    /*
     * A section that could not be read this time is no answer a check
     * should pass on: neutral, until a review reads it.
     */
    return {
      conclusion: (report.unreadSections || []).includes(
        ProductionReviewSection.SensitiveData,
      )
        ? GitHubCheckConclusion.Neutral
        : GitHubCheckConclusion.Success,
      title: PRODUCTION_REVIEW_CHECK_TITLES.nothingFound,
    };
  }

  /*
   * One plain sentence of what the review found: the outcome's summary, which
   * is what a reader of the run sees where the full review is not drawn.
   */
  public static summarize(
    report: ProductionReviewReport,
    term: PullRequestTerm = "pull request",
  ): string {
    if (!ProductionReviewUtil.hasSignal(report)) {
      return `Nothing in production runs through this ${term}'s changes.`;
    }

    const leaks: Array<ProductionReviewLeakJSON> =
      ProductionReviewSensitiveDataUtil.getPoints(report.sensitiveData);
    const failing: number = ProductionReviewSensitiveDataUtil.getFailingPoints(
      report.sensitiveData,
    ).length;
    const leakSentence: string =
      leaks.length === 0
        ? ""
        : failing > 0
          ? `Sensitive data: ${plural(leaks.length, "point", "points")}, ${plural(failing, "of which fails", "of which fail")} the check.`
          : `Sensitive data: ${plural(leaks.length, "point", "points")} to look at.`;

    if (!ProductionReviewUtil.hasProductionSignal(report)) {
      return leakSentence;
    }

    const found: Array<string> = [];

    if (report.exceptions.length > 0) {
      found.push(plural(report.exceptions.length, "exception", "exceptions"));
    }

    if (report.operations.length > 0) {
      found.push(plural(report.operations.length, "operation", "operations"));
    }

    if (report.hotFunctions.length > 0) {
      found.push(
        plural(report.hotFunctions.length, "hot function", "hot functions"),
      );
    }

    const incidents: number = ProductionReviewUtil.getNotableIncidents(
      report.incidents,
    ).length;

    if (incidents > 0) {
      found.push(plural(incidents, "incident", "incidents"));
    }

    if (report.suspectDeploys.length > 0) {
      found.push(
        plural(
          report.suspectDeploys.length,
          "suspect deploy",
          "suspect deploys",
        ),
      );
    }

    const tables: number = (report.dataImpact || []).length;

    if (tables > 0) {
      found.push(
        plural(tables, "watched table changed", "watched tables changed"),
      );
    }

    const last: string = found.pop() || "";
    const productionSentence: string = `Production review: ${
      found.length > 0 ? `${found.join(", ")} and ${last}` : last
    } in or around the changed code.`;

    return leakSentence
      ? `${productionSentence} ${leakSentence}`
      : productionSentence;
  }

  private static heading(input: ProductionReviewCommentInput): MarkdownText {
    return mdText`### 🔭 Production review by ${githubSafeText(
      input.productName,
      60,
    )}`;
  }

  /*
   * THE SENSITIVE DATA SECTION (#10376): what the change writes to
   * telemetry, does to a store or adds a column for, read from the diff -
   * first, as it is what the author can fix before anything merges. Each
   * point: where it is, what kind of data, whether it fails the check;
   * what it does, in OneUptime AI's words or OneUptime's own; what
   * production already knows of it, in a private repository's comment
   * only; the fix, and the change as a diff. Nothing when nothing was
   * found, or the comment shows none of it.
   */
  public static sensitiveDataSection(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const posting: SensitiveDataPosting = getSensitiveDataPostingOf(input);
    const section: ProductionReviewSensitiveDataJSON | undefined =
      input.report.sensitiveData;
    const points: Array<ProductionReviewLeakJSON> =
      ProductionReviewSensitiveDataUtil.getPoints(section);

    if (posting === SensitiveDataPosting.None || points.length === 0) {
      return FeedMarkdown.empty();
    }

    const isFull: boolean = posting === SensitiveDataPosting.Full;
    const failing: number =
      ProductionReviewSensitiveDataUtil.getFailingPoints(section).length;
    const now: Date = new Date(input.report.reviewedAt);
    const listed: Array<ProductionReviewLeakJSON> = points.slice(
      0,
      SENSITIVE_DATA_LIMITS.maxPointsInComment,
    );

    const title: MarkdownText =
      failing > 0
        ? mdText`**Sensitive data** · ${plural(failing, "leak fails", "leaks fail")} this check`
        : mdText`**Sensitive data** · ${plural(points.length, "leak", "leaks")} to look at before this merges`;

    const items: Array<MarkdownText> = listed.map(
      (point: ProductionReviewLeakJSON): MarkdownText => {
        return ProductionReviewComposer.sensitiveDataPoint(point, isFull, now);
      },
    );

    const notes: Array<MarkdownText> = [];
    const notShown: number =
      points.length - listed.length + (section?.moreCount || 0);

    if (notShown > 0) {
      notes.push(
        mdText`${FeedMarkdown.link(
          `And ${plural(notShown, "more", "more")} in ${githubSafeText(input.productName, 60)}`,
          input.reviewUrl,
        )}.`,
      );
    }

    if ((section?.droppedCount || 0) > 0) {
      notes.push(
        mdText`<sub>${githubSafeText(input.productName, 60)} AI read ${plural(section!.droppedCount, "more point the rules found", "more points the rules found")} as no leak, and left ${section!.droppedCount === 1 ? "it" : "them"} out.</sub>`,
      );
    }

    if (failing > 0) {
      notes.push(
        mdText`<sub>No leak after all? Write ${FeedMarkdown.code("oneuptime:not-sensitive")} on its line, or in a comment on the line above it, and say why in the review.</sub>`,
      );
    }

    return FeedMarkdown.join(
      [title, FeedMarkdown.join(items, "\n\n"), ...notes],
      "\n\n",
    );
  }

  /*
   * The points whose suggested change can go on their line, as a GitHub
   * suggestion: a change to one line, in the order the section lists them,
   * as many as the comment lists.
   */
  public static getSuggestedPoints(
    report: ProductionReviewReport,
  ): Array<ProductionReviewLeakJSON> {
    return ProductionReviewSensitiveDataUtil.getPoints(report.sensitiveData)
      .slice(0, SENSITIVE_DATA_LIMITS.maxPointsInComment)
      .filter((point: ProductionReviewLeakJSON): boolean => {
        return Boolean(
          point.suggestion &&
            point.suggestion.startLine === point.suggestion.endLine &&
            point.suggestion.endLine > 0,
        );
      });
  }

  // The review the suggestions are posted in: what they are, in a line.
  public static composeSuggestionsBody(
    input: ProductionReviewCommentInput,
    count: number,
  ): string {
    return mdText`**Sensitive data** · ${githubSafeText(
      input.productName,
      60,
    )}'s production review suggests ${plural(count, "change", "changes")} on the lines below, each one you can commit.`.toString();
  }

  /*
   * One point's suggestion, on its line: what it is, what it does, the fix
   * and the change as a suggestion block - what the line becomes. Only
   * what the diff shows: a suggestion is read wherever the pull request is.
   */
  public static composeSuggestion(point: ProductionReviewLeakJSON): string {
    const suggestion: ProductionReviewLeakSuggestionJSON | undefined =
      point.suggestion;
    const replacement: Array<string> = (suggestion?.replacement || []).map(
      (line: string): string => {
        return line.slice(0, SENSITIVE_DATA_LIMITS.maxSuggestionLineLength);
      },
    );
    const fence: string = fenceFor(replacement);
    const what: string = point.dataTypeNames.slice(0, 2).join(", ");
    const header: MarkdownText = FeedMarkdown.join(
      [
        mdText`**Sensitive data**`,
        ...(what ? [mdText`${githubSafeText(what, 120)}`] : []),
        ...(point.failsCheck ? [mdText`fails the check`] : []),
      ],
      " · ",
    );

    return [
      header.toString(),
      FeedMarkdown.textWithCode(
        githubSafeAiText(point.text, SENSITIVE_DATA_LIMITS.maxTextLength),
      ).toString(),
      mdText`Fix: ${FeedMarkdown.textWithCode(
        githubSafeAiText(point.fix, SENSITIVE_DATA_LIMITS.maxFixLength),
      )}`.toString(),
      [`${fence}suggestion`, ...replacement, fence].join("\n"),
    ].join("\n\n");
  }

  // One point of the Sensitive data section, as a list item.
  private static sensitiveDataPoint(
    point: ProductionReviewLeakJSON,
    isFull: boolean,
    now: Date,
  ): MarkdownText {
    const what: string =
      point.dataTypeNames.length > 0
        ? point.dataTypeNames.slice(0, 2).join(", ")
        : point.isWholeObject
          ? "Whole object"
          : "";
    const facts: Array<MarkdownText> = [
      mdText`**${FeedMarkdown.code(githubSafeText(point.path, 200))} line ${String(point.line)}**`,
    ];

    if (what) {
      facts.push(mdText`${githubSafeText(what, 120)}`);
    }

    if (point.failsCheck) {
      facts.push(mdText`**fails the check**`);
    }

    const lines: Array<MarkdownText> = [
      FeedMarkdown.join(facts, " · "),
      FeedMarkdown.textWithCode(
        githubSafeAiText(point.text, SENSITIVE_DATA_LIMITS.maxTextLength),
      ),
    ];

    if (isFull && point.production) {
      const known: MarkdownText = ProductionReviewComposer.productionKnows(
        point.production,
        now,
      );

      if (!known.isEmpty()) {
        lines.push(known);
      }
    }

    lines.push(
      mdText`Fix: ${FeedMarkdown.textWithCode(
        githubSafeAiText(point.fix, SENSITIVE_DATA_LIMITS.maxFixLength),
      )}`,
    );

    const item: string = `- ${lines
      .map((line: MarkdownText): string => {
        return line.toString();
      })
      .join("\n  ")}`;

    const diff: string = point.suggestion
      ? suggestionDiff(point.suggestion, "  ")
      : "";

    return FeedMarkdown.asMarkdown(diff ? `${item}\n\n${diff}` : item);
  }

  /*
   * What production knows of a point, in a sentence or two: where the
   * service's telemetry held the same data lately, the scrub rule that
   * masks it at ingest, the store a resource is and what it holds.
   */
  private static productionKnows(
    production: ProductionReviewLeakProductionJSON,
    now: Date,
  ): MarkdownText {
    const parts: Array<MarkdownText> = [];
    const held: Array<ProductionReviewLeakHeldBeforeJSON> =
      production.heldBefore || [];

    if (held.length > 0) {
      const places: Array<MarkdownText> = held.map(
        (place: ProductionReviewLeakHeldBeforeJSON): MarkdownText => {
          const age: string = formatAge(place.lastSeenAt, now);

          return mdText`**${githubSafeText(place.serviceName, 80)}**'s ${githubSafeText(
            place.storeKind.toLowerCase(),
            40,
          )} held ${githubSafeText(
            withArticle(place.dataTypeName || "sensitive data"),
            120,
          )} at ${FeedMarkdown.code(githubSafeText(place.location, 200))}${
            age ? ` ${age}` : ""
          }`;
        },
      );

      parts.push(mdText`Production has held this before: ${listing(places)}.`);
    }

    if (production.maskedAtIngestBy !== undefined) {
      parts.push(
        production.maskedAtIngestBy
          ? mdText`Masked at ingest by the scrub rule **${githubSafeText(production.maskedAtIngestBy, 120)}**, but written by the code: whatever reads it before ingest reads it whole.`
          : mdText`Masked at ingest, but written by the code: whatever reads it before ingest reads it whole.`,
      );
    }

    if (production.store) {
      const holds: string = production.store.dataTypeNames
        .slice(0, 3)
        .join(", ");

      parts.push(
        holds
          ? mdText`It is the store **${githubSafeText(production.store.name, 120)}**, which holds ${githubSafeText(production.store.sensitivity, 40)} data: ${githubSafeText(holds, 200)}.`
          : mdText`It is the store **${githubSafeText(production.store.name, 120)}**, which holds ${githubSafeText(production.store.sensitivity, 40)} data.`,
      );
    }

    return FeedMarkdown.join(parts, " ");
  }

  /*
   * The link-only comment: no fact of production in it. Where the comment
   * shows the Sensitive data section above it, the sentence is about
   * production alone; where it does not, sensitive data is something worth
   * a look too.
   */
  private static linkBody(input: ProductionReviewCommentInput): MarkdownText {
    const isSensitiveDataShown: boolean =
      getSensitiveDataPostingOf(input) !== SensitiveDataPosting.None;
    const hasSignal: boolean = isSensitiveDataShown
      ? ProductionReviewUtil.hasProductionSignal(input.report)
      : ProductionReviewUtil.hasSignal(input.report);

    const finding: MarkdownText = hasSignal
      ? mdText`${githubSafeText(input.productName, 60)} reviewed this ${termOf(input)} against production and found something worth a look in the code it changes.`
      : mdText`${githubSafeText(input.productName, 60)} reviewed this ${termOf(input)} against production and found nothing that runs through its changes.`;

    const where: MarkdownText = input.isPublicRepository
      ? mdText`This repository is public, so the review is in ${githubSafeText(
          input.productName,
          60,
        )}, for members of the project: **${FeedMarkdown.link(
          "Open the production review",
          input.reviewUrl,
        )}**.`
      : mdText`The review is in ${githubSafeText(
          input.productName,
          60,
        )}, for members of the project: **${FeedMarkdown.link(
          "Open the production review",
          input.reviewUrl,
        )}**.`;

    return mdText`${finding} ${where}`;
  }

  private static reviewBody(input: ProductionReviewCommentInput): MarkdownText {
    const report: ProductionReviewReport = input.report;

    // Production's part: the Sensitive data section above it is the diff's.
    if (!ProductionReviewUtil.hasProductionSignal(report)) {
      return ProductionReviewComposer.nothingFound(input);
    }

    const facts: Array<MarkdownText> = [
      ProductionReviewComposer.dataSection(input),
      ProductionReviewComposer.exceptionsSection(input),
      ProductionReviewComposer.operationsSection(input),
      ProductionReviewComposer.hotFunctionsSection(input),
      ProductionReviewComposer.incidentsSection(input),
      ProductionReviewComposer.deploysSection(input),
    ].filter((part: MarkdownText): boolean => {
      return !part.isEmpty();
    });

    const factsMarkdown: MarkdownText = FeedMarkdown.join(facts, "\n\n");
    const lead: MarkdownText = ProductionReviewComposer.lead(input);

    if (report.points.length === 0) {
      return FeedMarkdown.join(
        [lead, factsMarkdown].filter((part: MarkdownText): boolean => {
          return !part.isEmpty();
        }),
        "\n\n",
      );
    }

    /*
     * With OneUptime AI's read on top, the facts it read from are folded
     * under it: the comment stays short, and every number is one click away.
     */
    /*
     * Its words as text, with the names of code it puts in backticks kept
     * as code: nothing else in them is read as Markdown.
     */
    const points: MarkdownText = FeedMarkdown.bulletList(
      report.points.map((point: ProductionReviewPointJSON): MarkdownText => {
        return FeedMarkdown.textWithCode(githubSafeAiText(point.text, 400));
      }),
    );

    return FeedMarkdown.join(
      [
        lead,
        mdText`**What to watch**`,
        points,
        mdText`<details><summary>What production shows</summary>`,
        factsMarkdown,
        mdText`</details>`,
      ].filter((part: MarkdownText): boolean => {
        return !part.isEmpty();
      }),
      "\n\n",
    );
  }

  // Which services the changed code runs in, and how busy they are.
  private static lead(input: ProductionReviewCommentInput): MarkdownText {
    const services: Array<ProductionReviewServiceJSON> =
      input.report.services.slice(0, 3);

    if (services.length === 0) {
      return FeedMarkdown.empty();
    }

    const named: Array<MarkdownText> = services.map(
      (service: ProductionReviewServiceJSON): MarkdownText => {
        return mdText`**${githubSafeText(service.name, 80)}**`;
      },
    );

    const more: number = input.report.services.length - services.length;

    if (more > 0) {
      named.push(mdText`${plural(more, "more service", "more services")}`);
    }

    if (services.length === 1 && services[0]!.requestCount !== undefined) {
      const service: ProductionReviewServiceJSON = services[0]!;

      return mdText`This ${termOf(input)} changes code that runs in production in ${named[0]!} (${formatCount(
        service.requestCount || 0,
      )} spans in the last hour${
        service.p99Ms !== undefined
          ? `, p99 ${formatDuration(service.p99Ms)}`
          : ""
      }).`;
    }

    return mdText`This ${termOf(input)} changes code that runs in production in ${listing(
      named,
    )}.`;
  }

  private static nothingFound(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const report: ProductionReviewReport = input.report;

    if (report.codeFileCount === 0) {
      return mdText`This ${termOf(input)} changes no code production runs, so production has nothing to say about it.`;
    }

    if (report.services.length === 0 && report.noServicesReason) {
      return mdText`Production has nothing to say about this ${termOf(input)} yet: no service ${githubSafeText(
        input.productName,
        60,
      )} monitors is known to run this repository's code.`;
    }

    return mdText`Nothing in production runs through this ${termOf(input)}'s changes: no exception thrown in them in the last ${PRODUCTION_REVIEW_WINDOWS.exceptionsDays} days, no traced operation or profiled function that runs them in the last hour, and no open incident or suspect deploy on their services.`;
  }

  private static linkTo(
    input: ProductionReviewCommentInput,
    path: string,
  ): string {
    return `${withoutTrailingSlashes(input.dashboardUrl)}/${input.projectId}/${path}`;
  }

  private static describeWhere(
    exception: ProductionReviewExceptionJSON,
  ): MarkdownText {
    const location: string = exception.line
      ? `${exception.path}:${exception.line}`
      : exception.path;

    const inFunction: MarkdownText = exception.functionName
      ? mdText` in ${FeedMarkdown.code(
          githubSafeCell(`${exception.functionName}()`, 120),
        )}`
      : FeedMarkdown.empty();

    const closeness: string =
      exception.where === ProductionReviewWhere.ChangedLine
        ? "a line this changes"
        : exception.where === ProductionReviewWhere.ChangedFunction
          ? "a function this changes"
          : "a file this changes";

    return mdText`${FeedMarkdown.code(
      githubSafeCell(location, 160),
    )}${inFunction} · ${closeness}`;
  }

  private static exceptionsSection(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const exceptions: Array<ProductionReviewExceptionJSON> =
      input.report.exceptions.slice(0, MAX_LISTED_IN_COMMENT);

    if (exceptions.length === 0) {
      return FeedMarkdown.empty();
    }

    const now: Date = new Date(input.report.reviewedAt);

    const rows: Array<MarkdownText> = exceptions.map(
      (exception: ProductionReviewExceptionJSON): MarkdownText => {
        const name: MarkdownText = FeedMarkdown.link(
          FeedMarkdown.code(githubSafeCell(exception.type, 80)),
          ProductionReviewComposer.linkTo(
            input,
            `exceptions/${exception.exceptionId}`,
          ),
        );

        const tags: string = [
          exception.isNew ? "new" : "",
          exception.isUnhandled ? "unhandled" : "",
        ]
          .filter(Boolean)
          .join(", ");

        const count: string = exception.isWindowCount
          ? formatCount(exception.occurrences)
          : `${formatCount(exception.occurrences)} (all time)`;

        return mdText`| ${name}${tags ? ` · ${tags}` : ""} | ${ProductionReviewComposer.describeWhere(
          exception,
        )} | ${count} | ${formatAge(exception.lastSeenAt, now)} |`;
      },
    );

    return FeedMarkdown.join(
      [
        mdText`**Exceptions thrown in the changed code** · last ${PRODUCTION_REVIEW_WINDOWS.exceptionsDays} days`,
        FeedMarkdown.join(
          [
            mdText`| Exception | Where | Count | Last seen |`,
            mdText`| --- | --- | ---: | --- |`,
            ...rows,
          ],
          "\n",
        ),
        ProductionReviewComposer.more(
          input.report.exceptions.length,
          exceptions.length,
          "exception",
          "exceptions",
          input,
        ),
      ].filter((part: MarkdownText): boolean => {
        return !part.isEmpty();
      }),
      "\n\n",
    );
  }

  private static describeOperationMatch(
    operation: ProductionReviewOperationJSON,
  ): string {
    switch (operation.matchedBy) {
      case ProductionReviewOperationMatch.CodeAttribute:
        return "its spans name a file this changes";
      case ProductionReviewOperationMatch.Route:
        return "serves a route this changes";
      default:
        return "named after a function this changes";
    }
  }

  private static operationsSection(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const operations: Array<ProductionReviewOperationJSON> =
      input.report.operations.slice(0, MAX_LISTED_IN_COMMENT);

    if (operations.length === 0) {
      return FeedMarkdown.empty();
    }

    const reviewedAt: Date = new Date(input.report.reviewedAt);
    const startTime: Date = new Date(
      reviewedAt.getTime() - PRODUCTION_REVIEW_WINDOWS.tracesHours * 3600000,
    );

    const rows: Array<MarkdownText> = operations.map(
      (operation: ProductionReviewOperationJSON): MarkdownText => {
        const params: URLSearchParams = new URLSearchParams();
        const query: Record<string, string> = toTracesExplorerQueryParams({
          serviceIds: [operation.serviceId],
          startTime,
          endTime: reviewedAt,
        }).params;

        for (const key of Object.keys(query)) {
          params.set(key, query[key] as string);
        }

        const errorRate: string =
          operation.requestCount > 0
            ? formatPercent(
                (operation.errorCount / operation.requestCount) * 100,
              )
            : "0%";

        return mdText`| ${FeedMarkdown.code(
          githubSafeCell(operation.name, 120),
        )} | ${FeedMarkdown.link(
          githubSafeCell(operation.serviceName, 80),
          ProductionReviewComposer.linkTo(input, `traces?${params.toString()}`),
        )} | ${formatCount(operation.requestCount)} | ${errorRate} | ${formatDuration(
          operation.p95Ms,
        )} | ${ProductionReviewComposer.describeOperationMatch(operation)} |`;
      },
    );

    return FeedMarkdown.join(
      [
        mdText`**Operations that run the changed code** · last hour`,
        FeedMarkdown.join(
          [
            mdText`| Operation | Service | Spans | Errors | p95 | Why |`,
            mdText`| --- | --- | ---: | ---: | ---: | --- |`,
            ...rows,
          ],
          "\n",
        ),
        ProductionReviewComposer.more(
          input.report.operations.length,
          operations.length,
          "operation",
          "operations",
          input,
        ),
      ].filter((part: MarkdownText): boolean => {
        return !part.isEmpty();
      }),
      "\n\n",
    );
  }

  private static hotFunctionsSection(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const functions: Array<ProductionReviewHotFunctionJSON> =
      input.report.hotFunctions.slice(0, MAX_LISTED_IN_COMMENT);

    if (functions.length === 0) {
      return FeedMarkdown.empty();
    }

    const lines: Array<MarkdownText> = functions.map(
      (hot: ProductionReviewHotFunctionJSON): MarkdownText => {
        return mdText`${FeedMarkdown.code(
          githubSafeText(`${hot.functionName}()`, 120),
        )} in ${FeedMarkdown.code(
          githubSafeText(hot.path, 160),
        )} takes ${formatPercent(hot.totalPercent)} of ${githubSafeText(
          hot.serviceName,
          80,
        )}'s ${githubSafeText(hot.profileKind, 40)} (${formatPercent(
          hot.selfPercent,
        )} in its own code)${hot.isChangedFunction ? ", and this changes it" : ""}.`;
      },
    );

    return FeedMarkdown.join(
      [
        mdText`**Hot functions in the changed code** · profiles, last hour`,
        FeedMarkdown.bulletList(lines),
      ],
      "\n\n",
    );
  }

  private static incidentsSection(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const notable: Array<ProductionReviewIncidentJSON> =
      ProductionReviewUtil.getNotableIncidents(input.report.incidents).slice(
        0,
        MAX_LISTED_IN_COMMENT,
      );

    if (notable.length === 0) {
      return FeedMarkdown.empty();
    }

    const now: Date = new Date(input.report.reviewedAt);

    const lines: Array<MarkdownText> = notable.map(
      (incident: ProductionReviewIncidentJSON): MarkdownText => {
        const link: MarkdownText = FeedMarkdown.link(
          githubSafeText(incident.label, 40),
          ProductionReviewComposer.linkTo(
            input,
            `incidents/${incident.incidentId}`,
          ),
        );

        const facts: string = [
          incident.severity ? githubSafeText(incident.severity, 40) : "",
          githubSafeText(incident.state || "", 40),
          `declared ${formatAge(incident.declaredAt, now)}`,
        ]
          .filter(Boolean)
          .join(", ");

        if (incident.mentions) {
          return mdText`${link} (${facts}): its root cause or postmortem names ${FeedMarkdown.code(
            githubSafeText(incident.mentions, 160),
          )}.`;
        }

        return mdText`${link} (${facts}) is open on a service this changes.`;
      },
    );

    const total: number = input.report.incidents.total;

    const context: MarkdownText =
      total > notable.length
        ? mdText`${plural(total, "incident was", "incidents were")} declared on these services in the last ${PRODUCTION_REVIEW_WINDOWS.incidentsDays} days.`
        : FeedMarkdown.empty();

    return FeedMarkdown.join(
      [mdText`**Incidents**`, FeedMarkdown.bulletList(lines), context].filter(
        (part: MarkdownText): boolean => {
          return !part.isEmpty();
        },
      ),
      "\n\n",
    );
  }

  private static deploysSection(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const deploys: Array<ProductionReviewDeployJSON> =
      input.report.suspectDeploys.slice(0, MAX_LISTED_IN_COMMENT);

    if (deploys.length === 0) {
      return FeedMarkdown.empty();
    }

    const now: Date = new Date(input.report.reviewedAt);

    const lines: Array<MarkdownText> = deploys.map(
      (deploy: ProductionReviewDeployJSON): MarkdownText => {
        const version: MarkdownText = deploy.version
          ? mdText` (${FeedMarkdown.code(githubSafeText(deploy.version, 60))})`
          : FeedMarkdown.empty();

        return mdText`${githubSafeText(deploy.serviceName, 80)}'s deploy ${formatAge(
          deploy.at,
          now,
        )}${version} is a suspect: ${githubSafeText(deploy.impact, 200)}`;
      },
    );

    return FeedMarkdown.join(
      [mdText`**Recent deploys**`, FeedMarkdown.bulletList(lines)],
      "\n\n",
    );
  }

  /*
   * The watched tables the change's migrations and dbt models change, each
   * with the services that use it - those whose queries name a changed
   * column first - the tables built from it, and its data products.
   */
  private static dataSection(
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    const impacts: Array<ProductionReviewDataImpactJSON> =
      input.report.dataImpact || [];

    if (impacts.length === 0) {
      return FeedMarkdown.empty();
    }

    const lines: Array<MarkdownText> = impacts
      .slice(0, MAX_LISTED_IN_COMMENT)
      .map((impact: ProductionReviewDataImpactJSON): MarkdownText => {
        const parts: Array<MarkdownText> = [];
        const services: Array<ProductionReviewDataServiceJSON> =
          impact.services.slice(0, 3);

        if (services.length > 0) {
          const named: Array<MarkdownText> = services.map(
            (service: ProductionReviewDataServiceJSON): MarkdownText => {
              return mdText`**${githubSafeText(service.name, 80)}** (${describeDataUse(service)})`;
            },
          );

          if (impact.services.length > services.length) {
            named.push(
              mdText`${plural(impact.services.length - services.length, "more service", "more services")}`,
            );
          }

          parts.push(mdText`used by ${listing(named)}`);
        }

        if (impact.downstreamCount > 0) {
          const tables: Array<MarkdownText> = impact.downstreamTables
            .slice(0, 3)
            .map((table: { table: string }): MarkdownText => {
              return FeedMarkdown.code(githubSafeText(table.table, 120));
            });

          parts.push(
            mdText`${plural(impact.downstreamCount, "table is", "tables are")} built from it (${listing(tables)}${impact.downstreamCount > tables.length ? mdText`, …` : FeedMarkdown.empty()})`,
          );
        }

        const dashboards: Array<{ name: string; tool: string }> =
          impact.dashboards || [];

        if (dashboards.length > 0) {
          const named: Array<MarkdownText> = dashboards
            .slice(0, 3)
            .map((dashboard: { name: string; tool: string }): MarkdownText => {
              return mdText`**${githubSafeText(dashboard.name, 80)}** (${githubSafeText(dashboard.tool, 40)})`;
            });

          if (dashboards.length > named.length) {
            named.push(
              mdText`${plural(dashboards.length - named.length, "more", "more")}`,
            );
          }

          parts.push(
            mdText`shown on ${dashboards.length === 1 ? "dashboard" : "dashboards"} ${listing(named)}`,
          );
        }

        if (impact.dataProducts.length > 0) {
          const products: Array<MarkdownText> = impact.dataProducts.map(
            (product: {
              name: string;
              owner?: string | undefined;
            }): MarkdownText => {
              return product.owner
                ? mdText`**${githubSafeText(product.name, 80)}** (owned by ${githubSafeText(product.owner, 80)})`
                : mdText`**${githubSafeText(product.name, 80)}**`;
            },
          );

          parts.push(
            mdText`part of ${impact.dataProducts.length === 1 ? "data product" : "data products"} ${listing(products)}`,
          );
        }

        if (impact.staging) {
          parts.push(describeStagingMarkdown(impact.staging));
        }

        const dependents: MarkdownText =
          parts.length > 0
            ? FeedMarkdown.join(parts, "; ")
            : mdText`nothing ${githubSafeText(input.productName, 60)} sees depends on it yet`;

        return mdText`${describeDataChangeMarkdown(impact)} in ${FeedMarkdown.code(
          githubSafeText(impact.path, 200),
        )}: ${dependents}.`;
      });

    return FeedMarkdown.join(
      [
        mdText`**Data this change touches**`,
        FeedMarkdown.bulletList(lines),
        ProductionReviewComposer.more(
          impacts.length,
          lines.length,
          "table",
          "tables",
          input,
        ),
      ].filter((part: MarkdownText): boolean => {
        return !part.isEmpty();
      }),
      "\n\n",
    );
  }

  // "And 3 more in OneUptime." under a list cut short.
  private static more(
    total: number,
    listed: number,
    one: string,
    many: string,
    input: ProductionReviewCommentInput,
  ): MarkdownText {
    if (total <= listed) {
      return FeedMarkdown.empty();
    }

    return mdText`${FeedMarkdown.link(
      `And ${plural(total - listed, `more ${one}`, `more ${many}`)} in ${githubSafeText(
        input.productName,
        60,
      )}`,
      input.reviewUrl,
    )}.`;
  }

  private static footer(input: ProductionReviewCommentInput): MarkdownText {
    const sha: string = ProductionReviewUtil.shortSha(
      input.report.pullRequest.headSha,
    );

    const next: MarkdownText = input.updatesOnPush
      ? mdText`Updated when the ${termOf(input)} changes.`
      : input.reviewCommand
        ? mdText`Not updated on its own: ask again with ${FeedMarkdown.code(
            input.reviewCommand,
          )} after new commits.`
        : input.asksAgainInProduct
          ? mdText`Not updated on its own: press ${FeedMarkdown.link(
              "Review again",
              input.reviewUrl,
            )} in ${githubSafeText(input.productName, 60)} after new commits.`
          : mdText`Not updated on its own: ask again after new commits.`;

    const scope: MarkdownText =
      input.posting === ProductionReviewPosting.Review
        ? mdText` · Aggregates only: no log line, message or personal data.`
        : FeedMarkdown.empty();

    const open: MarkdownText =
      input.posting === ProductionReviewPosting.Review
        ? mdText` · ${FeedMarkdown.link(
            `Open in ${githubSafeText(input.productName, 60)}`,
            input.reviewUrl,
          )}`
        : FeedMarkdown.empty();

    return mdText`<sub>Reviewed at ${FeedMarkdown.code(
      sha,
    )}${scope}${open} · ${next}</sub>`;
  }
}
