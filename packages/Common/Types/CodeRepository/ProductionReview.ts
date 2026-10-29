/*
 * PRODUCTION REVIEW OF A PULL REQUEST.
 *
 * OneUptime holds what a repository's code does in production: the
 * exceptions it throws, how busy and how slow its operations are, where its
 * CPU time goes, the incidents and deploys around it. A production review
 * reads that for the code a pull request changes and says it where the
 * author looks - one comment on the pull request, edited in place on every
 * push - and on the pull request's page in Code.
 *
 * These are the shapes the server, the Dashboard and the comment share: the
 * repository's setting for what a pull request shows, the review itself
 * (ProductionReviewReport, kept on the review's run as part of its outcome)
 * and the few rules both ends apply to it (ProductionReviewUtil).
 *
 * Everything in a report is AGGREGATE: counts, rates, durations, shares, and
 * the names of code - an exception's type, a function, a file, an operation.
 * It holds no exception message, no log line, no attribute value, no
 * incident's title or text: it is posted where everyone who can read the
 * repository reads it, and links into OneUptime for the rest, where
 * OneUptime's own permissions apply.
 *
 * Pure, with no server or React imports.
 */

import { LlmProviderActivity } from "../AI/LlmProviderChoice";

/*
 * What a pull request's comment shows, a repository's choice
 * (CodeRepository.productionReviewPullRequestContent). Unset is Review.
 */
export enum ProductionReviewPullRequestContent {
  /*
   * The review, in the pull request - on a public repository, only a link
   * to it in OneUptime: anyone on the internet reads a public pull request.
   */
  Review = "Review",
  // Only a link to the review in OneUptime, whatever the repository.
  Link = "Link",
  /*
   * The review in the pull request, even on a public repository - an
   * explicit choice, for a project that is happy to show its error counts
   * and slow paths to everyone.
   */
  ReviewEvenIfPublic = "ReviewEvenIfPublic",
}

export const DEFAULT_PRODUCTION_REVIEW_PULL_REQUEST_CONTENT: ProductionReviewPullRequestContent =
  ProductionReviewPullRequestContent.Review;

// What one review's comment on the pull request shows.
export enum ProductionReviewPosting {
  // The review itself.
  Review = "Review",
  // A link to the review in OneUptime, and nothing of production.
  Link = "Link",
  /*
   * Nothing: a review OneUptime started on its own found nothing in
   * production that runs through the change, and had posted nothing before.
   */
  None = "None",
}

// What started a review.
export enum ProductionReviewTrigger {
  /*
   * The pull request was opened, reopened, pushed to or marked ready for
   * review, in a repository with Production Review on, by someone who can
   * write to it.
   */
  PullRequestChanged = "PullRequestChanged",
  // "@oneuptime production review", from someone who can write to it.
  GitHubCommand = "GitHubCommand",
  // Review again, on the pull request's page in Code.
  OneUptime = "OneUptime",
}

// How close to the change a finding is.
export enum ProductionReviewWhere {
  // At a line this pull request changes or deletes.
  ChangedLine = "ChangedLine",
  // Inside a function this pull request changes.
  ChangedFunction = "ChangedFunction",
  // In a file this pull request changes.
  ChangedFile = "ChangedFile",
}

// How an operation (a span name) was found to run the changed code.
export enum ProductionReviewOperationMatch {
  // Its spans' code.* attributes name the changed file.
  CodeAttribute = "CodeAttribute",
  // The change edits the route it serves ("/api/orders/:id").
  Route = "Route",
  // It is named after a function the change edits.
  FunctionName = "FunctionName",
}

// The parts of a review read from production, each on its own.
export enum ProductionReviewSection {
  Services = "Services",
  Exceptions = "Exceptions",
  Operations = "Operations",
  Profiles = "Profiles",
  Incidents = "Incidents",
  Deploys = "Deploys",
}

// Why a review has no AI read.
export enum ProductionReviewAiNoteCode {
  // Project Settings > AI > Enable AI is off.
  AiOff = "AiOff",
  // This pull request, or this repository, had its AI reads for the day.
  DailyLimit = "DailyLimit",
  // OneUptime AI could not run, or its answer could not be read.
  Failed = "Failed",
}

export interface ProductionReviewAiNote {
  code: ProductionReviewAiNoteCode;
  // A sentence of OneUptime's own saying why, for the review's page.
  message?: string | undefined;
}

// A service the change's code runs in.
export interface ProductionReviewServiceJSON {
  id: string;
  name: string;
  // Spans in the traces window, when the service sends traces.
  requestCount?: number | undefined;
  p99Ms?: number | undefined;
}

// An exception group thrown in the changed code.
export interface ProductionReviewExceptionJSON {
  exceptionId: string;
  // Its type ("TypeError"): the name of code, on one line.
  type: string;
  serviceId: string;
  serviceName: string;
  // The changed file, as the repository names it.
  path: string;
  // The line the stack frame names, as the deployed code numbers it.
  line?: number | undefined;
  // The changed function the frame runs in.
  functionName?: string | undefined;
  where: ProductionReviewWhere;
  // In the exceptions window, or in all (isWindowCount false).
  occurrences: number;
  isWindowCount: boolean;
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  isUnhandled: boolean;
  // First seen inside the exceptions window.
  isNew: boolean;
}

// An operation (span name) that runs the changed code.
export interface ProductionReviewOperationJSON {
  name: string;
  serviceId: string;
  serviceName: string;
  path?: string | undefined;
  functionName?: string | undefined;
  matchedBy: ProductionReviewOperationMatch;
  // Spans in the traces window.
  requestCount: number;
  errorCount: number;
  p95Ms: number;
}

// A function of the changed code that takes a share of a profile.
export interface ProductionReviewHotFunctionJSON {
  functionName: string;
  path: string;
  serviceId: string;
  serviceName: string;
  // Of the whole profile window, in percent: with what it calls, and alone.
  totalPercent: number;
  selfPercent: number;
  isChangedFunction: boolean;
  // What the profile measures ("CPU time").
  profileKind: string;
}

export interface ProductionReviewIncidentJSON {
  incidentId: string;
  // "INC-45", "#45": never its title.
  label: string;
  severity?: string | undefined;
  state?: string | undefined;
  isOpen: boolean;
  declaredAt: string;
  // The changed file or function its root cause, remediation or postmortem names.
  mentions?: string | undefined;
}

export interface ProductionReviewIncidentsJSON {
  // Incidents declared in the window on the services the change runs in.
  total: number;
  open: number;
  items: Array<ProductionReviewIncidentJSON>;
}

// A recent deploy of a service the change runs in that OneUptime suspects.
export interface ProductionReviewDeployJSON {
  serviceId: string;
  serviceName: string;
  at: string;
  // Its version or commit, as the deploy was recorded.
  version?: string | undefined;
  // What got worse after it, in OneUptime's words.
  impact: string;
}

// One thing OneUptime AI says to watch, read from the facts above.
export interface ProductionReviewPointJSON {
  text: string;
}

export interface ProductionReviewPullRequestJSON {
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  headSha: string;
  baseRefName?: string | undefined;
  isFromFork: boolean;
  /*
   * Whether its author can write to the repository, as the review was
   * asked: only then are its pushes reviewed on their own. Unset in a
   * review kept before it was recorded.
   */
  isAuthorTrusted?: boolean | undefined;
}

/*
 * One production review: AIRun.taskOutcome.productionReview of the pull
 * request's review task, replaced by every new review of it.
 */
export interface ProductionReviewReport {
  pullRequest: ProductionReviewPullRequestJSON;
  reviewedAt: string;
  trigger: ProductionReviewTrigger;
  // Every file of the pull request, and the files of code among them.
  changedFileCount: number;
  codeFileCount: number;
  // The services the changed code runs in.
  services: Array<ProductionReviewServiceJSON>;
  /*
   * Why no service is known for the repository, when none is: production
   * then says nothing about it.
   */
  noServicesReason?: string | undefined;
  exceptions: Array<ProductionReviewExceptionJSON>;
  operations: Array<ProductionReviewOperationJSON>;
  hotFunctions: Array<ProductionReviewHotFunctionJSON>;
  incidents: ProductionReviewIncidentsJSON;
  suspectDeploys: Array<ProductionReviewDeployJSON>;
  // What OneUptime AI says to watch; empty without an AI read.
  points: Array<ProductionReviewPointJSON>;
  aiNote?: ProductionReviewAiNote | undefined;
  /*
   * The LLM provider OneUptime AI read the review with, when the
   * repository picks one for its production reviews
   * (CodeRepository.productionReviewLlmProviderId): the pick, or the
   * provider it fell back to and why the pick could not be used - for the
   * review's page in Code; the pull request's comment never names it.
   * Unset when the repository picks none (the project's default provider,
   * else the global one, read it, as every review's did before a
   * repository could pick) and when no read was made.
   */
  llmProvider?: LlmProviderActivity | undefined;
  // The parts that could not be read this time.
  unreadSections: Array<ProductionReviewSection>;
  // What the pull request's comment shows.
  posting: ProductionReviewPosting;
  isPublicRepository?: boolean | undefined;
  commentUrl?: string | undefined;
  /*
   * The pull request's host would not let the access token comment on it
   * (GitLab, Forgejo, Gitea: a Forgejo or Gitea token without write access
   * to issues, a merge request whose discussion is locked): nothing was
   * posted, and the review is only on its page in Code. Unset otherwise.
   */
  isCommentRefused?: boolean | undefined;
}

// What a list row says of a review.
export interface ProductionReviewSummaryJSON {
  hasSignal: boolean;
  exceptionCount: number;
  operationCount: number;
  hotFunctionCount: number;
  incidentCount: number;
  suspectDeployCount: number;
  headSha: string;
  reviewedAt: string;
  posting: ProductionReviewPosting;
}

/*
 * The windows a review reads production over, and how much of it a review
 * holds. A review is unattended work started by every push: each read is
 * small, and the trace and profile reads are shared by every pull request
 * of a repository for a while (ProductionReviewRepositoryProfile).
 */
export const PRODUCTION_REVIEW_WINDOWS: {
  exceptionsDays: number;
  tracesHours: number;
  profilesHours: number;
  incidentsDays: number;
  deploysDays: number;
} = {
  exceptionsDays: 7,
  tracesHours: 1,
  profilesHours: 1,
  incidentsDays: 30,
  deploysDays: 7,
};

export const PRODUCTION_REVIEW_LIMITS: {
  // The files of a pull request read for the review.
  maxFilesRead: number;
  // The files of code a review looks up in production.
  maxCodeFiles: number;
  // The functions of one file, and of the whole change, looked up.
  maxFunctionsPerFile: number;
  maxFunctions: number;
  // What a report holds of each part.
  maxExceptions: number;
  maxOperations: number;
  maxHotFunctions: number;
  maxIncidents: number;
  maxSuspectDeploys: number;
  maxServices: number;
  maxPoints: number;
  // The longest text of each kind a report holds.
  maxNameLength: number;
  maxPointLength: number;
  maxTitleLength: number;
  /*
   * A function takes at least this share of its profile to be called hot:
   * less is noise a reviewer should not be shown.
   */
  minHotFunctionPercent: number;
  // AI reads of one pull request, and of one repository, in a UTC day.
  maxAiReadsPerPullRequestPerDay: number;
  maxAiReadsPerRepositoryPerDay: number;
  // The digits of a pull request's number a person may give: 1 to 999,999,999.
  maxPullRequestNumberDigits: number;
} = {
  maxFilesRead: 300,
  maxCodeFiles: 60,
  maxFunctionsPerFile: 20,
  maxFunctions: 80,
  maxExceptions: 8,
  maxOperations: 8,
  maxHotFunctions: 8,
  maxIncidents: 5,
  maxSuspectDeploys: 3,
  maxServices: 8,
  maxPoints: 4,
  maxNameLength: 120,
  maxPointLength: 400,
  maxTitleLength: 200,
  minHotFunctionPercent: 1,
  maxAiReadsPerPullRequestPerDay: 10,
  maxAiReadsPerRepositoryPerDay: 100,
  maxPullRequestNumberDigits: 9,
};

// The hidden line every production review comment starts with.
export const PRODUCTION_REVIEW_COMMENT_MARKER: string =
  "<!-- oneuptime-production-review -->";

export class ProductionReviewUtil {
  // A stored choice, read: unset or unknown is the default.
  public static readContent(
    value: string | null | undefined,
  ): ProductionReviewPullRequestContent {
    if (
      value &&
      (
        Object.values(ProductionReviewPullRequestContent) as Array<string>
      ).includes(value)
    ) {
      return value as ProductionReviewPullRequestContent;
    }

    return DEFAULT_PRODUCTION_REVIEW_PULL_REQUEST_CONTENT;
  }

  /*
   * What the pull request shows of a review, by the repository's choice and
   * whether the repository is public. A repository whose visibility is not
   * known is treated as public: the safe reading.
   */
  public static getPosting(data: {
    content: ProductionReviewPullRequestContent | string | null | undefined;
    isPublic: boolean | null | undefined;
  }): ProductionReviewPosting.Review | ProductionReviewPosting.Link {
    const content: ProductionReviewPullRequestContent =
      ProductionReviewUtil.readContent(data.content);

    if (content === ProductionReviewPullRequestContent.Link) {
      return ProductionReviewPosting.Link;
    }

    if (content === ProductionReviewPullRequestContent.ReviewEvenIfPublic) {
      return ProductionReviewPosting.Review;
    }

    return data.isPublic === false
      ? ProductionReviewPosting.Review
      : ProductionReviewPosting.Link;
  }

  /*
   * Whether production says something about this change: what it throws,
   * runs or spends in the changed code, an incident that names it or is
   * open on its services, or a recent deploy of them OneUptime suspects.
   * How busy a service is, on its own, is not: every change to a service
   * would be commented on.
   */
  public static hasSignal(
    report: Pick<
      ProductionReviewReport,
      | "exceptions"
      | "operations"
      | "hotFunctions"
      | "incidents"
      | "suspectDeploys"
    >,
  ): boolean {
    return (
      report.exceptions.length > 0 ||
      report.operations.length > 0 ||
      report.hotFunctions.length > 0 ||
      report.incidents.open > 0 ||
      report.incidents.items.some(
        (incident: ProductionReviewIncidentJSON): boolean => {
          return Boolean(incident.mentions);
        },
      ) ||
      report.suspectDeploys.length > 0
    );
  }

  // The incidents worth naming: open ones, and those that name the change.
  public static getNotableIncidents(
    incidents: ProductionReviewIncidentsJSON,
  ): Array<ProductionReviewIncidentJSON> {
    return incidents.items.filter(
      (incident: ProductionReviewIncidentJSON): boolean => {
        return incident.isOpen || Boolean(incident.mentions);
      },
    );
  }

  public static summarize(
    report: ProductionReviewReport,
  ): ProductionReviewSummaryJSON {
    return {
      hasSignal: ProductionReviewUtil.hasSignal(report),
      exceptionCount: report.exceptions.length,
      operationCount: report.operations.length,
      hotFunctionCount: report.hotFunctions.length,
      incidentCount: ProductionReviewUtil.getNotableIncidents(report.incidents)
        .length,
      suspectDeployCount: report.suspectDeploys.length,
      headSha: report.pullRequest.headSha,
      reviewedAt: report.reviewedAt,
      posting: report.posting,
    };
  }

  // A commit as GitHub shortens it.
  public static shortSha(sha: string | null | undefined): string {
    return (sha || "").substring(0, 7);
  }

  /*
   * A pull request's number as a person gives it - 12, "12", "#12", or
   * GitLab's "!12" - or null for anything else: a whole number from 1 up,
   * of at most PRODUCTION_REVIEW_LIMITS.maxPullRequestNumberDigits digits.
   * Read character by character, never with a pattern.
   */
  public static readPullRequestNumber(raw: unknown): number | null {
    if (typeof raw === "number") {
      return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
    }

    if (typeof raw !== "string") {
      return null;
    }

    let text: string = raw.trim();

    if (text.startsWith("#") || text.startsWith("!")) {
      text = text.substring(1).trim();
    }

    if (
      text.length === 0 ||
      text.length > PRODUCTION_REVIEW_LIMITS.maxPullRequestNumberDigits
    ) {
      return null;
    }

    for (const character of text) {
      if (character < "0" || character > "9") {
        return null;
      }
    }

    const number: number = Number(text);

    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
}
