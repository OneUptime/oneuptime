import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { JSONObject, JSONValue } from "../JSON";
import { translationKey } from "../Translator";
import { toStableJsonText } from "./DataSecurityAi";
import DataSensitivity, { isDataSensitivity } from "./DataSensitivity";

/*
 * ONEUPTIME AI'S ANALYSIS OF A DATA SECURITY ISSUE (#10369): WHAT A PERSON
 * NEEDS TO DECIDE QUICKLY, WRITTEN BEFORE ANYONE OPENS THE ISSUE.
 *
 * An issue's page says what its check saw and how to fix that kind of
 * problem. The analysis answers four questions about this issue on this
 * store:
 *
 *   - the verdict: Real, Likely by design (a bucket of a website's images, a
 *     public dataset), Likely a wrong finding (a field the detector misread),
 *     or Cannot tell - with the reason in a sentence;
 *   - what it puts at risk: the data and about how many records, who can
 *     reach it, copies in other stores, the security cases on it;
 *   - what the fix would break: the services seen using the store, the
 *     identities that used its access lately, the grants the fix removes
 *     that something still uses - or that nothing OneUptime can see uses it;
 *   - the shortest path to fixed: contain it now, fix the cause in the code
 *     that declares the store, and who should do it.
 *
 * Deterministic first: Data Security's code gathers the facts - each with an
 * id, the kind of record it was read from and the records themselves
 * (Server/Utils/AI/DataSecurity/DataSecurityIssueDossier) - and OneUptime AI
 * only writes the verdict and one line on each question, each line naming
 * the facts it rests on. A line that names none is dropped
 * (holdAnalysisToFacts), as Production Review drops a point. What the card
 * folds out under a line, and its buttons, are drawn from the facts, never
 * from the model's words.
 *
 * Who reads it reads only what they may: every fact keeps the records it
 * came from, the route that serves the analysis reads those records with
 * the reader's own permissions, and a line resting on a fact the reader
 * may not read is hidden from them (getAnalysisView) - a person who cannot
 * read a store's access does not see who can reach it.
 *
 * Checks decide: the analysis never changes an issue's status or severity.
 * A verdict of Likely by design offers Accept Risk with the reason drafted
 * (or Public by Design on the store); Likely a wrong finding offers Not an
 * Issue with the reason drafted. A person presses them.
 *
 * Kept for what it was written from: the hash of its input
 * (getAnalysisInputHash) is stored with it, and an evaluation with nothing
 * changed makes no model call. Recency is kept in buckets and counts are
 * rounded, so the hours passing change nothing.
 *
 * Pure, so the server and the Dashboard read it alike. Stored strings are a
 * contract: never rename one.
 */

export enum DataSecurityAiVerdict {
  // The risk is there, and nothing says it is meant to be.
  Real = "Real",
  // The facts say it is meant to be so: a public website's images, a public dataset.
  LikelyByDesign = "LikelyByDesign",
  // The facts say the check misread the store: a field the detector misread.
  LikelyWrongFinding = "LikelyWrongFinding",
  // The facts do not say.
  CannotTell = "CannotTell",
}

// In the order a person reads them, and the Issues list filters by them.
export const DATA_SECURITY_AI_VERDICTS: ReadonlyArray<DataSecurityAiVerdict> = [
  DataSecurityAiVerdict.Real,
  DataSecurityAiVerdict.LikelyByDesign,
  DataSecurityAiVerdict.LikelyWrongFinding,
  DataSecurityAiVerdict.CannotTell,
];

export function isDataSecurityAiVerdict(
  value: unknown,
): value is DataSecurityAiVerdict {
  return (
    typeof value === "string" &&
    (DATA_SECURITY_AI_VERDICTS as ReadonlyArray<string>).includes(value)
  );
}

// What each verdict is called, on the card, in the list and in the owners' email.
export const DATA_SECURITY_AI_VERDICT_TITLES: Readonly<
  Record<DataSecurityAiVerdict, string>
> = {
  [DataSecurityAiVerdict.Real]: translationKey("Real"),
  [DataSecurityAiVerdict.LikelyByDesign]: translationKey("Likely by design"),
  [DataSecurityAiVerdict.LikelyWrongFinding]: translationKey(
    "Likely a wrong finding",
  ),
  [DataSecurityAiVerdict.CannotTell]: translationKey("Cannot tell"),
};

/*
 * The parts of an analysis: the verdict's reason, the three questions, and
 * the reason a person could give when the verdict says it is by design or
 * a wrong finding.
 */
export enum DataSecurityAnalysisPart {
  Reason = "reason",
  Risk = "risk",
  Breaks = "breaks",
  Path = "path",
  Draft = "draft",
}

// The questions, in the order the card asks them.
export const DATA_SECURITY_ANALYSIS_QUESTIONS: ReadonlyArray<DataSecurityAnalysisPart> =
  [
    DataSecurityAnalysisPart.Risk,
    DataSecurityAnalysisPart.Breaks,
    DataSecurityAnalysisPart.Path,
  ];

export const DATA_SECURITY_ANALYSIS_PARTS: ReadonlyArray<DataSecurityAnalysisPart> =
  [
    DataSecurityAnalysisPart.Reason,
    DataSecurityAnalysisPart.Risk,
    DataSecurityAnalysisPart.Breaks,
    DataSecurityAnalysisPart.Path,
    DataSecurityAnalysisPart.Draft,
  ];

export const DATA_SECURITY_ANALYSIS_PART_TITLES: Readonly<
  Record<DataSecurityAnalysisPart, string>
> = {
  [DataSecurityAnalysisPart.Reason]: translationKey("Why"),
  [DataSecurityAnalysisPart.Risk]: translationKey("What it puts at risk"),
  [DataSecurityAnalysisPart.Breaks]: translationKey("What the fix would break"),
  [DataSecurityAnalysisPart.Path]: translationKey("The shortest path to fixed"),
  [DataSecurityAnalysisPart.Draft]: translationKey("A reason you could give"),
};

/*
 * The kind of record each fact was read from: what a reader must be able to
 * read to see it. A store's response actions are worked out from the store
 * and its connection, which a reader of the store reads on its page.
 */
export enum DataSecurityAnalysisFactSource {
  Issue = "Issue",
  Store = "Store",
  Finding = "Finding",
  Access = "Access",
  Flow = "Flow",
  SecurityCase = "SecurityCase",
  Proposal = "Proposal",
  Code = "Code",
  Owner = "Owner",
}

export const DATA_SECURITY_ANALYSIS_FACT_SOURCES: ReadonlyArray<DataSecurityAnalysisFactSource> =
  Object.values(DataSecurityAnalysisFactSource);

// What a reader is told is hidden from them, by the kind of record they may not read.
export const DATA_SECURITY_ANALYSIS_HIDDEN_SOURCE_TITLES: Readonly<
  Record<DataSecurityAnalysisFactSource, string>
> = {
  [DataSecurityAnalysisFactSource.Issue]: translationKey("the issue"),
  [DataSecurityAnalysisFactSource.Store]: translationKey("the store"),
  [DataSecurityAnalysisFactSource.Finding]: translationKey(
    "where its data was found",
  ),
  [DataSecurityAnalysisFactSource.Access]: translationKey(
    "who can reach the store",
  ),
  [DataSecurityAnalysisFactSource.Flow]: translationKey(
    "where the store's data flows",
  ),
  [DataSecurityAnalysisFactSource.SecurityCase]:
    translationKey("security cases"),
  [DataSecurityAnalysisFactSource.Proposal]: translationKey(
    "what OneUptime AI proposed",
  ),
  [DataSecurityAnalysisFactSource.Code]: translationKey("code repositories"),
  [DataSecurityAnalysisFactSource.Owner]: translationKey("who owns the store"),
};

export enum DataSecurityAnalysisFactKind {
  // The issue, as its check saw it.
  Issue = "Issue",
  // What the store holds: its data types, its sensitivity, about how many records.
  StoreHolds = "StoreHolds",
  // How exposed it is, and whether a person marked it public by design.
  StoreExposure = "StoreExposure",
  // What the store is: its name, kind, place and tags.
  StoreIdentity = "StoreIdentity",
  // Where a telemetry issue's data sits.
  Place = "Place",
  // Who can reach it, counted.
  Reach = "Reach",
  // One grant: who, how, through what, when last used, and whether the fix removes it.
  Grant = "Grant",
  // A service the service map shows using the store.
  ServiceUse = "ServiceUse",
  // No service is seen using it, and nobody used its access lately.
  NothingUsesIt = "NothingUsesIt",
  // A copy of its data in another store.
  Copy = "Copy",
  SecurityCase = "SecurityCase",
  // A response action that fixes this check on this store, and whether it can run.
  Response = "Response",
  // What OneUptime AI proposed for the issue (#10364), and where it stands.
  Proposal = "Proposal",
  // The repository, and the files, that declare the store as code.
  DeclaredCode = "DeclaredCode",
  Owners = "Owners",
  NoOwner = "NoOwner",
}

// The fact kinds, by the source a reader must be able to read.
export const DATA_SECURITY_ANALYSIS_FACT_KIND_SOURCES: Readonly<
  Record<DataSecurityAnalysisFactKind, DataSecurityAnalysisFactSource>
> = {
  [DataSecurityAnalysisFactKind.Issue]: DataSecurityAnalysisFactSource.Issue,
  [DataSecurityAnalysisFactKind.StoreHolds]:
    DataSecurityAnalysisFactSource.Store,
  [DataSecurityAnalysisFactKind.StoreExposure]:
    DataSecurityAnalysisFactSource.Store,
  [DataSecurityAnalysisFactKind.StoreIdentity]:
    DataSecurityAnalysisFactSource.Store,
  [DataSecurityAnalysisFactKind.Place]: DataSecurityAnalysisFactSource.Finding,
  [DataSecurityAnalysisFactKind.Reach]: DataSecurityAnalysisFactSource.Access,
  [DataSecurityAnalysisFactKind.Grant]: DataSecurityAnalysisFactSource.Access,
  [DataSecurityAnalysisFactKind.ServiceUse]:
    DataSecurityAnalysisFactSource.Access,
  [DataSecurityAnalysisFactKind.NothingUsesIt]:
    DataSecurityAnalysisFactSource.Access,
  [DataSecurityAnalysisFactKind.Copy]: DataSecurityAnalysisFactSource.Flow,
  [DataSecurityAnalysisFactKind.SecurityCase]:
    DataSecurityAnalysisFactSource.SecurityCase,
  [DataSecurityAnalysisFactKind.Response]: DataSecurityAnalysisFactSource.Store,
  [DataSecurityAnalysisFactKind.Proposal]:
    DataSecurityAnalysisFactSource.Proposal,
  [DataSecurityAnalysisFactKind.DeclaredCode]:
    DataSecurityAnalysisFactSource.Code,
  [DataSecurityAnalysisFactKind.Owners]: DataSecurityAnalysisFactSource.Owner,
  [DataSecurityAnalysisFactKind.NoOwner]: DataSecurityAnalysisFactSource.Owner,
};

/*
 * How long ago something was last used or seen, in buckets: the analysis is
 * written from these, never from a time, so its input does not change by
 * the hour.
 */
export enum DataSecurityRecency {
  Day = "Day",
  Week = "Week",
  Month = "Month",
  // Within the 90 days access reviews look back over.
  Quarter = "Quarter",
  Older = "Older",
  // The cloud records no use since it was made, long ago.
  Never = "Never",
  // The cloud does not say.
  Unknown = "Unknown",
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export function getDataSecurityRecency(data: {
  at: Date | string | null | undefined;
  now: Date;
  // The cloud records no use at all, and it was made long ago (isAccessUnused).
  hasNoRecordedUse?: boolean | undefined;
}): DataSecurityRecency {
  const time: number = data.at ? new Date(data.at).getTime() : NaN;

  if (!Number.isFinite(time)) {
    return data.hasNoRecordedUse
      ? DataSecurityRecency.Never
      : DataSecurityRecency.Unknown;
  }

  const age: number = data.now.getTime() - time;

  if (age <= DAY_IN_MS) {
    return DataSecurityRecency.Day;
  }

  if (age <= 7 * DAY_IN_MS) {
    return DataSecurityRecency.Week;
  }

  if (age <= 30 * DAY_IN_MS) {
    return DataSecurityRecency.Month;
  }

  if (age <= 90 * DAY_IN_MS) {
    return DataSecurityRecency.Quarter;
  }

  return DataSecurityRecency.Older;
}

// Used or seen within the 90 days access reviews look back over.
export function isRecentDataSecurityRecency(
  recency: DataSecurityRecency | string | undefined,
): boolean {
  return (
    recency === DataSecurityRecency.Day ||
    recency === DataSecurityRecency.Week ||
    recency === DataSecurityRecency.Month ||
    recency === DataSecurityRecency.Quarter
  );
}

export function isDataSecurityRecency(
  value: unknown,
): value is DataSecurityRecency {
  return (
    typeof value === "string" &&
    (Object.values(DataSecurityRecency) as Array<string>).includes(value)
  );
}

// How the card and the model read a recency.
export const DATA_SECURITY_RECENCY_TITLES: Readonly<
  Record<DataSecurityRecency, string>
> = {
  [DataSecurityRecency.Day]: translationKey("in the last day"),
  [DataSecurityRecency.Week]: translationKey("in the last week"),
  [DataSecurityRecency.Month]: translationKey("in the last 30 days"),
  [DataSecurityRecency.Quarter]: translationKey("in the last 90 days"),
  [DataSecurityRecency.Older]: translationKey("more than 90 days ago"),
  [DataSecurityRecency.Never]: translationKey(
    "never, as far as its cloud says",
  ),
  [DataSecurityRecency.Unknown]: translationKey("not known"),
};

/*
 * A count, as "about how many": exact below a hundred, else to two
 * significant digits - 12,345 records is about 12,000 - so a scan that
 * reads a few more rows changes nothing.
 */
export function roundDataSecurityCount(
  value: number | null | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const whole: number = Math.round(value);

  if (whole < 100) {
    return whole;
  }

  const digits: number = Math.floor(Math.log10(whole)) + 1;
  const unit: number = Math.pow(10, digits - 2);

  return Math.round(whole / unit) * unit;
}

/*
 * ---------------------------------------------------------------------------
 * The facts
 * ---------------------------------------------------------------------------
 */

interface FactBase<Kind extends DataSecurityAnalysisFactKind> {
  // "S1", "R2": what a line names it by.
  id: string;
  kind: Kind;
  /*
   * The records it was read from, by id: whoever reads the analysis must be
   * able to read each. None means the store's records of its source - who
   * can reach it, its owners - and the reader must be able to read those.
   */
  recordIds: Array<string>;
}

export interface IssueFact
  extends FactBase<DataSecurityAnalysisFactKind.Issue> {
  checkId: string;
  severity: string;
}

export interface StoreHoldsFact
  extends FactBase<DataSecurityAnalysisFactKind.StoreHolds> {
  dataTypeIds: Array<string>;
  // The names they were sent by: a project's own type by the name it gave it.
  dataTypeNames: Array<string>;
  sensitivity: string;
  // About how many, rounded (roundDataSecurityCount).
  records?: number | undefined;
  objects?: number | undefined;
}

export interface StoreExposureFact
  extends FactBase<DataSecurityAnalysisFactKind.StoreExposure> {
  exposure: string;
  isPublicByDesign: boolean;
  // Why its cloud says it is public, in the cloud's words.
  publicReason?: string | undefined;
}

export interface StoreIdentityFact
  extends FactBase<DataSecurityAnalysisFactKind.StoreIdentity> {
  name: string;
  storeKind: string;
  environment?: string | undefined;
  // Its cloud tags, each [key, value].
  tags: Array<[string, string]>;
}

export interface PlaceFact
  extends FactBase<DataSecurityAnalysisFactKind.Place> {
  dataTypeId: string;
  dataTypeName: string;
  location: string;
  locationKind?: string | undefined;
}

export interface ReachFact
  extends FactBase<DataSecurityAnalysisFactKind.Reach> {
  identities: number;
  publicGrants: number;
  externalGrants: number;
  writeGrants: number;
  // Identities that used their access in the last 90 days.
  usedLately: number;
}

export interface GrantFact
  extends FactBase<DataSecurityAnalysisFactKind.Grant> {
  principal: string;
  principalType: string;
  accessLevel: string;
  grantedVia: string;
  isPublic: boolean;
  isExternal: boolean;
  lastUsed: DataSecurityRecency;
  // Whether the fix for this issue's check takes it away (getGrantsTheFixRemoves).
  isRemovedByFix: boolean;
}

export interface ServiceUseFact
  extends FactBase<DataSecurityAnalysisFactKind.ServiceUse> {
  serviceId?: string | undefined;
  serviceName: string;
  lastSeen: DataSecurityRecency;
}

export type NothingUsesItFact =
  FactBase<DataSecurityAnalysisFactKind.NothingUsesIt>;

export interface CopyFact extends FactBase<DataSecurityAnalysisFactKind.Copy> {
  otherStoreId: string;
  otherStoreName: string;
  otherStoreKind?: string | undefined;
  otherEnvironment?: string | undefined;
  // The other store holds a copy of this one's data (else this holds its).
  isCopyOfThisStore: boolean;
  overlapPercent?: number | undefined;
}

export interface SecurityCaseFact
  extends FactBase<DataSecurityAnalysisFactKind.SecurityCase> {
  securityCaseId: string;
}

export interface ResponseFact
  extends FactBase<DataSecurityAnalysisFactKind.Response> {
  action: string;
  isAvailable: boolean;
  // Why it cannot run now (DataSecurityResponseUnavailableReason).
  unavailableReason?: string | undefined;
}

export interface ProposalFact
  extends FactBase<DataSecurityAnalysisFactKind.Proposal> {
  proposalId: string;
  proposalKind: string;
  status: string;
}

export interface DeclaredCodeFact
  extends FactBase<DataSecurityAnalysisFactKind.DeclaredCode> {
  repositoryId: string;
  repositoryName: string;
  // The files that name the store, at most a few.
  paths: Array<string>;
  // Terraform, CloudFormation, ...
  codeKind: string;
  // Why this repository (DeclaredCodeOwnerReason).
  reason: string;
}

export interface OwnersFact
  extends FactBase<DataSecurityAnalysisFactKind.Owners> {
  // For the card: never sent to OneUptime AI, which is told how many.
  ownerNames: Array<string>;
  owners: number;
}

export type NoOwnerFact = FactBase<DataSecurityAnalysisFactKind.NoOwner>;

export type DataSecurityAnalysisFact =
  | IssueFact
  | StoreHoldsFact
  | StoreExposureFact
  | StoreIdentityFact
  | PlaceFact
  | ReachFact
  | GrantFact
  | ServiceUseFact
  | NothingUsesItFact
  | CopyFact
  | SecurityCaseFact
  | ResponseFact
  | ProposalFact
  | DeclaredCodeFact
  | OwnersFact
  | NoOwnerFact;

export function getAnalysisFactSource(
  fact: Pick<DataSecurityAnalysisFact, "kind">,
): DataSecurityAnalysisFactSource {
  return DATA_SECURITY_ANALYSIS_FACT_KIND_SOURCES[fact.kind];
}

/*
 * The names a fact carries that a line could say without naming the fact:
 * who has a grant, a service, another store, a repository and its files, an
 * owner. A line that says one rests on its fact, cited or not
 * (holdAnalysisToFacts), so a reader who may not read the fact never reads
 * the name. Short names are left out: "S3" is a word, not a mention.
 */
const MIN_MENTION_LENGTH: number = 4;

export function getAnalysisFactMentions(
  fact: DataSecurityAnalysisFact,
): Array<string> {
  const names: Array<string> = [];

  switch (fact.kind) {
    case DataSecurityAnalysisFactKind.Grant:
      names.push(fact.principal);
      break;
    case DataSecurityAnalysisFactKind.ServiceUse:
      names.push(fact.serviceName);
      break;
    case DataSecurityAnalysisFactKind.Copy:
      names.push(fact.otherStoreName);
      break;
    case DataSecurityAnalysisFactKind.DeclaredCode:
      names.push(fact.repositoryName, ...fact.paths);
      break;
    case DataSecurityAnalysisFactKind.Owners:
      names.push(...fact.ownerNames);
      break;
    default:
      break;
  }

  return names
    .map((name: string): string => {
      return (name || "").trim().toLowerCase();
    })
    .filter((name: string): boolean => {
      return name.length >= MIN_MENTION_LENGTH;
    });
}

/*
 * ---------------------------------------------------------------------------
 * What the fix removes
 * ---------------------------------------------------------------------------
 */

// Which grants a check's fix takes away.
export enum DataSecurityGrantsRemovedByFix {
  // Blocking public access: every public grant.
  Public = "Public",
  // Revoking sharing: every public grant and every grant outside the connected accounts.
  PublicAndExternal = "PublicAndExternal",
  // Turning off object ACLs, or turning on uniform access: every ACL grant.
  Acl = "Acl",
  // Removing access nobody uses: the grants unused for 90 days.
  Unused = "Unused",
}

const GRANTS_REMOVED_BY_CHECK: Readonly<
  Record<string, DataSecurityGrantsRemovedByFix>
> = {
  "public-read": DataSecurityGrantsRemovedByFix.Public,
  "public-write": DataSecurityGrantsRemovedByFix.Public,
  "public-access-not-blocked": DataSecurityGrantsRemovedByFix.Public,
  "snapshot-public": DataSecurityGrantsRemovedByFix.PublicAndExternal,
  "snapshot-shared-externally":
    DataSecurityGrantsRemovedByFix.PublicAndExternal,
  "shared-with-external-accounts":
    DataSecurityGrantsRemovedByFix.PublicAndExternal,
  "object-acls-enabled": DataSecurityGrantsRemovedByFix.Acl,
  "unused-access": DataSecurityGrantsRemovedByFix.Unused,
  "many-readers": DataSecurityGrantsRemovedByFix.Unused,
};

export function getGrantsTheFixRemoves(
  checkId: string | undefined,
): DataSecurityGrantsRemovedByFix | null {
  return (checkId && GRANTS_REMOVED_BY_CHECK[checkId]) || null;
}

const ACL_GRANT: RegExp = /\bACLs?\b/i;

// Whether the fix for a check takes this grant away.
export function isGrantRemovedByFix(
  checkId: string | undefined,
  grant: {
    isPublic?: boolean | undefined;
    isExternal?: boolean | undefined;
    isUnused?: boolean | undefined;
    grantedVia?: string | undefined;
  },
): boolean {
  switch (getGrantsTheFixRemoves(checkId)) {
    case DataSecurityGrantsRemovedByFix.Public:
      return grant.isPublic === true;
    case DataSecurityGrantsRemovedByFix.PublicAndExternal:
      return grant.isPublic === true || grant.isExternal === true;
    case DataSecurityGrantsRemovedByFix.Acl:
      return ACL_GRANT.test(grant.grantedVia || "");
    case DataSecurityGrantsRemovedByFix.Unused:
      return grant.isUnused === true;
    default:
      return false;
  }
}

/*
 * ---------------------------------------------------------------------------
 * The analysis, as OneUptime AI wrote it and as it is kept
 * ---------------------------------------------------------------------------
 */

export const DATA_SECURITY_ANALYSIS_LIMITS: {
  // The longest line kept: one or two plain sentences.
  maxLineLength: number;
  // The shortest line that says anything.
  minLineLength: number;
  // The most facts one line names.
  maxFactsPerLine: number;
  // The most facts an analysis keeps.
  maxFacts: number;
} = {
  maxLineLength: 400,
  minLineLength: 8,
  maxFactsPerLine: 16,
  maxFacts: 120,
};

export interface DataSecurityAnalysisLine {
  // OneUptime AI's words, in the analysis's language: plain text, one line.
  text: string;
  // The ids of the facts it rests on, every one of them a fact of the analysis.
  facts: Array<string>;
}

// What the issue keeps (DataSecurityIssue.aiAnalysis): read by the route, never as it is.
export interface DataSecurityIssueAnalysisRecord {
  version: number;
  verdict: DataSecurityAiVerdict;
  // The language its lines are written in ("en", "de").
  language: string;
  lines: Partial<Record<DataSecurityAnalysisPart, DataSecurityAnalysisLine>>;
  facts: Array<DataSecurityAnalysisFact>;
}

// Bumped when what the analysis is asked changes, so every issue is analyzed again once.
export const DATA_SECURITY_ANALYSIS_VERSION: number = 1;

/*
 * OneUptime AI's answer, as read (StrictAnswer): its verdict, and each line
 * with the ids it says it rests on - not yet held to the facts.
 */
export interface DataSecurityAnalysisAnswer {
  verdict: string;
  lines: Partial<
    Record<DataSecurityAnalysisPart, { text: string; facts: Array<string> }>
  >;
}

// What a line may not say: the ids of facts, which the card folds out instead.
const FACT_IDS_IN_TEXT: RegExp =
  /\s*[([](\s*[A-Z]\d{1,3}\s*(?:[,;]\s*[A-Z]\d{1,3}\s*)*)[)\]]/g;

function withoutFactIds(text: string, ids: ReadonlySet<string>): string {
  return text.replace(FACT_IDS_IN_TEXT, (whole: string, inner: string) => {
    const named: Array<string> = inner.split(/[,;]/).map((id: string) => {
      return id.trim();
    });

    return named.every((id: string): boolean => {
      return ids.has(id);
    })
      ? ""
      : whole;
  });
}

function cutLine(text: string): string {
  const characters: Array<string> = Array.from(text);

  return characters.length > DATA_SECURITY_ANALYSIS_LIMITS.maxLineLength
    ? `${characters
        .slice(0, DATA_SECURITY_ANALYSIS_LIMITS.maxLineLength - 1)
        .join("")}…`
    : text;
}

/*
 * The facts a line says by name, whether it cites them or not: what a reader
 * who may not read them must not read in it.
 */
function getMentionedFactIds(
  text: string,
  facts: ReadonlyArray<DataSecurityAnalysisFact>,
): Array<string> {
  const lower: string = text.toLowerCase();

  return facts
    .filter((fact: DataSecurityAnalysisFact): boolean => {
      return getAnalysisFactMentions(fact).some((name: string): boolean => {
        return lower.includes(name);
      });
    })
    .map((fact: DataSecurityAnalysisFact): string => {
      return fact.id;
    });
}

/*
 * One line held to the facts: the ids it cites that are facts of the
 * analysis, and the facts it names without citing; none it cites, or too
 * little said, and it is dropped.
 */
function holdLine(
  raw: { text: string; facts: Array<string> } | undefined,
  facts: ReadonlyArray<DataSecurityAnalysisFact>,
  ids: ReadonlySet<string>,
): DataSecurityAnalysisLine | null {
  if (!raw || typeof raw.text !== "string") {
    return null;
  }

  const text: string = cutLine(
    withoutFactIds(raw.text.replace(/\s+/g, " ").trim(), ids)
      .replace(/\s+/g, " ")
      .trim(),
  );

  if (Array.from(text).length < DATA_SECURITY_ANALYSIS_LIMITS.minLineLength) {
    return null;
  }

  const cited: Array<string> = [];

  for (const id of raw.facts || []) {
    const known: string = typeof id === "string" ? id.trim().toUpperCase() : "";

    if (ids.has(known) && !cited.includes(known)) {
      cited.push(known);
    }
  }

  if (cited.length === 0) {
    return null;
  }

  for (const mentioned of getMentionedFactIds(text, facts)) {
    if (!cited.includes(mentioned)) {
      cited.push(mentioned);
    }
  }

  return {
    text,
    facts: cited.slice(0, DATA_SECURITY_ANALYSIS_LIMITS.maxFactsPerLine * 2),
  };
}

function isRestrictedStore(
  facts: ReadonlyArray<DataSecurityAnalysisFact>,
): boolean {
  return facts.some((fact: DataSecurityAnalysisFact): boolean => {
    return (
      fact.kind === DataSecurityAnalysisFactKind.StoreHolds &&
      fact.sensitivity === DataSensitivity.Restricted
    );
  });
}

/*
 * OneUptime AI's answer held to its facts, or null when it gave no verdict
 * of the four:
 *
 *   - every line keeps only the ids of facts it was given, and is dropped
 *     when it names none, or says too little; a line that names a fact's
 *     store, service, identity, repository or owner rests on that fact too;
 *   - a verdict is a claim like any other: without a reason that rests on a
 *     fact it is Cannot tell;
 *   - said with care: a store of Restricted data - secrets, card numbers,
 *     health records - is never "Likely by design" on OneUptime AI's word
 *     (Cannot tell, and a person decides);
 *   - the reason a person could give is kept only where the verdict says it
 *     is by design or a wrong finding.
 *
 * It never changes the issue: what it returns is only ever kept and shown.
 */
export function holdAnalysisToFacts(data: {
  answer: DataSecurityAnalysisAnswer;
  facts: ReadonlyArray<DataSecurityAnalysisFact>;
  language: string;
}): DataSecurityIssueAnalysisRecord | null {
  if (!isDataSecurityAiVerdict(data.answer.verdict)) {
    return null;
  }

  const ids: Set<string> = new Set(
    data.facts.map((fact: DataSecurityAnalysisFact): string => {
      return fact.id;
    }),
  );
  const lines: Partial<
    Record<DataSecurityAnalysisPart, DataSecurityAnalysisLine>
  > = {};

  for (const part of DATA_SECURITY_ANALYSIS_PARTS) {
    const line: DataSecurityAnalysisLine | null = holdLine(
      data.answer.lines[part],
      data.facts,
      ids,
    );

    if (line) {
      lines[part] = line;
    }
  }

  let verdict: DataSecurityAiVerdict = data.answer.verdict;

  if (verdict !== DataSecurityAiVerdict.CannotTell && !lines.reason) {
    verdict = DataSecurityAiVerdict.CannotTell;
  }

  if (
    verdict === DataSecurityAiVerdict.LikelyByDesign &&
    isRestrictedStore(data.facts)
  ) {
    verdict = DataSecurityAiVerdict.CannotTell;
    delete lines.reason;
  }

  if (
    verdict !== DataSecurityAiVerdict.LikelyByDesign &&
    verdict !== DataSecurityAiVerdict.LikelyWrongFinding
  ) {
    delete lines.draft;
  }

  return {
    version: DATA_SECURITY_ANALYSIS_VERSION,
    verdict,
    language: data.language,
    lines,
    facts: [...data.facts],
  };
}

/*
 * ---------------------------------------------------------------------------
 * Reading what was kept
 * ---------------------------------------------------------------------------
 */

function readString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStrings(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => {
        return typeof item === "string";
      })
    : [];
}

function readRecency(value: unknown): DataSecurityRecency {
  return isDataSecurityRecency(value) ? value : DataSecurityRecency.Unknown;
}

function readTags(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags: Array<[string, string]> = [];

  for (const pair of value) {
    if (
      Array.isArray(pair) &&
      typeof pair[0] === "string" &&
      typeof pair[1] === "string"
    ) {
      tags.push([pair[0], pair[1]]);
    }
  }

  return tags;
}

function isFactKind(value: unknown): value is DataSecurityAnalysisFactKind {
  return (
    typeof value === "string" &&
    (Object.values(DataSecurityAnalysisFactKind) as Array<string>).includes(
      value,
    )
  );
}

/*
 * One kept fact, read defensively: the column is JSON, and a newer server
 * may have written a kind this build does not know - left out, never drawn
 * as something it is not.
 */
export function readAnalysisFact(
  value: unknown,
): DataSecurityAnalysisFact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const id: string = readString(raw["id"]);
  const kind: unknown = raw["kind"];

  if (!id || !isFactKind(kind)) {
    return null;
  }

  const recordIds: Array<string> = readStrings(raw["recordIds"]);

  switch (kind) {
    case DataSecurityAnalysisFactKind.Issue:
      return {
        id,
        kind,
        recordIds,
        checkId: readString(raw["checkId"]),
        severity: readString(raw["severity"]),
      };
    case DataSecurityAnalysisFactKind.StoreHolds:
      return {
        id,
        kind,
        recordIds,
        dataTypeIds: readStrings(raw["dataTypeIds"]),
        dataTypeNames: readStrings(raw["dataTypeNames"]),
        sensitivity: isDataSensitivity(raw["sensitivity"])
          ? (raw["sensitivity"] as string)
          : "",
        records: readNumber(raw["records"]),
        objects: readNumber(raw["objects"]),
      };
    case DataSecurityAnalysisFactKind.StoreExposure:
      return {
        id,
        kind,
        recordIds,
        exposure: readString(raw["exposure"]),
        isPublicByDesign: raw["isPublicByDesign"] === true,
        publicReason: readOptionalString(raw["publicReason"]),
      };
    case DataSecurityAnalysisFactKind.StoreIdentity:
      return {
        id,
        kind,
        recordIds,
        name: readString(raw["name"]),
        storeKind: readString(raw["storeKind"]),
        environment: readOptionalString(raw["environment"]),
        tags: readTags(raw["tags"]),
      };
    case DataSecurityAnalysisFactKind.Place:
      return {
        id,
        kind,
        recordIds,
        dataTypeId: readString(raw["dataTypeId"]),
        dataTypeName: readString(raw["dataTypeName"]),
        location: readString(raw["location"]),
        locationKind: readOptionalString(raw["locationKind"]),
      };
    case DataSecurityAnalysisFactKind.Reach:
      return {
        id,
        kind,
        recordIds,
        identities: readNumber(raw["identities"]) || 0,
        publicGrants: readNumber(raw["publicGrants"]) || 0,
        externalGrants: readNumber(raw["externalGrants"]) || 0,
        writeGrants: readNumber(raw["writeGrants"]) || 0,
        usedLately: readNumber(raw["usedLately"]) || 0,
      };
    case DataSecurityAnalysisFactKind.Grant:
      return {
        id,
        kind,
        recordIds,
        principal: readString(raw["principal"]),
        principalType: readString(raw["principalType"]),
        accessLevel: readString(raw["accessLevel"]),
        grantedVia: readString(raw["grantedVia"]),
        isPublic: raw["isPublic"] === true,
        isExternal: raw["isExternal"] === true,
        lastUsed: readRecency(raw["lastUsed"]),
        isRemovedByFix: raw["isRemovedByFix"] === true,
      };
    case DataSecurityAnalysisFactKind.ServiceUse:
      return {
        id,
        kind,
        recordIds,
        serviceId: readOptionalString(raw["serviceId"]),
        serviceName: readString(raw["serviceName"]),
        lastSeen: readRecency(raw["lastSeen"]),
      };
    case DataSecurityAnalysisFactKind.Copy:
      return {
        id,
        kind,
        recordIds,
        otherStoreId: readString(raw["otherStoreId"]),
        otherStoreName: readString(raw["otherStoreName"]),
        otherStoreKind: readOptionalString(raw["otherStoreKind"]),
        otherEnvironment: readOptionalString(raw["otherEnvironment"]),
        isCopyOfThisStore: raw["isCopyOfThisStore"] === true,
        overlapPercent: readNumber(raw["overlapPercent"]),
      };
    case DataSecurityAnalysisFactKind.SecurityCase:
      return {
        id,
        kind,
        recordIds,
        securityCaseId: readString(raw["securityCaseId"]),
      };
    case DataSecurityAnalysisFactKind.Response:
      return {
        id,
        kind,
        recordIds,
        action: readString(raw["action"]),
        isAvailable: raw["isAvailable"] === true,
        unavailableReason: readOptionalString(raw["unavailableReason"]),
      };
    case DataSecurityAnalysisFactKind.Proposal:
      return {
        id,
        kind,
        recordIds,
        proposalId: readString(raw["proposalId"]),
        proposalKind: readString(raw["proposalKind"]),
        status: readString(raw["status"]),
      };
    case DataSecurityAnalysisFactKind.DeclaredCode:
      return {
        id,
        kind,
        recordIds,
        repositoryId: readString(raw["repositoryId"]),
        repositoryName: readString(raw["repositoryName"]),
        paths: readStrings(raw["paths"]),
        codeKind: readString(raw["codeKind"]),
        reason: readString(raw["reason"]),
      };
    case DataSecurityAnalysisFactKind.Owners:
      return {
        id,
        kind,
        recordIds,
        ownerNames: readStrings(raw["ownerNames"]),
        owners: readNumber(raw["owners"]) || 0,
      };
    case DataSecurityAnalysisFactKind.NothingUsesIt:
    case DataSecurityAnalysisFactKind.NoOwner:
      return { id, kind, recordIds } as DataSecurityAnalysisFact;
  }
}

function readLine(
  value: unknown,
  ids: ReadonlySet<string>,
): DataSecurityAnalysisLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const text: string = readString(raw["text"]).trim();
  const facts: Array<string> = readStrings(raw["facts"]).filter(
    (id: string): boolean => {
      return ids.has(id);
    },
  );

  return text && facts.length > 0 ? { text, facts } : null;
}

/*
 * The analysis an issue keeps, read defensively, or null: no analysis, or
 * one this build cannot read. A line whose facts were not kept is left out.
 */
export function readDataSecurityIssueAnalysis(
  value: unknown,
): DataSecurityIssueAnalysisRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const verdict: unknown = raw["verdict"];

  if (!isDataSecurityAiVerdict(verdict)) {
    return null;
  }

  const facts: Array<DataSecurityAnalysisFact> = (
    Array.isArray(raw["facts"]) ? (raw["facts"] as Array<unknown>) : []
  )
    .map(readAnalysisFact)
    .filter(
      (
        fact: DataSecurityAnalysisFact | null,
      ): fact is DataSecurityAnalysisFact => {
        return fact !== null;
      },
    )
    .slice(0, DATA_SECURITY_ANALYSIS_LIMITS.maxFacts);
  const ids: Set<string> = new Set(
    facts.map((fact: DataSecurityAnalysisFact): string => {
      return fact.id;
    }),
  );
  const rawLines: unknown = raw["lines"];
  const lines: Partial<
    Record<DataSecurityAnalysisPart, DataSecurityAnalysisLine>
  > = {};

  if (rawLines && typeof rawLines === "object" && !Array.isArray(rawLines)) {
    for (const part of DATA_SECURITY_ANALYSIS_PARTS) {
      const line: DataSecurityAnalysisLine | null = readLine(
        (rawLines as Record<string, unknown>)[part],
        ids,
      );

      if (line) {
        lines[part] = line;
      }
    }
  }

  return {
    version: readNumber(raw["version"]) || DATA_SECURITY_ANALYSIS_VERSION,
    verdict,
    language: readString(raw["language"], "en") || "en",
    lines,
    facts,
  };
}

/*
 * The analysis as the server served it to its reader (getAnalysisView),
 * read defensively by the Dashboard, or null for none: its lines and facts
 * as readDataSecurityIssueAnalysis reads them, and the lines hidden from
 * the reader, by what they may not read.
 */
export function readDataSecurityIssueAnalysisView(
  value: unknown,
): DataSecurityIssueAnalysisView | null {
  const record: DataSecurityIssueAnalysisRecord | null =
    readDataSecurityIssueAnalysis(value);

  if (!record) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const rawHidden: unknown = raw["hiddenLines"];
  const hiddenLines: Partial<
    Record<DataSecurityAnalysisPart, Array<DataSecurityAnalysisFactSource>>
  > = {};

  if (rawHidden && typeof rawHidden === "object" && !Array.isArray(rawHidden)) {
    for (const part of DATA_SECURITY_ANALYSIS_PARTS) {
      const sources: Array<DataSecurityAnalysisFactSource> = readStrings(
        (rawHidden as Record<string, unknown>)[part],
      ).filter((source: string): source is DataSecurityAnalysisFactSource => {
        return (
          DATA_SECURITY_ANALYSIS_FACT_SOURCES as ReadonlyArray<string>
        ).includes(source);
      });

      if (sources.length > 0 && !record.lines[part]) {
        hiddenLines[part] = sources;
      }
    }
  }

  return {
    verdict: record.verdict,
    analyzedAt: readOptionalString(raw["analyzedAt"]),
    language: record.language,
    lines: record.lines,
    hiddenLines,
    facts: record.facts,
  };
}

// The analysis as the issue keeps it: plain JSON.
export function toDataSecurityIssueAnalysisJson(
  record: DataSecurityIssueAnalysisRecord,
): JSONObject {
  return JSON.parse(JSON.stringify(record)) as JSONObject;
}

/*
 * ---------------------------------------------------------------------------
 * The analysis, as one reader may read it
 * ---------------------------------------------------------------------------
 */

export interface DataSecurityIssueAnalysisView {
  verdict: DataSecurityAiVerdict;
  // When it was written, ISO.
  analyzedAt?: string | undefined;
  language: string;
  // Each line the reader may read.
  lines: Partial<Record<DataSecurityAnalysisPart, DataSecurityAnalysisLine>>;
  /*
   * Each line hidden from the reader, with what they may not read that it
   * rests on.
   */
  hiddenLines: Partial<
    Record<DataSecurityAnalysisPart, Array<DataSecurityAnalysisFactSource>>
  >;
  // The facts the reader may read: what the card folds out, and its buttons.
  facts: Array<DataSecurityAnalysisFact>;
}

/*
 * The analysis as a reader may read it, from the ids of the facts they may
 * read (DataSecurityIssueAnalysisReader works those out with their own
 * permissions): every fact they may not read is left out, and so is every
 * line resting on one - said, by what they may not read, instead.
 */
export function getAnalysisView(data: {
  record: DataSecurityIssueAnalysisRecord;
  readableFactIds: ReadonlySet<string>;
  analyzedAt?: Date | string | null | undefined;
}): DataSecurityIssueAnalysisView {
  const byId: Map<string, DataSecurityAnalysisFact> = new Map(
    data.record.facts.map(
      (fact: DataSecurityAnalysisFact): [string, DataSecurityAnalysisFact] => {
        return [fact.id, fact];
      },
    ),
  );
  const lines: Partial<
    Record<DataSecurityAnalysisPart, DataSecurityAnalysisLine>
  > = {};
  const hiddenLines: Partial<
    Record<DataSecurityAnalysisPart, Array<DataSecurityAnalysisFactSource>>
  > = {};

  for (const part of DATA_SECURITY_ANALYSIS_PARTS) {
    const line: DataSecurityAnalysisLine | undefined = data.record.lines[part];

    if (!line) {
      continue;
    }

    const hidden: Array<DataSecurityAnalysisFactSource> = [];

    for (const id of line.facts) {
      const fact: DataSecurityAnalysisFact | undefined = byId.get(id);

      if (!fact) {
        continue;
      }

      if (!data.readableFactIds.has(id)) {
        const source: DataSecurityAnalysisFactSource =
          getAnalysisFactSource(fact);

        if (!hidden.includes(source)) {
          hidden.push(source);
        }
      }
    }

    if (hidden.length > 0) {
      hiddenLines[part] = hidden;
    } else {
      lines[part] = line;
    }
  }

  const analyzedAt: Date | null = data.analyzedAt
    ? new Date(data.analyzedAt)
    : null;

  return {
    verdict: data.record.verdict,
    analyzedAt:
      analyzedAt && !Number.isNaN(analyzedAt.getTime())
        ? analyzedAt.toISOString()
        : undefined,
    language: data.record.language,
    lines,
    hiddenLines,
    facts: data.record.facts.filter((fact: DataSecurityAnalysisFact) => {
      return data.readableFactIds.has(fact.id);
    }),
  };
}

// The facts a line rests on, as a reader may read them, in the line's order.
export function getLineFacts(
  view: Pick<DataSecurityIssueAnalysisView, "facts">,
  line: DataSecurityAnalysisLine,
): Array<DataSecurityAnalysisFact> {
  const byId: Map<string, DataSecurityAnalysisFact> = new Map(
    view.facts.map(
      (fact: DataSecurityAnalysisFact): [string, DataSecurityAnalysisFact] => {
        return [fact.id, fact];
      },
    ),
  );

  return line.facts
    .map((id: string): DataSecurityAnalysisFact | undefined => {
      return byId.get(id);
    })
    .filter(
      (
        fact: DataSecurityAnalysisFact | undefined,
      ): fact is DataSecurityAnalysisFact => {
        return Boolean(fact);
      },
    );
}

// The first fact of a kind the reader may read, for the card's buttons.
export function findAnalysisFact<Kind extends DataSecurityAnalysisFactKind>(
  view: Pick<DataSecurityIssueAnalysisView, "facts">,
  kind: Kind,
): Extract<DataSecurityAnalysisFact, { kind: Kind }> | undefined {
  return view.facts.find((fact: DataSecurityAnalysisFact): boolean => {
    return fact.kind === kind;
  }) as Extract<DataSecurityAnalysisFact, { kind: Kind }> | undefined;
}

export function findAnalysisFacts<Kind extends DataSecurityAnalysisFactKind>(
  view: Pick<DataSecurityIssueAnalysisView, "facts">,
  kind: Kind,
): Array<Extract<DataSecurityAnalysisFact, { kind: Kind }>> {
  return view.facts.filter((fact: DataSecurityAnalysisFact): boolean => {
    return fact.kind === kind;
  }) as Array<Extract<DataSecurityAnalysisFact, { kind: Kind }>>;
}

/*
 * ---------------------------------------------------------------------------
 * The input's hash
 * ---------------------------------------------------------------------------
 */

/*
 * What an analysis was written from, in sixty-four hex digits: the data
 * OneUptime AI is sent - the facts, in buckets and rounded - the language
 * it writes in, and the version of what it is asked. An evaluation whose
 * input hashes the same as the analysis the issue keeps makes no model call.
 */
export function getAnalysisInputHash(data: {
  data: JSONValue;
  language: string;
  version?: number | undefined;
}): string {
  return sha256Hex(
    toStableJsonText({
      version: data.version ?? DATA_SECURITY_ANALYSIS_VERSION,
      language: data.language,
      data: data.data,
    }),
  );
}

export const DATA_SECURITY_ANALYSIS_INPUT_HASH_PATTERN: RegExp =
  /^[0-9a-f]{64}$/;
