import DataSensitivity from "../DataSecurity/DataSensitivity";
import SecuritySeverity from "../SecuritySeverity";

/*
 * SENSITIVE DATA IN A PULL REQUEST: A LEAK CAUGHT BEFORE IT MERGES (#10376).
 *
 * Every check Data Security runs reads what is already in production: a
 * log line with an email is found by the hourly scan after it shipped, a
 * public bucket after Terraform applied it, a plain-text password column
 * after the migration ran and the table filled. By then the data is
 * stored, copied and backed up. A production review reads the pull request
 * before it merges, so it is where such a leak is cheapest to fix.
 *
 * The Sensitive data section of a production review looks at three kinds
 * of change, each found by OneUptime's own rules over the diff
 * (Server/Utils/CodeRepository/ProductionReview/SensitiveData):
 *
 *   - Telemetry: code that writes a value to a log, a span or event
 *     attribute, a metric label or a prompt sent to an AI provider, whose
 *     name a data type's field-name hints point at (`email`, `ssn`,
 *     `password`, the project's own types), or a whole request body or
 *     user record;
 *   - Infrastructure: Terraform, CloudFormation, Bicep, Pulumi or
 *     Kubernetes that makes a store public, turns off its encryption,
 *     backups or access logging, opens its firewall to every address or
 *     shares a snapshot - one rule per check of DataSecurityCheckCatalog a
 *     file can show;
 *   - Migrations and models: a new column whose name says it holds
 *     personal data, a password column not stored as a hash, a column of
 *     card numbers or security codes.
 *
 * The rules alone post a point. OneUptime AI then reads the points beside
 * the diff and may word them, order them, add the change that fixes each
 * and drop what is no leak - never add one no rule found, and never drop
 * one the repository fails its check on (a diff is written by its author,
 * and nothing written in it may talk a failing check into passing).
 *
 * What production knows makes a point sharper - a location that has held
 * the data before, a scrub rule that masks it at ingest, the store a
 * resource is - but only in a private repository's comment, and in
 * OneUptime only for a reader who may read Data Security's findings: a
 * public repository's comment says only what the diff shows.
 *
 * These are the shapes the server, the comment and the Dashboard share.
 * Pure, with no server or React imports.
 */

// What a point is about.
export enum SensitiveDataLeakKind {
  // Code that writes data to telemetry.
  Telemetry = "Telemetry",
  // Infrastructure code that creates or changes a store.
  Infrastructure = "Infrastructure",
  // A migration or a model that adds a column.
  Migration = "Migration",
}

// Where telemetry code writes a value.
export enum SensitiveDataSink {
  Log = "Log",
  // A span's or an event's attribute, a tag, a user set on the trace.
  Span = "Span",
  // A metric's label or attribute.
  Metric = "Metric",
  // A prompt sent to an AI provider.
  AiPrompt = "AiPrompt",
}

// What a new column of a migration or a model is.
export enum SensitiveDataColumn {
  // Its name says it holds personal data, or a type of the project's own.
  PersonalData = "PersonalData",
  // A password, with nothing in its name or the change that says it is hashed.
  PlaintextPassword = "PlaintextPassword",
  CardNumber = "CardNumber",
  // A card's security code (CVV, CVC), which may never be stored.
  CardSecurityCode = "CardSecurityCode",
}

/*
 * The Data Security checks a point is the early form of: the check that
 * would find the same leak after it merged. Ids of DataSecurityCheckCatalog,
 * stored on points and caught leaks, so never renamed.
 */
export const SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID: string =
  "sensitive-data-in-telemetry";
export const SECRETS_IN_TELEMETRY_CHECK_ID: string = "secrets-in-telemetry";
export const SENSITIVE_DATA_TO_AI_CHECK_ID: string = "sensitive-data-to-ai";
export const NEW_PERSONAL_DATA_COLUMN_CHECK_ID: string =
  "new-personal-data-column";
export const PLAINTEXT_PASSWORDS_CHECK_ID: string = "plaintext-passwords";
export const CARD_NUMBERS_READABLE_CHECK_ID: string = "card-numbers-readable";
export const CARD_SECURITY_CODES_STORED_CHECK_ID: string =
  "card-security-codes-stored";

/*
 * The infrastructure checks a file can show, each a rule of its own
 * (InfrastructureRules). The ones a store's configuration shows only when
 * read from the cloud - who reached it last, how many identities can read
 * it - have none.
 */
export const INFRASTRUCTURE_LEAK_CHECK_IDS: ReadonlyArray<string> = [
  "public-read",
  "public-write",
  "public-access-not-blocked",
  "internet-reachable",
  "open-to-all-addresses",
  "snapshot-public",
  "snapshot-shared-externally",
  "not-encrypted-at-rest",
  "encryption-in-transit-not-enforced",
  "weak-tls",
  "no-backups",
  "no-point-in-time-recovery",
  "deletion-protection-off",
  "deleted-data-not-recoverable",
  "access-not-logged",
  "shared-key-access",
  "object-acls-enabled",
];

/*
 * The checks that make a store readable by anyone: a store that is public
 * this way holds data anyone on the internet can read, so it is a leak of
 * sensitive data unless OneUptime knows the store holds none.
 */
export const PUBLIC_STORE_CHECK_IDS: ReadonlyArray<string> = [
  "public-read",
  "public-write",
  "snapshot-public",
];

/*
 * The checks a store marked Public By Design passes, as Data Security's
 * own do (DataSecurityCheckCatalog): a store meant to be read by anyone
 * makes no point for being readable by anyone. Never for being written
 * by anyone.
 */
export const PUBLIC_BY_DESIGN_CHECK_IDS: ReadonlyArray<string> = [
  "public-read",
  "public-access-not-blocked",
];

/*
 * Every check a pull request's point can be the early form of. AI Results
 * counts the issues Data Security's scans opened on these checks as the
 * leaks found after they merged, beside the ones caught before.
 */
export const PRODUCTION_REVIEW_LEAK_CHECK_IDS: ReadonlyArray<string> = [
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
  SECRETS_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_TO_AI_CHECK_ID,
  NEW_PERSONAL_DATA_COLUMN_CHECK_ID,
  PLAINTEXT_PASSWORDS_CHECK_ID,
  CARD_NUMBERS_READABLE_CHECK_ID,
  CARD_SECURITY_CODES_STORED_CHECK_ID,
  ...INFRASTRUCTURE_LEAK_CHECK_IDS,
];

/*
 * Written on a line, or on the line above it, it says the line is no leak:
 * the rules leave it alone, and every reviewer of the diff sees that the
 * author said so. Matched in lower case.
 */
export const NOT_SENSITIVE_MARKER: string = "oneuptime:not-sensitive";

export const SENSITIVE_DATA_LIMITS: {
  // The points a review keeps, the most important first.
  maxPoints: number;
  // The points the comment lists; the rest are in OneUptime.
  maxPointsInComment: number;
  // The candidates OneUptime AI reads at once.
  maxCandidatesForAi: number;
  // The points of one file, and of one line.
  maxPointsPerFile: number;
  // The longest text of each kind a point holds.
  maxSubjectLength: number;
  maxTextLength: number;
  maxFixLength: number;
  maxSuggestionLines: number;
  maxSuggestionLineLength: number;
  // A line longer than this is read only this far.
  maxLineRead: number;
  // How far back a location of production counts as having held the data.
  heldBeforeDays: number;
  // The caught leaks one pull request's review remembers.
  maxCaughtLeaksPerPullRequest: number;
} = {
  maxPoints: 10,
  maxPointsInComment: 5,
  maxCandidatesForAi: 12,
  maxPointsPerFile: 4,
  maxSubjectLength: 120,
  maxTextLength: 400,
  maxFixLength: 300,
  maxSuggestionLines: 6,
  maxSuggestionLineLength: 300,
  maxLineRead: 1000,
  heldBeforeDays: 7,
  maxCaughtLeaksPerPullRequest: 50,
};

/*
 * The change a point suggests to its lines: the lines as the pull request
 * has them, and as they would be - drawn as a diff in the comment, and on
 * GitHub as a suggestion block on the line. An empty replacement removes
 * the lines.
 */
export interface ProductionReviewLeakSuggestionJSON {
  // The lines of the file after the change, first and last.
  startLine: number;
  endLine: number;
  original: Array<string>;
  replacement: Array<string>;
  // OneUptime AI wrote it; otherwise OneUptime's own rule did.
  isByAi: boolean;
}

// A place of production's telemetry that held the same data lately.
export interface ProductionReviewLeakHeldBeforeJSON {
  serviceId: string;
  serviceName: string;
  // The telemetry store's kind: Logs, Traces, Metrics, AI Conversations.
  storeKind: string;
  // Where in it: "attributes.user.email", "body".
  location: string;
  dataTypeName: string;
  lastSeenAt: string;
}

// The project's store an infrastructure point's resource is.
export interface ProductionReviewLeakStoreJSON {
  dataStoreId: string;
  name: string;
  sensitivity: DataSensitivity;
  // The kinds of data found in it, the most sensitive first.
  dataTypeNames: Array<string>;
}

/*
 * What production knows about a point. Never in a public repository's
 * comment, and read in OneUptime only by those who may read Data
 * Security's findings (ProductionReviewUtil.keepReadableSensitiveData).
 */
export interface ProductionReviewLeakProductionJSON {
  heldBefore?: Array<ProductionReviewLeakHeldBeforeJSON> | undefined;
  // A scrub rule already masks it at ingest: still written by the code.
  maskedAtIngestBy?: string | undefined;
  store?: ProductionReviewLeakStoreJSON | undefined;
}

// One point of the Sensitive data section.
export interface ProductionReviewLeakJSON {
  /*
   * The point's own key: the same leak keeps it across pushes, so it is
   * posted as a suggestion once and counted once (16 hex characters).
   */
  key: string;
  kind: SensitiveDataLeakKind;
  // The Data Security check that would find it after it merged.
  checkId: string;
  // Telemetry: where the value goes.
  sink?: SensitiveDataSink | undefined;
  // A migration's or a model's column: what it is.
  column?: SensitiveDataColumn | undefined;
  // The file and the line, as the pull request has them.
  path: string;
  line: number;
  /*
   * The name the rule read, as the diff writes it: an attribute's key, a
   * field, a setting ("acl"), a column ("customer_ssn").
   */
  subject: string;
  /*
   * What it sits in: the call that writes it ("logger.info"), the resource
   * ("aws_s3_bucket.assets"), the table ("customers").
   */
  where?: string | undefined;
  // An infrastructure setting's value as the diff gives it ("public-read").
  value?: string | undefined;
  // A whole request body, its headers, or a whole record.
  isWholeObject?: boolean | undefined;
  // The kinds of data its name points at: ids, and names as they were read.
  dataTypeIds: Array<string>;
  dataTypeNames: Array<string>;
  sensitivity: DataSensitivity;
  severity: SecuritySeverity;
  /*
   * A secret or Restricted data written to telemetry, a public store that
   * may hold sensitive data, a password or a card security code stored as
   * it is: what a repository can ask its check to fail on.
   */
  isBlocking: boolean;
  // It failed the check: blocking, on a repository that asked to fail.
  failsCheck: boolean;
  /*
   * What the point says and the change that fixes it, in English: OneUptime
   * AI's words when it read the point, else OneUptime's own. Never anything
   * production holds: what production knows is `production`'s, set apart.
   */
  text: string;
  fix: string;
  isAiWorded: boolean;
  suggestion?: ProductionReviewLeakSuggestionJSON | undefined;
  production?: ProductionReviewLeakProductionJSON | undefined;
}

// Why the section has no AI read: the codes the review's own note uses.
export enum SensitiveDataAiNoteCode {
  AiOff = "AiOff",
  DailyLimit = "DailyLimit",
  Failed = "Failed",
}

/*
 * The Sensitive data section of a review: ProductionReviewReport
 * .sensitiveData. Unset on a review made before it existed.
 */
export interface ProductionReviewSensitiveDataJSON {
  points: Array<ProductionReviewLeakJSON>;
  // Points the rules found past SENSITIVE_DATA_LIMITS.maxPoints.
  moreCount: number;
  // Points OneUptime AI read as no leak, and left out.
  droppedCount: number;
  // The repository's check fails on a blocking point (its switch was on).
  isFailOn: boolean;
  // OneUptime AI read the points.
  isAiRead: boolean;
  aiNote?: SensitiveDataAiNoteCode | undefined;
}

/*
 * A leak a pull request's review posted, remembered on its review task
 * (ProductionReviewTaskContext.caughtLeaks), once however many pushes
 * show it: what AI Results counts as caught before it merged.
 */
export interface ProductionReviewCaughtLeak {
  key: string;
  kind: SensitiveDataLeakKind;
  checkId: string;
  isBlocking: boolean;
  // When a review first posted it.
  at: string;
  // When a later review no longer found it: fixed in the pull request.
  fixedAt?: string | undefined;
}

/*
 * What a pull request's comment shows of its Sensitive data section:
 * everything, in a private repository; only what the diff shows, in a
 * public one (or one whose visibility is not known); nothing, when the
 * repository posts only a link to its reviews.
 */
export enum SensitiveDataPosting {
  Full = "Full",
  DiffOnly = "DiffOnly",
  None = "None",
}

export class ProductionReviewSensitiveDataUtil {
  // The points of a review, or none.
  public static getPoints(
    section: ProductionReviewSensitiveDataJSON | null | undefined,
  ): Array<ProductionReviewLeakJSON> {
    return Array.isArray(section?.points) ? section!.points : [];
  }

  // The points a review's check failed on.
  public static getFailingPoints(
    section: ProductionReviewSensitiveDataJSON | null | undefined,
  ): Array<ProductionReviewLeakJSON> {
    return ProductionReviewSensitiveDataUtil.getPoints(section).filter(
      (point: ProductionReviewLeakJSON): boolean => {
        return point.failsCheck === true;
      },
    );
  }

  // Whether the review's check fails: a point failed it.
  public static failsCheck(
    section: ProductionReviewSensitiveDataJSON | null | undefined,
  ): boolean {
    return (
      ProductionReviewSensitiveDataUtil.getFailingPoints(section).length > 0
    );
  }

  /*
   * The section as a reader who may not read Data Security's findings reads
   * it: every point without what production knows of it. The same section
   * when no point has any.
   */
  public static withoutProduction(
    section: ProductionReviewSensitiveDataJSON,
  ): ProductionReviewSensitiveDataJSON {
    const points: Array<ProductionReviewLeakJSON> =
      ProductionReviewSensitiveDataUtil.getPoints(section);

    if (
      !points.some((point: ProductionReviewLeakJSON): boolean => {
        return point.production !== undefined;
      })
    ) {
      return section;
    }

    return {
      ...section,
      points: points.map(
        (point: ProductionReviewLeakJSON): ProductionReviewLeakJSON => {
          const { production: _production, ...rest } = point;

          return rest;
        },
      ),
    };
  }

  /*
   * The caught leaks a pull request's review remembers after a review that
   * posted `points` at `now`: each leak once, when it was first posted; one
   * no longer posted is marked fixed then, and one posted again is open
   * again. The newest kept when there are more than the limit.
   */
  public static mergeCaughtLeaks(data: {
    previous: Array<ProductionReviewCaughtLeak> | null | undefined;
    points: Array<ProductionReviewLeakJSON>;
    now: Date;
  }): Array<ProductionReviewCaughtLeak> {
    const at: string = data.now.toISOString();
    const posted: Set<string> = new Set<string>(
      data.points.map((point: ProductionReviewLeakJSON): string => {
        return point.key;
      }),
    );
    const merged: Array<ProductionReviewCaughtLeak> = [];
    const seen: Set<string> = new Set<string>();

    for (const leak of Array.isArray(data.previous) ? data.previous : []) {
      if (
        !leak ||
        typeof leak.key !== "string" ||
        !leak.key ||
        seen.has(leak.key)
      ) {
        continue;
      }

      seen.add(leak.key);

      if (posted.has(leak.key)) {
        const { fixedAt: _fixedAt, ...open } = leak;

        merged.push(open);
      } else {
        merged.push({ ...leak, fixedAt: leak.fixedAt || at });
      }
    }

    for (const point of data.points) {
      if (seen.has(point.key)) {
        continue;
      }

      seen.add(point.key);
      merged.push({
        key: point.key,
        kind: point.kind,
        checkId: point.checkId,
        isBlocking: point.isBlocking,
        at,
      });
    }

    return merged.slice(
      Math.max(
        0,
        merged.length - SENSITIVE_DATA_LIMITS.maxCaughtLeaksPerPullRequest,
      ),
    );
  }
}
