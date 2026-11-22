import { escapeRegExp } from "../../Utils/RegExpEscape";
import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { translationKey } from "../Translator";
import { toStableJsonText } from "./DataSecurityAi";

/*
 * ISSUES ONE MISTAKE MADE (#10370): A GROUP OF DATA SECURITY ISSUES WITH ONE
 * CAUSE, SO THE CAUSE IS FIXED ONCE.
 *
 * Issues are per store and per check. One Terraform module that makes
 * buckets without access logs, used forty times, is forty issues - and
 * forty pull requests to the same file if each is fixed on its own. So
 * issues of the same check whose stores share what made them are one group:
 *
 *   - the file or module that declares them, found in a connected
 *     repository (DeclaredCodeOwner, through the module or stack their tags
 *     name);
 *   - the CloudFormation stack that made them (its own tag,
 *     aws:cloudformation:stack-name);
 *   - a tag that names what made them: module=static-site, stack=web,
 *     component=uploads - never one they merely share, such as env=prod or
 *     team=payments;
 *   - the identity that created them, where the cloud's change log names
 *     it (the terraform-ci role, a person in the console);
 *   - a name pattern they share: *-exports-*.
 *
 * Facts decide the group, strongest first, and OneUptime AI only names it,
 * in a sentence held to those facts (holdIssueGroupNameToFacts): a group the
 * model invented could not be explained, and one wrong group sends a pull
 * request to the wrong module. A group needs MIN_ISSUES_PER_GROUP issues,
 * and an issue is in one group at most. Groups never cross clouds: a
 * module that made an S3 bucket and a Cloud Storage bucket is two fixes.
 *
 * A group follows its issues to the end: an issue that resolves stays in
 * its group, which says how many are fixed and how many are left, and an
 * open issue stays while its store still shares the group's fact.
 *
 * Pure, so the server (Server/Utils/DataSecurity/DataSecurityIssueGrouper),
 * the Dashboard and the eval set read it alike. Stored strings are a
 * contract: never rename one.
 */

export enum DataSecurityIssueGroupCause {
  // The file or module that declares the stores, in a connected repository.
  DeclaredCode = "DeclaredCode",
  // The CloudFormation stack that made them.
  Stack = "Stack",
  // A tag that names what made them: module=static-site, stack=web.
  Tags = "Tags",
  // The identity that created them, as the cloud's change log names it.
  Creator = "Creator",
  // A name pattern they share: *-exports-*.
  NamePattern = "NamePattern",
}

// Strongest first: the order a group's fact is chosen in, and the docs list.
export const DATA_SECURITY_ISSUE_GROUP_CAUSES: ReadonlyArray<DataSecurityIssueGroupCause> =
  [
    DataSecurityIssueGroupCause.DeclaredCode,
    DataSecurityIssueGroupCause.Stack,
    DataSecurityIssueGroupCause.Tags,
    DataSecurityIssueGroupCause.Creator,
    DataSecurityIssueGroupCause.NamePattern,
  ];

export function isDataSecurityIssueGroupCause(
  value: unknown,
): value is DataSecurityIssueGroupCause {
  return (
    typeof value === "string" &&
    (DATA_SECURITY_ISSUE_GROUP_CAUSES as ReadonlyArray<string>).includes(value)
  );
}

// The fewest issues a group holds.
export const MIN_ISSUES_PER_GROUP: number = 2;

/*
 * The checks one mistake can fail on many stores at once: each reads a
 * store's own configuration, which the code or the person that made the
 * store set - its exposure, encryption, recovery, logging, ACLs, keys and
 * region. A check of what a store holds (a secret, a card number, stale
 * data), of who can reach it (each grant is its own), of whom it belongs
 * to, or of telemetry (each service writes its own) is no group's: the
 * cause differs store by store.
 */
export const DATA_SECURITY_ISSUE_GROUP_CHECK_IDS: ReadonlyArray<string> = [
  "public-read",
  "public-write",
  "public-access-not-blocked",
  "internet-reachable",
  "open-to-all-addresses",
  "snapshot-public",
  "snapshot-shared-externally",
  "shared-with-external-accounts",
  "not-encrypted-at-rest",
  "no-customer-managed-key",
  "encryption-in-transit-not-enforced",
  "weak-tls",
  "no-backups",
  "no-point-in-time-recovery",
  "deletion-protection-off",
  "deleted-data-not-recoverable",
  "access-not-logged",
  "shared-key-access",
  "object-acls-enabled",
  "residency-violation",
];

// Whether issues of a check are grouped by what made their stores.
export function isIssueGroupCheck(checkId: string | null | undefined): boolean {
  return DATA_SECURITY_ISSUE_GROUP_CHECK_IDS.includes(checkId || "");
}

/*
 * The operations a cloud's change log records when a store is created, as
 * OneUptime's change events name them: AWS's "service:EventName", Google
 * Cloud's method names. Azure records a create and an update as the same
 * write, so it names no creator.
 */
export const DATA_STORE_CREATE_OPERATIONS: ReadonlyArray<string> = [
  "s3:CreateBucket",
  "rds:CreateDBInstance",
  "rds:CreateDBCluster",
  "rds:CreateDBSnapshot",
  "rds:CreateDBClusterSnapshot",
  "rds:CopyDBSnapshot",
  "rds:CopyDBClusterSnapshot",
  "dynamodb:CreateTable",
  "redshift:CreateCluster",
  "es:CreateDomain",
  "es:CreateElasticsearchDomain",
  "elasticfilesystem:CreateFileSystem",
  "elasticache:CreateCacheCluster",
  "elasticache:CreateReplicationGroup",
  "docdb-elastic:CreateCluster",
  "storage.buckets.create",
  "cloudsql.instances.create",
  "google.cloud.bigquery.v2.DatasetService.InsertDataset",
  "datasetservice.insert",
];

/*
 * Group by cause starts on in the Issues list once the project has a group
 * of this many issues or more (the person's own choice wins after that).
 */
export const GROUP_BY_CAUSE_DEFAULT_ON_SIZE: number = 5;

// The longest name, of a group or its cause, kept or shown.
export const MAX_ISSUE_GROUP_NAME_LENGTH: number = 140;
export const MIN_ISSUE_GROUP_NAME_LENGTH: number = 8;

// The longest text a fact keeps of a tag, a stack, an identity or a pattern.
const MAX_FACT_VALUE_LENGTH: number = 200;

/*
 * ---------------------------------------------------------------------------
 * What made a store, from its tags, its name and its change log
 * ---------------------------------------------------------------------------
 */

// What a tag that names what made a store says it is.
export enum DataSecurityIssueGroupTagRole {
  Module = "Module",
  Stack = "Stack",
  Component = "Component",
}

/*
 * The tag keys that name what made a store, compared folded
 * (foldTagKey). A tag the stores merely share - an environment, a team, a
 * cost centre - says nothing of what made them, and is never one.
 */
const CAUSE_TAG_KEYS: ReadonlyArray<{
  key: string;
  role: DataSecurityIssueGroupTagRole;
}> = [
  { key: "module", role: DataSecurityIssueGroupTagRole.Module },
  { key: "tf-module", role: DataSecurityIssueGroupTagRole.Module },
  { key: "terraform-module", role: DataSecurityIssueGroupTagRole.Module },
  { key: "terraform:module", role: DataSecurityIssueGroupTagRole.Module },
  { key: "tf:module", role: DataSecurityIssueGroupTagRole.Module },
  { key: "iac-module", role: DataSecurityIssueGroupTagRole.Module },
  { key: "stack", role: DataSecurityIssueGroupTagRole.Stack },
  { key: "stack-name", role: DataSecurityIssueGroupTagRole.Stack },
  { key: "stackname", role: DataSecurityIssueGroupTagRole.Stack },
  { key: "cdk-stack", role: DataSecurityIssueGroupTagRole.Stack },
  { key: "pulumi:stack", role: DataSecurityIssueGroupTagRole.Stack },
  { key: "pulumi-stack", role: DataSecurityIssueGroupTagRole.Stack },
  { key: "component", role: DataSecurityIssueGroupTagRole.Component },
  { key: "blueprint", role: DataSecurityIssueGroupTagRole.Component },
  { key: "template", role: DataSecurityIssueGroupTagRole.Component },
  { key: "template-name", role: DataSecurityIssueGroupTagRole.Component },
];

// The tag CloudFormation writes on what a stack made: a fact, not a convention.
export const CLOUDFORMATION_STACK_TAG_KEY: string =
  "aws:cloudformation:stack-name";

// A tag key folded: lower case, "_" read as "-".
export function foldTagKey(key: string): string {
  return key.trim().toLowerCase().split("_").join("-");
}

// What a tag key says made the store, or null for a tag that says nothing of it.
export function getCauseTagRole(
  key: string,
): DataSecurityIssueGroupTagRole | null {
  const folded: string = foldTagKey(key);

  return (
    CAUSE_TAG_KEYS.find((entry: { key: string }): boolean => {
      return entry.key === folded;
    })?.role || null
  );
}

// A value as a fact keeps it: one line, held to a length.
function factValue(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_VALUE_LENGTH)
    : "";
}

/*
 * The CloudFormation stack a store's tags say made it, or null. The stack's
 * own tag wins over any tag a person wrote.
 */
export function getStoreStackName(
  tags: Readonly<Record<string, string>>,
): string | null {
  for (const key of Object.keys(tags)) {
    if (key.trim().toLowerCase() === CLOUDFORMATION_STACK_TAG_KEY) {
      return factValue(tags[key]) || null;
    }
  }

  return null;
}

// The tags of a store that name what made it, each [key, value], by key.
export function getStoreCauseTags(
  tags: Readonly<Record<string, string>>,
): Array<[string, string]> {
  const found: Array<[string, string]> = [];

  for (const key of Object.keys(tags).sort()) {
    const value: string = factValue(tags[key]);

    if (value && getCauseTagRole(key)) {
      found.push([key.trim(), value]);
    }
  }

  return found;
}

// An AWS account's root user.
const ROOT_ARN: RegExp = /^arn:aws[a-z-]*:iam::\d*:root$/i;

/*
 * The identity that created a store, as a group compares it: an AWS role
 * by its name alone - each run of a pipeline assumes it under a session of
 * its own - and an IAM user by theirs; anything else as the change log
 * wrote it, lower-cased. Null for none.
 */
export function normalizeCreatorIdentity(
  actor: string | null | undefined,
): string | null {
  const text: string = factValue(actor);

  if (!text) {
    return null;
  }

  // arn:aws:sts::123456789012:assumed-role/terraform-ci/session-123
  const assumed: RegExpMatchArray | null = text.match(
    /^arn:aws[a-z-]*:sts::\d*:assumed-role\/([^/]+)(?:\/.*)?$/i,
  );

  if (assumed) {
    return `role/${assumed[1]!.toLowerCase()}`;
  }

  // arn:aws:iam::123456789012:role/path/terraform-ci
  const role: RegExpMatchArray | null = text.match(
    /^arn:aws[a-z-]*:iam::\d*:role\/(?:.*\/)?([^/]+)$/i,
  );

  if (role) {
    return `role/${role[1]!.toLowerCase()}`;
  }

  // arn:aws:iam::123456789012:user/alice
  const user: RegExpMatchArray | null = text.match(
    /^arn:aws[a-z-]*:iam::\d*:user\/(?:.*\/)?([^/]+)$/i,
  );

  if (user) {
    return `user/${user[1]!.toLowerCase()}`;
  }

  if (ROOT_ARN.test(text)) {
    return "root";
  }

  return text.toLowerCase();
}

/*
 * ---------------------------------------------------------------------------
 * Name patterns
 * ---------------------------------------------------------------------------
 */

/*
 * The words of a store's name that say nothing of what made it: kinds of
 * store, environments, clouds, places. A pattern is never made of one.
 */
const GENERIC_NAME_WORDS: ReadonlyArray<string> = [
  "aws",
  "gcp",
  "azure",
  "gcs",
  "s3",
  "bucket",
  "buckets",
  "blob",
  "blobs",
  "storage",
  "store",
  "stores",
  "data",
  "db",
  "database",
  "databases",
  "table",
  "tables",
  "snapshot",
  "snapshots",
  "cluster",
  "instance",
  "account",
  "prod",
  "production",
  "prd",
  "dev",
  "develop",
  "development",
  "stage",
  "staging",
  "stg",
  "test",
  "testing",
  "qa",
  "uat",
  "sandbox",
  "demo",
  "preview",
  "main",
  "primary",
  "default",
  "new",
  "old",
  "tmp",
  "temp",
  "copy",
  "backup",
  "backups",
  "logs",
  "log",
  "files",
  "file",
  "the",
  "and",
  "for",
  "east",
  "west",
  "north",
  "south",
  "central",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "global",
  "region",
  "zone",
  "us",
  "eu",
  "ap",
  "sa",
  "ca",
  "me",
  "af",
  "uk",
];

// The separators a store's name is read in words by.
const NAME_SEPARATORS: RegExp = /([-_.])/;

interface NameWord {
  word: string;
  // The separator after it, "" for the last.
  separatorAfter: string;
}

// A name as its words, each with the separator after it.
export function readNameWords(name: string): Array<NameWord> {
  const parts: Array<string> = name.trim().toLowerCase().split(NAME_SEPARATORS);
  const words: Array<NameWord> = [];

  for (let index: number = 0; index < parts.length; index += 2) {
    const word: string = parts[index] || "";

    if (!word) {
      continue;
    }

    words.push({ word, separatorAfter: parts[index + 1] || "" });
  }

  return words;
}

const HAS_LETTER: RegExp = /[a-z]/;
// A hash or an id: eight hex digits or more.
const HASH_OR_ID: RegExp = /^[0-9a-f]{8,}$/;
// An account number or a date, with a letter or two.
const NUMBER_WITH_A_LETTER: RegExp = /^[a-z]?\d{4,}[a-z]?$/;

// Whether a word of a name says something a pattern could be made of.
export function isDistinctiveNameWord(word: string): boolean {
  const text: string = word.toLowerCase();

  return (
    text.length >= 3 &&
    HAS_LETTER.test(text) &&
    !HASH_OR_ID.test(text) &&
    !NUMBER_WITH_A_LETTER.test(text) &&
    !GENERIC_NAME_WORDS.includes(text)
  );
}

/*
 * The patterns a name could share with others, one per distinctive word:
 * "acme-exports-2023" gives "*-exports-*" and "acme-*". A one-word name
 * gives none.
 */
export function getNamePatternCandidates(name: string): Array<{
  pattern: string;
  word: string;
}> {
  const words: Array<NameWord> = readNameWords(name);

  if (words.length < 2) {
    return [];
  }

  const found: Array<{ pattern: string; word: string }> = [];

  words.forEach((entry: NameWord, index: number): void => {
    if (!isDistinctiveNameWord(entry.word)) {
      return;
    }

    const before: string = index > 0 ? words[index - 1]!.separatorAfter : "";
    let pattern: string;

    if (index === 0) {
      pattern = `${entry.word}${entry.separatorAfter}*`;
    } else if (index === words.length - 1) {
      pattern = `*${before}${entry.word}`;
    } else {
      pattern = `*${before}${entry.word}${entry.separatorAfter}*`;
    }

    if (
      !found.some((candidate: { pattern: string }): boolean => {
        return candidate.pattern === pattern;
      })
    ) {
      found.push({ pattern, word: entry.word });
    }
  });

  return found;
}

/*
 * The narrowest pattern every name of a group matches: the words they all
 * start and end with, around a "*". "acme-exports-01" and "acme-exports-02"
 * share "acme-exports-*"; "billing-exports-eu" and "acme-exports-01" only
 * "*-exports-*", the pattern they were grouped by. A narrower pattern is
 * kept only when it still holds the word the group is of, and every name
 * matches it.
 */
export function refineNamePattern(
  names: ReadonlyArray<string>,
  pattern: string,
  word?: string | undefined,
): string {
  const all: Array<Array<NameWord>> = names.map(readNameWords);

  if (all.length < 2) {
    return pattern;
  }

  const first: Array<NameWord> = all[0]!;
  const shortest: number = Math.min(
    ...all.map((words: Array<NameWord>): number => {
      return words.length;
    }),
  );
  // Whether every name has the same word, and separator after it, this many from its start.
  const sameFromStart: (index: number) => boolean = (
    index: number,
  ): boolean => {
    return all.every((words: Array<NameWord>): boolean => {
      return (
        words[index]!.word === first[index]!.word &&
        words[index]!.separatorAfter === first[index]!.separatorAfter
      );
    });
  };
  // ...and from its end, with the separator before it.
  const sameFromEnd: (index: number) => boolean = (index: number): boolean => {
    return all.every((words: Array<NameWord>): boolean => {
      const at: number = words.length - 1 - index;
      const firstAt: number = first.length - 1 - index;

      return (
        words[at]!.word === first[firstAt]!.word &&
        // The separator before it, which the word before it carries.
        words[at - 1]!.separatorAfter === first[firstAt - 1]!.separatorAfter
      );
    });
  };

  let leading: number = 0;

  // At least one word is left for the "*".
  while (leading < shortest - 1 && sameFromStart(leading)) {
    leading++;
  }

  let trailing: number = 0;

  while (leading + trailing < shortest - 1 && sameFromEnd(trailing)) {
    trailing++;
  }

  if (leading === 0 && trailing === 0) {
    return pattern;
  }

  const start: string = first
    .slice(0, leading)
    .map((entry: NameWord): string => {
      return `${entry.word}${entry.separatorAfter}`;
    })
    .join("");
  const endWords: Array<NameWord> = first.slice(first.length - trailing);
  const end: string =
    trailing > 0
      ? `${first[first.length - trailing - 1]!.separatorAfter}${endWords
          .map((entry: NameWord, index: number): string => {
            return `${entry.word}${index < endWords.length - 1 ? entry.separatorAfter : ""}`;
          })
          .join("")}`
      : "";
  const refined: string = `${start}*${end}`;
  const keepsWord: boolean = word ? refined.includes(word.toLowerCase()) : true;

  if (
    refined.length <= pattern.length ||
    !keepsWord ||
    !names.every((name: string): boolean => {
      return matchesNamePattern(name, refined);
    })
  ) {
    return pattern;
  }

  return refined;
}

// Whether a name matches a pattern of words and "*" (a "*" matches anything).
export function matchesNamePattern(name: string, pattern: string): boolean {
  const escaped: string = pattern
    .toLowerCase()
    .split("*")
    .map((part: string): string => {
      return escapeRegExp(part);
    })
    .join(".*");

  return new RegExp(`^${escaped}$`).test(name.trim().toLowerCase());
}

/*
 * ---------------------------------------------------------------------------
 * The facts a group rests on
 * ---------------------------------------------------------------------------
 */

// The code that declares a group's stores, as DeclaredCodeOwner found it.
export interface DataSecurityIssueGroupCode {
  repositoryId: string;
  // "acme/infra".
  repositoryName: string;
  // The files or folders named after the module or stack, at most a few.
  paths: Array<string>;
  // Terraform, CloudFormation, Bicep, Pulumi or Crossplane.
  codeKind: string;
  // Why that repository (DeclaredCodeOwnerReason).
  reason: string;
}

// What every store of a group shares: what the group is, and its name rests on.
export interface DataSecurityIssueGroupFacts {
  cause: DataSecurityIssueGroupCause;
  checkId: string;
  // The tag the group is of (Tags), and every tag that names what made them that all share.
  tag?: [string, string] | undefined;
  tagRole?: DataSecurityIssueGroupTagRole | undefined;
  tags?: Array<[string, string]> | undefined;
  // The CloudFormation stack that made them (Stack).
  stackName?: string | undefined;
  // The identity that created them (Creator), as normalizeCreatorIdentity reads it.
  creator?: string | undefined;
  // The name pattern they share (NamePattern).
  pattern?: string | undefined;
  // The code that declares them, when it was found (DeclaredCode).
  code?: DataSecurityIssueGroupCode | undefined;
  // What they all are, where they all are: left out when they differ.
  storeKind?: string | undefined;
  provider?: string | undefined;
  region?: string | undefined;
  accountNumber?: string | undefined;
  // The code their tags all say declares them: "Terraform", 'CloudFormation stack "web"'.
  managedAsCode?: string | undefined;
}

/*
 * The name the module or stack the group is of goes by, which the code
 * that declares the stores is looked for by: a module's or stack's tag,
 * or the stack itself. Null for a group of any other fact.
 */
export function getIssueGroupOriginName(
  facts: Pick<
    DataSecurityIssueGroupFacts,
    "cause" | "tag" | "tagRole" | "stackName"
  >,
): string | null {
  if (facts.stackName) {
    return facts.stackName;
  }

  if (
    facts.tag &&
    (facts.tagRole === DataSecurityIssueGroupTagRole.Module ||
      facts.tagRole === DataSecurityIssueGroupTagRole.Stack)
  ) {
    return facts.tag[1];
  }

  return null;
}

/*
 * A group's facts with the code that declares its stores: the file or
 * module that declares them is the strongest fact there is, so a group of
 * a module's or a stack's tag whose code was found - a file or folder named
 * after it - becomes a group of that code. A repository found any other
 * way (a tag that names it) is where the pull request goes, and the group
 * stays one of its tag. Its key stays the one it was made with.
 */
export function withDeclaredCode(
  facts: DataSecurityIssueGroupFacts,
  code: DataSecurityIssueGroupCode | null,
): DataSecurityIssueGroupFacts {
  if (!code) {
    return facts;
  }

  return {
    ...facts,
    code,
    cause:
      code.paths.length > 0 && getIssueGroupOriginName(facts)
        ? DataSecurityIssueGroupCause.DeclaredCode
        : facts.cause,
  };
}

/*
 * What the name a group was given rests on: its cause and the value that
 * makes it, the check, and what its stores all are. A name is written again
 * only when this changes - never as issues open and resolve.
 */
export function getIssueGroupNameFactsHash(
  facts: DataSecurityIssueGroupFacts,
  language: string,
): string {
  return sha256Hex(
    toStableJsonText({
      language,
      cause: facts.cause,
      checkId: facts.checkId,
      tag: facts.tag || null,
      stackName: facts.stackName || null,
      creator: facts.creator || null,
      pattern: facts.pattern || null,
      code: facts.code
        ? {
            repositoryName: facts.code.repositoryName,
            paths: facts.code.paths,
            codeKind: facts.code.codeKind,
          }
        : null,
      storeKind: facts.storeKind || null,
      managedAsCode: facts.managedAsCode || null,
    }),
  );
}

/*
 * ---------------------------------------------------------------------------
 * Grouping
 * ---------------------------------------------------------------------------
 */

// A store, as grouping reads it.
export interface DataSecurityIssueGroupStore {
  id: string;
  name: string;
  kind?: string | undefined;
  provider?: string | undefined;
  region?: string | undefined;
  accountNumber?: string | undefined;
  // Its cloud tags (labels on Google Cloud), as the inventory read them.
  tags: Readonly<Record<string, string>>;
  /*
   * The code its tags say declares it (CloudAiTargets.getManagedAsCode):
   * "Terraform", 'CloudFormation stack "web"' - null for a store made in
   * the console, as far as its tags say.
   */
  managedAsCode: string | null;
  // The identity that created it, as the change log names it (normalized), when it does.
  creator?: string | null | undefined;
}

// An open issue, as grouping reads it.
export interface DataSecurityIssueGroupIssue {
  id: string;
  checkId: string;
  dataStoreId: string;
  /*
   * The key of the group it is in now: it stays there while its store
   * still shares that group's fact, whatever else forms.
   */
  groupKey?: string | null | undefined;
}

// One fact a store could share with others, and how strong it is.
interface CauseCandidate {
  // What makes the fact: "stack:web", "tag:module=static-site".
  originKey: string;
  cause: DataSecurityIssueGroupCause;
  // Strongest first.
  rank: number;
  tag?: [string, string] | undefined;
  tagRole?: DataSecurityIssueGroupTagRole | undefined;
  stackName?: string | undefined;
  creator?: string | undefined;
  pattern?: string | undefined;
  // The word of the name a pattern is of.
  word?: string | undefined;
}

const TAG_ROLE_RANK: Readonly<Record<DataSecurityIssueGroupTagRole, number>> = {
  [DataSecurityIssueGroupTagRole.Module]: 1,
  [DataSecurityIssueGroupTagRole.Stack]: 2,
  [DataSecurityIssueGroupTagRole.Component]: 3,
};

const CREATOR_RANK: number = 4;
const NAME_PATTERN_RANK: number = 5;

// The facts a store could share with others, strongest first.
export function getStoreCauseCandidates(
  store: DataSecurityIssueGroupStore,
): Array<CauseCandidate> {
  const candidates: Array<CauseCandidate> = [];
  const stackName: string | null = getStoreStackName(store.tags);

  if (stackName) {
    candidates.push({
      originKey: `stack:${stackName.toLowerCase()}`,
      cause: DataSecurityIssueGroupCause.Stack,
      rank: 0,
      stackName,
    });
  }

  for (const [key, value] of getStoreCauseTags(store.tags)) {
    const role: DataSecurityIssueGroupTagRole = getCauseTagRole(key)!;

    candidates.push({
      originKey: `tag:${foldTagKey(key)}=${value.toLowerCase()}`,
      cause: DataSecurityIssueGroupCause.Tags,
      rank: TAG_ROLE_RANK[role],
      tag: [key, value],
      tagRole: role,
    });
  }

  if (store.creator) {
    candidates.push({
      originKey: `creator:${store.creator.toLowerCase()}`,
      cause: DataSecurityIssueGroupCause.Creator,
      rank: CREATOR_RANK,
      creator: store.creator,
    });
  }

  for (const candidate of getNamePatternCandidates(store.name)) {
    candidates.push({
      originKey: `name:${candidate.pattern}`,
      cause: DataSecurityIssueGroupCause.NamePattern,
      rank: NAME_PATTERN_RANK,
      pattern: candidate.pattern,
      word: candidate.word,
    });
  }

  return candidates.sort((left: CauseCandidate, right: CauseCandidate) => {
    return (
      left.rank - right.rank || left.originKey.localeCompare(right.originKey)
    );
  });
}

/*
 * The key a group is known by: its check, its cloud and the fact it is of.
 * Stable while that fact holds, so a group keeps its name, its fix and its
 * history as issues open and resolve.
 */
export function getIssueGroupKey(data: {
  checkId: string;
  provider?: string | undefined;
  originKey: string;
}): string {
  return `${data.checkId}|${(data.provider || "").toLowerCase()}|${data.originKey}`.slice(
    0,
    500,
  );
}

// A group as grouping drafts it, before the server keeps it.
export interface DataSecurityIssueGroupDraft {
  key: string;
  checkId: string;
  cause: DataSecurityIssueGroupCause;
  facts: DataSecurityIssueGroupFacts;
  // Its open issues, and their stores, in name order.
  issueIds: Array<string>;
  dataStoreIds: Array<string>;
  // How many of them are declared as code, by their tags.
  declaredAsCodeCount: number;
}

interface Bucket {
  key: string;
  candidate: CauseCandidate;
  // Members already in the group, which never leave it for another.
  pinned: Array<DataSecurityIssueGroupIssue>;
  // Members it could take.
  open: Array<DataSecurityIssueGroupIssue>;
}

// The value every store shares, or undefined where two differ.
function shared(
  values: ReadonlyArray<string | undefined | null>,
): string | undefined {
  const first: string | undefined | null = values[0];

  return first &&
    values.every((value: string | undefined | null): boolean => {
      return value === first;
    })
    ? first
    : undefined;
}

// Every tag naming what made a store that all the stores carry, by key.
function sharedCauseTags(
  stores: ReadonlyArray<DataSecurityIssueGroupStore>,
): Array<[string, string]> {
  if (stores.length === 0) {
    return [];
  }

  const [first, ...rest] = stores;

  return getStoreCauseTags(first!.tags).filter(
    ([key, value]: [string, string]): boolean => {
      return rest.every((store: DataSecurityIssueGroupStore): boolean => {
        return getStoreCauseTags(store.tags).some(
          ([otherKey, otherValue]: [string, string]): boolean => {
            return (
              foldTagKey(otherKey) === foldTagKey(key) &&
              otherValue.toLowerCase() === value.toLowerCase()
            );
          },
        );
      });
    },
  );
}

// The facts a group's stores share, for the fact the group is of.
export function getIssueGroupFacts(data: {
  checkId: string;
  candidate: CauseCandidate;
  stores: ReadonlyArray<DataSecurityIssueGroupStore>;
}): DataSecurityIssueGroupFacts {
  const stores: ReadonlyArray<DataSecurityIssueGroupStore> = data.stores;
  const tags: Array<[string, string]> = sharedCauseTags(stores);
  const facts: DataSecurityIssueGroupFacts = {
    cause: data.candidate.cause,
    checkId: data.checkId,
  };

  if (data.candidate.tag) {
    facts.tag = data.candidate.tag;
    facts.tagRole = data.candidate.tagRole;
  }

  if (tags.length > 0) {
    facts.tags = tags;
  }

  if (data.candidate.stackName) {
    facts.stackName = data.candidate.stackName;
  }

  if (data.candidate.creator) {
    facts.creator = data.candidate.creator;
  }

  if (data.candidate.pattern) {
    facts.pattern = refineNamePattern(
      stores.map((store: DataSecurityIssueGroupStore): string => {
        return store.name;
      }),
      data.candidate.pattern,
      data.candidate.word,
    );
  }

  const storeKind: string | undefined = shared(
    stores.map((store: DataSecurityIssueGroupStore) => {
      return store.kind;
    }),
  );
  const provider: string | undefined = shared(
    stores.map((store: DataSecurityIssueGroupStore) => {
      return store.provider;
    }),
  );
  const region: string | undefined = shared(
    stores.map((store: DataSecurityIssueGroupStore) => {
      return store.region;
    }),
  );
  const accountNumber: string | undefined = shared(
    stores.map((store: DataSecurityIssueGroupStore) => {
      return store.accountNumber;
    }),
  );
  const managedAsCode: string | undefined = shared(
    stores.map((store: DataSecurityIssueGroupStore) => {
      return store.managedAsCode;
    }),
  );

  if (storeKind) {
    facts.storeKind = storeKind;
  }

  if (provider) {
    facts.provider = provider;
  }

  if (region) {
    facts.region = region;
  }

  if (accountNumber) {
    facts.accountNumber = accountNumber;
  }

  if (managedAsCode) {
    facts.managedAsCode = managedAsCode;
  }

  return facts;
}

/*
 * The project's open issues, grouped by cause (see the module comment):
 *
 *   - only issues of one check, on stores of one cloud, are grouped together;
 *   - an issue already in a group stays in it while its store still shares
 *     the group's fact (`groupKey`), and counts toward it;
 *   - of the rest, the strongest fact takes its stores first - a stack
 *     before a tag, a tag before the identity that created them, any of
 *     those before a name pattern - and, of two facts as strong, the one
 *     more stores share;
 *   - a new group needs `minIssues` issues; an issue is in one group at
 *     most.
 *
 * Every group whose key an issue stays in is returned, however few it now
 * holds - the server keeps a group its resolved issues still make - and a
 * new one only with enough.
 */
export function groupIssuesByCause(data: {
  issues: ReadonlyArray<DataSecurityIssueGroupIssue>;
  stores: ReadonlyArray<DataSecurityIssueGroupStore>;
  minIssues?: number | undefined;
}): Array<DataSecurityIssueGroupDraft> {
  const minIssues: number = Math.max(
    MIN_ISSUES_PER_GROUP,
    data.minIssues || MIN_ISSUES_PER_GROUP,
  );
  const storesById: Map<string, DataSecurityIssueGroupStore> = new Map();

  for (const store of data.stores) {
    storesById.set(store.id, store);
  }

  // One check on one cloud at a time.
  const partitions: Map<string, Array<DataSecurityIssueGroupIssue>> = new Map();

  for (const issue of data.issues) {
    const store: DataSecurityIssueGroupStore | undefined = storesById.get(
      issue.dataStoreId,
    );

    if (!store || !issue.checkId) {
      continue;
    }

    const partition: string = `${issue.checkId}|${(store.provider || "").toLowerCase()}`;
    const list: Array<DataSecurityIssueGroupIssue> =
      partitions.get(partition) || [];

    list.push(issue);
    partitions.set(partition, list);
  }

  const drafts: Array<DataSecurityIssueGroupDraft> = [];

  for (const issues of partitions.values()) {
    const checkId: string = issues[0]!.checkId;
    const provider: string | undefined = storesById.get(
      issues[0]!.dataStoreId,
    )!.provider;
    const buckets: Map<string, Bucket> = new Map();
    const pinnedTo: Map<string, string> = new Map();

    // What each issue's store could share, and the group it already is in.
    for (const issue of issues) {
      const store: DataSecurityIssueGroupStore = storesById.get(
        issue.dataStoreId,
      )!;
      const candidates: Array<CauseCandidate> = getStoreCauseCandidates(store);
      const keys: Array<string> = candidates.map(
        (candidate: CauseCandidate): string => {
          return getIssueGroupKey({
            checkId,
            provider,
            originKey: candidate.originKey,
          });
        },
      );
      const stays: boolean = Boolean(
        issue.groupKey && keys.includes(issue.groupKey),
      );

      candidates.forEach((candidate: CauseCandidate, index: number): void => {
        const key: string = keys[index]!;
        const bucket: Bucket = buckets.get(key) || {
          key,
          candidate,
          pinned: [],
          open: [],
        };

        if (stays && issue.groupKey === key) {
          bucket.pinned.push(issue);
          pinnedTo.set(issue.id, key);
        } else if (!stays) {
          bucket.open.push(issue);
        }

        buckets.set(key, bucket);
      });
    }

    const assigned: Map<string, string> = new Map(pinnedTo);

    /*
     * Only a bucket that can ever be a group is weighed: one an issue stays
     * in, or one with enough issues to start one. A bucket only loses
     * issues as the rounds go, so one too small now never grows.
     */
    const viable: Array<Bucket> = Array.from(buckets.values()).filter(
      (bucket: Bucket): boolean => {
        return (
          bucket.open.length > 0 &&
          (bucket.pinned.length > 0 || bucket.open.length >= minIssues)
        );
      },
    );
    const remaining: Map<string, number> = new Map();
    // The viable buckets each issue could go to: it leaves each once it goes.
    const bucketsOfIssue: Map<string, Array<string>> = new Map();

    for (const bucket of viable) {
      remaining.set(bucket.key, bucket.open.length);

      for (const issue of bucket.open) {
        const keys: Array<string> = bucketsOfIssue.get(issue.id) || [];

        keys.push(bucket.key);
        bucketsOfIssue.set(issue.id, keys);
      }
    }

    /*
     * The strongest fact first, then the one more stores share: each round
     * the best bucket takes every store it can that no group took yet.
     */
    for (;;) {
      let best: Bucket | null = null;
      let bestSize: number = 0;

      for (const bucket of viable) {
        const left: number = remaining.get(bucket.key) || 0;
        const size: number = bucket.pinned.length + left;

        if (left === 0 || (bucket.pinned.length === 0 && size < minIssues)) {
          continue;
        }

        if (
          !best ||
          bucket.candidate.rank < best.candidate.rank ||
          (bucket.candidate.rank === best.candidate.rank &&
            (size > bestSize ||
              (size === bestSize && bucket.key.localeCompare(best.key) < 0)))
        ) {
          best = bucket;
          bestSize = size;
        }
      }

      if (!best) {
        break;
      }

      for (const issue of best.open) {
        if (assigned.has(issue.id)) {
          continue;
        }

        assigned.set(issue.id, best.key);

        for (const key of bucketsOfIssue.get(issue.id) || []) {
          remaining.set(key, (remaining.get(key) || 0) - 1);
        }
      }
    }

    // Each group, with the issues it ended up with.
    const members: Map<string, Array<DataSecurityIssueGroupIssue>> = new Map();

    for (const issue of issues) {
      const key: string | undefined = assigned.get(issue.id);

      if (key) {
        const list: Array<DataSecurityIssueGroupIssue> = members.get(key) || [];

        list.push(issue);
        members.set(key, list);
      }
    }

    for (const [key, list] of members) {
      const bucket: Bucket = buckets.get(key)!;

      if (bucket.pinned.length === 0 && list.length < minIssues) {
        continue;
      }

      const stores: Array<DataSecurityIssueGroupStore> = list
        .map((issue: DataSecurityIssueGroupIssue) => {
          return storesById.get(issue.dataStoreId)!;
        })
        .sort(
          (
            left: DataSecurityIssueGroupStore,
            right: DataSecurityIssueGroupStore,
          ): number => {
            return (
              left.name.localeCompare(right.name) ||
              left.id.localeCompare(right.id)
            );
          },
        );
      const issueOfStore: Map<string, string> = new Map(
        list.map((issue: DataSecurityIssueGroupIssue): [string, string] => {
          return [issue.dataStoreId, issue.id];
        }),
      );

      drafts.push({
        key,
        checkId,
        cause: bucket.candidate.cause,
        facts: getIssueGroupFacts({
          checkId,
          candidate: bucket.candidate,
          stores,
        }),
        issueIds: stores.map((store: DataSecurityIssueGroupStore): string => {
          return issueOfStore.get(store.id)!;
        }),
        dataStoreIds: stores.map(
          (store: DataSecurityIssueGroupStore): string => {
            return store.id;
          },
        ),
        declaredAsCodeCount: stores.filter(
          (store: DataSecurityIssueGroupStore): boolean => {
            return Boolean(store.managedAsCode);
          },
        ).length,
      });
    }
  }

  return drafts.sort(
    (
      left: DataSecurityIssueGroupDraft,
      right: DataSecurityIssueGroupDraft,
    ): number => {
      return (
        right.issueIds.length - left.issueIds.length ||
        DATA_SECURITY_ISSUE_GROUP_CAUSES.indexOf(left.cause) -
          DATA_SECURITY_ISSUE_GROUP_CAUSES.indexOf(right.cause) ||
        left.key.localeCompare(right.key)
      );
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * What a group is called
 * ---------------------------------------------------------------------------
 */

// How a group's cause is said with none of OneUptime AI's words: a key per kind of fact.
export const ISSUE_GROUP_CAUSE_WORDS: {
  module: string;
  stack: string;
  cloudFormationStack: string;
  tag: string;
  creatorRole: string;
  creatorRoot: string;
  creator: string;
  pattern: string;
  code: string;
} = {
  module: translationKey("the {{module}} module"),
  stack: translationKey("the {{stack}} stack"),
  cloudFormationStack: translationKey("the CloudFormation stack {{stack}}"),
  tag: translationKey("stores tagged {{tag}}"),
  creatorRole: translationKey("stores the {{role}} role created"),
  creatorRoot: translationKey("stores the account's root user created"),
  creator: translationKey("stores {{identity}} created"),
  pattern: translationKey("stores named {{pattern}}"),
  code: translationKey("the code in {{path}}"),
};

// The headline of a group: "40 issues, one cause: the static-site module".
export const ISSUE_GROUP_HEADLINE: { singular: string; plural: string } = {
  singular: translationKey("{{count}} issue, one cause: {{cause}}"),
  plural: translationKey("{{count}} issues, one cause: {{cause}}"),
};

// An identity as a sentence names it: "the terraform-ci role", "user alice".
export function describeCreatorIdentity(creator: string): string {
  if (creator.startsWith("role/")) {
    return `the ${creator.slice("role/".length)} role`;
  }

  if (creator.startsWith("user/")) {
    return creator.slice("user/".length);
  }

  if (creator === "root") {
    return "the account's root user";
  }

  return creator;
}

/*
 * The key and the values a group's cause is said with, for a reader's
 * language (the Dashboard words the key) or in English (fillCauseWords).
 */
export function getIssueGroupCauseWords(facts: DataSecurityIssueGroupFacts): {
  key: string;
  values: Record<string, string>;
} {
  if (
    facts.tag &&
    facts.tagRole === DataSecurityIssueGroupTagRole.Module &&
    facts.cause !== DataSecurityIssueGroupCause.NamePattern
  ) {
    return {
      key: ISSUE_GROUP_CAUSE_WORDS.module,
      values: { module: facts.tag[1] },
    };
  }

  if (facts.stackName) {
    return {
      key: ISSUE_GROUP_CAUSE_WORDS.cloudFormationStack,
      values: { stack: facts.stackName },
    };
  }

  if (facts.tag && facts.tagRole === DataSecurityIssueGroupTagRole.Stack) {
    return {
      key: ISSUE_GROUP_CAUSE_WORDS.stack,
      values: { stack: facts.tag[1] },
    };
  }

  if (facts.cause === DataSecurityIssueGroupCause.DeclaredCode && facts.code) {
    return {
      key: ISSUE_GROUP_CAUSE_WORDS.code,
      values: { path: facts.code.paths[0] || facts.code.repositoryName },
    };
  }

  if (facts.tag) {
    return {
      key: ISSUE_GROUP_CAUSE_WORDS.tag,
      values: { tag: `${facts.tag[0]}=${facts.tag[1]}` },
    };
  }

  if (facts.creator) {
    if (facts.creator.startsWith("role/")) {
      return {
        key: ISSUE_GROUP_CAUSE_WORDS.creatorRole,
        values: { role: facts.creator.slice("role/".length) },
      };
    }

    if (facts.creator === "root") {
      return { key: ISSUE_GROUP_CAUSE_WORDS.creatorRoot, values: {} };
    }

    return {
      key: ISSUE_GROUP_CAUSE_WORDS.creator,
      values: { identity: describeCreatorIdentity(facts.creator) },
    };
  }

  return {
    key: ISSUE_GROUP_CAUSE_WORDS.pattern,
    values: { pattern: facts.pattern || "" },
  };
}

// A key's English with its values filled in.
export function fillCauseWords(words: {
  key: string;
  values: Record<string, string>;
}): string {
  return words.key.replace(
    /\{\{\s*([a-zA-Z]+)\s*\}\}/g,
    (whole: string, name: string): string => {
      return words.values[name] ?? whole;
    },
  );
}

// The group's cause in English, with none of OneUptime AI's words: "the static-site module".
export function describeIssueGroupCause(
  facts: DataSecurityIssueGroupFacts,
): string {
  return fillCauseWords(getIssueGroupCauseWords(facts));
}

/*
 * ---------------------------------------------------------------------------
 * The name OneUptime AI gives a group, held to its facts
 * ---------------------------------------------------------------------------
 */

// One fact a group's name may rest on: an id the answer names it by, and its text.
export interface DataSecurityIssueGroupNameFact {
  id: string;
  // What the fact is: "cause", "problem", "code", "stores".
  about: "cause" | "problem" | "code" | "stores";
  text: string;
}

/*
 * The facts OneUptime AI names a group from, each with an id: what made
 * the stores, what the check says is wrong, the code that declares them,
 * and what they are. Never a store's name, a record or a value.
 */
export function getIssueGroupNameFacts(data: {
  facts: DataSecurityIssueGroupFacts;
  // The check's title and what it looks for, in OneUptime's words.
  checkTitle: string;
  checkDescription: string;
  issueCount: number;
}): Array<DataSecurityIssueGroupNameFact> {
  const facts: DataSecurityIssueGroupFacts = data.facts;
  const cause: Array<string> = [describeIssueGroupCause(facts)];

  if (facts.tag) {
    cause.push(`tag ${facts.tag[0]}=${facts.tag[1]}`);
  }

  for (const [key, value] of facts.tags || []) {
    if (
      !facts.tag ||
      foldTagKey(facts.tag[0]) !== foldTagKey(key) ||
      facts.tag[1] !== value
    ) {
      cause.push(`tag ${key}=${value}`);
    }
  }

  if (facts.stackName) {
    cause.push(`CloudFormation stack ${facts.stackName}`);
  }

  if (facts.creator) {
    cause.push(`created by ${describeCreatorIdentity(facts.creator)}`);
  }

  if (facts.pattern) {
    cause.push(`every store's name matches ${facts.pattern}`);
  }

  const list: Array<DataSecurityIssueGroupNameFact> = [
    { id: "F1", about: "cause", text: cause.join("; ") },
    {
      id: "F2",
      about: "problem",
      text: `${data.checkTitle}. ${data.checkDescription}`.trim(),
    },
  ];

  if (facts.code) {
    list.push({
      id: "F3",
      about: "code",
      text: `declared in ${facts.code.codeKind} code in ${facts.code.repositoryName}${
        facts.code.paths.length > 0 ? `: ${facts.code.paths.join(", ")}` : ""
      }`,
    });
  }

  const stores: Array<string> = [
    `${data.issueCount} ${data.issueCount === 1 ? "store" : "stores"}`,
  ];

  if (facts.storeKind) {
    stores.push(facts.storeKind);
  }

  if (facts.managedAsCode) {
    stores.push(`declared by ${facts.managedAsCode}`);
  }

  if (facts.region) {
    stores.push(`in ${facts.region}`);
  }

  list.push({
    id: facts.code ? "F4" : "F3",
    about: "stores",
    text: stores.join(", "),
  });

  return list;
}

// OneUptime AI's answer, as read (StrictAnswer): the name and the facts it rests on.
export interface DataSecurityIssueGroupNameAnswer {
  name: string;
  facts: Array<string>;
}

// A word of a name that must be one of its facts' own: a name, an id, a path.
const DISTINCTIVE_WORD: RegExp = /[\p{L}\p{N}_.\-/=*:@]+/gu;

// A digit, or a mark a name, an id or a path is written with.
const NAME_MARK: RegExp = /[\p{N}_.\-/=*:@]/u;
const LETTER_OR_DIGIT: RegExp = /[\p{L}\p{N}]/u;
// What no name of a group says: a link, Markdown, code.
const NOT_A_PLAIN_NAME: RegExp = /https?:\/\/|www\.|[`#<>[\]{}|\\]|\*\*|__/i;

function isDistinctiveWord(word: string): boolean {
  return NAME_MARK.test(word) && LETTER_OR_DIGIT.test(word);
}

/*
 * The name OneUptime AI gave a group, held to its facts, or null - and the
 * group goes by its cause's own words (describeIssueGroupCause):
 *
 *   - one plain line, of a sensible length, with no link, no address and
 *     no Markdown;
 *   - it names the cause's fact (F1) among those it rests on, and only
 *     facts it was given;
 *   - every word in it that is a name, an id, a path or a pattern - a word
 *     with a digit or one of - _ . / = * : @ - is one of its facts' own:
 *     "static-site" from module=static-site, never a store's name;
 *   - it names none of the group's stores (`storeNames`), which it was
 *     never told, whatever their words.
 */
export function holdIssueGroupNameToFacts(data: {
  answer: DataSecurityIssueGroupNameAnswer | null | undefined;
  facts: ReadonlyArray<DataSecurityIssueGroupNameFact>;
  storeNames?: ReadonlyArray<string> | undefined;
}): string | null {
  const raw: unknown = data.answer?.name;

  if (typeof raw !== "string") {
    return null;
  }

  const name: string = raw
    .replace(/\s+/g, " ")
    .trim()
    // A sentence's own full stop is no part of a name.
    .replace(/[.。]+$/u, "")
    .trim();
  const length: number = Array.from(name).length;

  if (
    length < MIN_ISSUE_GROUP_NAME_LENGTH ||
    length > MAX_ISSUE_GROUP_NAME_LENGTH
  ) {
    return null;
  }

  if (NOT_A_PLAIN_NAME.test(name)) {
    return null;
  }

  const ids: Set<string> = new Set(
    data.facts.map((fact: DataSecurityIssueGroupNameFact): string => {
      return fact.id;
    }),
  );
  const cited: Array<string> = (data.answer?.facts || [])
    .map((id: unknown): string => {
      return typeof id === "string" ? id.trim().toUpperCase() : "";
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });

  if (
    !cited.includes("F1") ||
    cited.some((id: string): boolean => {
      return !ids.has(id);
    })
  ) {
    return null;
  }

  const factText: string = data.facts
    .map((fact: DataSecurityIssueGroupNameFact): string => {
      return fact.text;
    })
    .join("\n")
    .toLowerCase();

  for (const match of name.matchAll(DISTINCTIVE_WORD)) {
    // A word's own punctuation at its ends is no part of it.
    const word: string = match[0].replace(/^[.:,;!?-]+|[.:,;!?-]+$/g, "");

    if (
      word &&
      isDistinctiveWord(word) &&
      !factText.includes(word.toLowerCase())
    ) {
      return null;
    }
  }

  const lowered: string = name.toLowerCase();

  for (const storeName of data.storeNames || []) {
    const store: string = storeName.trim().toLowerCase();

    if (
      store.length >= 3 &&
      !factText.includes(store) &&
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(store)}($|[^\\p{L}\\p{N}])`,
        "u",
      ).test(lowered)
    ) {
      return null;
    }
  }

  return name;
}

/*
 * ---------------------------------------------------------------------------
 * A group, as the routes answer it
 * ---------------------------------------------------------------------------
 */

// One of a group's issues, as the Issues list folds it under the group.
export interface DataSecurityIssueGroupMemberJSON {
  issueId: string;
  dataStoreId: string;
  dataStoreName: string;
  dataStoreKind?: string | undefined;
  status: string;
  severity?: string | undefined;
  riskScore?: number | undefined;
  // Whether its store is declared as code, by its tags.
  isDeclaredAsCode: boolean;
}

export interface DataSecurityIssueGroupJSON {
  groupId: string;
  checkId: string;
  cause: DataSecurityIssueGroupCause;
  facts: DataSecurityIssueGroupFacts;
  // OneUptime AI's name, held to the facts, in the project's language; else none.
  name?: string | undefined;
  // How many issues it holds, how many are open, and how many are fixed.
  issueCount: number;
  openIssueCount: number;
  fixedIssueCount: number;
  // The pull request its fix opened, while it has one: the Code task, and the pull request when it is there.
  fix?: DataSecurityIssueGroupFixStateJSON | undefined;
}

// Where the group's pull request stands (DeclaredCodeChangeState's words).
export interface DataSecurityIssueGroupFixStateJSON {
  taskId: string;
  state: string;
  repositoryName?: string | undefined;
  pullRequestUrl?: string | undefined;
  pullRequestNumber?: number | undefined;
}

export interface DataSecurityIssueGroupsJSON {
  groups: Array<DataSecurityIssueGroupJSON>;
  // The most issues one of the project's groups holds: Group by cause starts on at GROUP_BY_CAUSE_DEFAULT_ON_SIZE.
  largestGroupSize: number;
}

// Whether Group by cause starts on for a project, before the person chose.
export function isGroupByCauseOnByDefault(largestGroupSize: number): boolean {
  return largestGroupSize >= GROUP_BY_CAUSE_DEFAULT_ON_SIZE;
}

/*
 * ---------------------------------------------------------------------------
 * Reading what was stored
 * ---------------------------------------------------------------------------
 */

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_FACT_VALUE_LENGTH)
    : undefined;
}

function readPair(value: unknown): [string, string] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    value[0].trim() &&
    value[1].trim()
  ) {
    return [value[0].trim(), value[1].trim()];
  }

  return undefined;
}

// A group's facts as stored, read defensively, or null for none this build can read.
export function readDataSecurityIssueGroupFacts(
  value: unknown,
): DataSecurityIssueGroupFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (
    !isDataSecurityIssueGroupCause(raw["cause"]) ||
    typeof raw["checkId"] !== "string"
  ) {
    return null;
  }

  const facts: DataSecurityIssueGroupFacts = {
    cause: raw["cause"],
    checkId: raw["checkId"],
  };
  const tag: [string, string] | undefined = readPair(raw["tag"]);

  if (tag) {
    facts.tag = tag;
  }

  if (
    Object.values(DataSecurityIssueGroupTagRole).includes(
      raw["tagRole"] as DataSecurityIssueGroupTagRole,
    )
  ) {
    facts.tagRole = raw["tagRole"] as DataSecurityIssueGroupTagRole;
  }

  const tags: Array<[string, string]> = (
    Array.isArray(raw["tags"]) ? (raw["tags"] as Array<unknown>) : []
  )
    .map(readPair)
    .filter((pair: [string, string] | undefined): pair is [string, string] => {
      return Boolean(pair);
    });

  if (tags.length > 0) {
    facts.tags = tags;
  }

  for (const key of [
    "stackName",
    "creator",
    "pattern",
    "storeKind",
    "provider",
    "region",
    "accountNumber",
    "managedAsCode",
  ] as const) {
    const text: string | undefined = readText(raw[key]);

    if (text) {
      facts[key] = text;
    }
  }

  const code: unknown = raw["code"];

  if (code && typeof code === "object" && !Array.isArray(code)) {
    const object: Record<string, unknown> = code as Record<string, unknown>;
    const repositoryId: string | undefined = readText(object["repositoryId"]);
    const repositoryName: string | undefined = readText(
      object["repositoryName"],
    );

    if (repositoryId && repositoryName) {
      facts.code = {
        repositoryId,
        repositoryName,
        paths: (Array.isArray(object["paths"])
          ? (object["paths"] as Array<unknown>)
          : []
        )
          .map(readText)
          .filter((path: string | undefined): path is string => {
            return Boolean(path);
          })
          .slice(0, 3),
        codeKind: readText(object["codeKind"]) || "",
        reason: readText(object["reason"]) || "",
      };
    }
  }

  return facts;
}
