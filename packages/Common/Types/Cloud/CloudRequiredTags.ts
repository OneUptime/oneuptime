import { CloudProvider } from "./CloudPlatform";

/*
 * REQUIRED TAGS (#11012): THE TAG KEYS A PROJECT'S CLOUD RESOURCES MUST
 * CARRY, AND WHAT A RESOURCE IS MISSING.
 *
 * Allocation is only as good as the tags it reads. A project says which
 * keys every resource must carry (team, env, cost-center) - for every
 * account, or for one - and, for each, the values allowed: a list, where
 * an entry with `*` or `?` in it is a pattern. This module is the one
 * reading of those rules for the server (coverage, new resources, the
 * digest) and the Dashboard alike:
 *
 *   - keys match whatever their case, as tag curation does: `Team`, `team`
 *     and `TEAM` are one key, and the value of the key spelled as required
 *     is read first;
 *   - values match whatever their case too, and an empty value is no value;
 *   - a pattern is a wildcard, `*` for any run of characters and `?` for
 *     one, never a regular expression: it reads the same in ClickHouse (a
 *     LIKE, toClickHouseLikePattern) as here, and no pattern can make
 *     either spin (matchesCloudTagPattern walks the value once per
 *     backtrack to the last `*`, never exponentially);
 *   - a required tag set for one account replaces the project's tag of
 *     the same key there, and can add a key of its own.
 *
 * Pure: no database, no clock.
 */

// The most allowed values one required tag holds, and how long each may be.
export const CLOUD_REQUIRED_TAG_MAX_ALLOWED_VALUES: number = 100;
export const CLOUD_REQUIRED_TAG_VALUE_MAX_LENGTH: number = 256;
export const CLOUD_REQUIRED_TAG_KEY_MAX_LENGTH: number = 128;

// A required tag as the server and the pages read it (CloudRequiredTag).
export interface CloudRequiredTagRule {
  id: string;
  // As the project wrote it: "team".
  key: string;
  // Values and wildcard patterns; empty for any value at all.
  allowedValues: Array<string>;
  // The CloudAccount row it is for; null for every account.
  cloudAccountId: string | null;
}

// What a resource lacks of one required tag.
export enum CloudTagProblem {
  // It carries no value for the key, in any spelling.
  Missing = "missing",
  // It carries a value that is none of the allowed ones.
  NotAllowed = "not-allowed",
}

export interface CloudTagFinding {
  // The required key, as the project wrote it.
  key: string;
  problem: CloudTagProblem;
  // Not allowed: the key as the resource spells it, and its value.
  foundKey?: string | undefined;
  value?: string | undefined;
}

// A key as keys are compared: trimmed, in lower case.
export function normalizeCloudTagKey(key: unknown): string {
  return typeof key === "string" ? key.trim().toLowerCase() : "";
}

function normalizeValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * A resource's value for a required key, whatever the case it spells the
 * key in: the key spelled exactly as required first, then the first of the
 * others in their order. Null when it carries none, or only empty ones.
 */
export function findCloudTagValue(
  tags: Record<string, unknown> | null | undefined,
  key: string,
): { key: string; value: string } | null {
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
    return null;
  }

  const wanted: string = normalizeCloudTagKey(key);

  if (!wanted) {
    return null;
  }

  const exact: string = key.trim();
  const exactValue: string = normalizeValue(tags[exact]);

  if (exactValue) {
    return { key: exact, value: exactValue };
  }

  const keys: Array<string> = Object.keys(tags).sort();

  for (const candidate of keys) {
    if (normalizeCloudTagKey(candidate) !== wanted) {
      continue;
    }

    const value: string = normalizeValue(tags[candidate]);

    if (value) {
      return { key: candidate, value };
    }
  }

  return null;
}

// Whether an allowed value is a pattern: it holds `*` or `?`.
export function isCloudTagValuePattern(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

/*
 * Whether a value matches a wildcard pattern, whatever their case: `*` is
 * any run of characters (none too), `?` one character, anything else
 * itself. The greedy walk backtracks only to the last `*` seen, so a
 * pattern like "*a*a*a*b" against a long value costs at most its length
 * times the value's - never more.
 */
export function matchesCloudTagPattern(
  rawValue: string,
  rawPattern: string,
): boolean {
  const value: string = rawValue.toLowerCase();
  const pattern: string = rawPattern.toLowerCase();
  let v: number = 0;
  let p: number = 0;
  let starAt: number = -1;
  let matchedFrom: number = 0;

  while (v < value.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === value[v])) {
      v++;
      p++;
    } else if (p < pattern.length && pattern[p] === "*") {
      starAt = p;
      matchedFrom = v;
      p++;
    } else if (starAt >= 0) {
      p = starAt + 1;
      matchedFrom++;
      v = matchedFrom;
    } else {
      return false;
    }
  }

  while (p < pattern.length && pattern[p] === "*") {
    p++;
  }

  return p === pattern.length;
}

/*
 * Whether a value is one a required tag allows: any value at all when it
 * names none, else one of its values or patterns, whatever the case. An
 * empty value is never allowed.
 */
export function isCloudTagValueAllowed(
  rawValue: string,
  allowedValues: ReadonlyArray<string>,
): boolean {
  const value: string = rawValue.trim();

  if (!value) {
    return false;
  }

  const allowed: Array<string> = allowedValues
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    });

  if (allowed.length === 0) {
    return true;
  }

  const lowered: string = value.toLowerCase();

  return allowed.some((entry: string): boolean => {
    return isCloudTagValuePattern(entry)
      ? matchesCloudTagPattern(value, entry)
      : entry.toLowerCase() === lowered;
  });
}

/*
 * The allowed values as a person types them - "payments, search, prod-*",
 * one a line or separated by commas - kept trimmed, once each (whatever
 * the case), cut to their length and count.
 */
export function parseCloudTagAllowedValues(text: unknown): Array<string> {
  const entries: Array<unknown> = Array.isArray(text)
    ? text
    : typeof text === "string"
      ? text.split(/[,\n]/)
      : [];
  const seen: Set<string> = new Set();
  const values: Array<string> = [];

  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }

    const value: string = entry
      .trim()
      .slice(0, CLOUD_REQUIRED_TAG_VALUE_MAX_LENGTH);
    const folded: string = value.toLowerCase();

    if (!value || seen.has(folded)) {
      continue;
    }

    seen.add(folded);
    values.push(value);

    if (values.length >= CLOUD_REQUIRED_TAG_MAX_ALLOWED_VALUES) {
      break;
    }
  }

  return values;
}

/*
 * The required tags of one account: the project's, each replaced by the
 * account's own tag of the same key, and the account's own keys added.
 * Ordered by key, so every reader lists them alike.
 */
export function getCloudRequiredTagsForAccount(
  rules: ReadonlyArray<CloudRequiredTagRule>,
  cloudAccountId: string | null | undefined,
): Array<CloudRequiredTagRule> {
  const account: string = (cloudAccountId || "").toLowerCase();
  const byKey: Map<string, CloudRequiredTagRule> = new Map();

  for (const rule of rules) {
    const key: string = normalizeCloudTagKey(rule.key);

    if (!key || rule.cloudAccountId) {
      continue;
    }

    if (!byKey.has(key)) {
      byKey.set(key, rule);
    }
  }

  if (account) {
    for (const rule of rules) {
      const key: string = normalizeCloudTagKey(rule.key);

      if (key && rule.cloudAccountId?.toLowerCase() === account) {
        byKey.set(key, rule);
      }
    }
  }

  return Array.from(byKey.entries())
    .sort(
      (
        a: [string, CloudRequiredTagRule],
        b: [string, CloudRequiredTagRule],
      ) => {
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      },
    )
    .map(([, rule]: [string, CloudRequiredTagRule]): CloudRequiredTagRule => {
      return rule;
    });
}

/*
 * The value a resource carries for a required tag that the tag allows, in
 * any spelling of its key - the exact one first - or null. This is what
 * "carries the tag" means everywhere: here, and in the SQL that counts
 * coverage over costs and resources (CloudTagConditions), which asks
 * whether ANY spelling of the key holds an allowed value.
 */
export function findAllowedCloudTagValue(
  tags: Record<string, unknown> | null | undefined,
  rule: Pick<CloudRequiredTagRule, "key" | "allowedValues">,
): { key: string; value: string } | null {
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
    return null;
  }

  const wanted: string = normalizeCloudTagKey(rule.key);

  if (!wanted) {
    return null;
  }

  const exact: string = rule.key.trim();
  const keys: Array<string> = [
    exact,
    ...Object.keys(tags)
      .filter((key: string): boolean => {
        return key !== exact;
      })
      .sort(),
  ];

  for (const key of keys) {
    if (normalizeCloudTagKey(key) !== wanted) {
      continue;
    }

    const value: string = normalizeValue(tags[key]);

    if (value && isCloudTagValueAllowed(value, rule.allowedValues)) {
      return { key, value };
    }
  }

  return null;
}

// What a resource's tags lack of the required tags: nothing when compliant.
export function evaluateCloudTags(
  tags: Record<string, unknown> | null | undefined,
  rules: ReadonlyArray<CloudRequiredTagRule>,
): Array<CloudTagFinding> {
  const findings: Array<CloudTagFinding> = [];

  for (const rule of rules) {
    if (findAllowedCloudTagValue(tags, rule)) {
      continue;
    }

    // It carries the key with no allowed value: said with what it carries.
    const found: { key: string; value: string } | null = findCloudTagValue(
      tags,
      rule.key,
    );

    findings.push(
      found
        ? {
            key: rule.key,
            problem: CloudTagProblem.NotAllowed,
            foundKey: found.key,
            value: found.value,
          }
        : { key: rule.key, problem: CloudTagProblem.Missing },
    );
  }

  return findings;
}

/*
 * ---------------------------------------------------------------------------
 * Coverage
 * ---------------------------------------------------------------------------
 */

// A share, worked out from what carries a tag and what could.
export interface CloudTagCoverageCount {
  covered: number;
  total: number;
}

/*
 * A share in percent, 0 to 100, to one decimal; null when there is nothing
 * to measure (no spend, no resources), which is never 0%.
 */
export function getCloudTagCoveragePercent(
  count: CloudTagCoverageCount | null | undefined,
): number | null {
  if (!count) {
    return null;
  }

  const total: number = Number(count.total);
  const covered: number = Number(count.covered);

  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(covered)) {
    return null;
  }

  const share: number = Math.min(1, Math.max(0, covered / total));

  return Math.round(share * 1000) / 10;
}

/*
 * A pattern as a ClickHouse LIKE: `*` and `?` become `%` and `_`, and
 * LIKE's own `%`, `_` and `\` are escaped, so they match only themselves.
 */
export function toClickHouseLikePattern(pattern: string): string {
  let like: string = "";

  for (const character of pattern) {
    if (character === "*") {
      like += "%";
    } else if (character === "?") {
      like += "_";
    } else if (character === "%" || character === "_" || character === "\\") {
      like += `\\${character}`;
    } else {
      like += character;
    }
  }

  return like;
}

/*
 * ---------------------------------------------------------------------------
 * Suggestions
 * ---------------------------------------------------------------------------
 */

// What a required key is for, read from its name.
export enum CloudTagKeyKind {
  // team, owner, squad: who pays for it.
  Team = "team",
  // env, environment, stage: which environment it is.
  Environment = "environment",
  Other = "other",
}

const TEAM_KEY_WORDS: ReadonlyArray<string> = [
  "team",
  "owner",
  "owners",
  "squad",
  "group",
  "department",
  "dept",
  "tribe",
];

const ENVIRONMENT_KEY_WORDS: ReadonlyArray<string> = [
  "env",
  "environment",
  "stage",
  "tier",
];

// A key's words: "cost-center" is cost and center, "deployment.environment" deployment and environment.
function keyWords(key: string): Array<string> {
  return normalizeCloudTagKey(key)
    .split(/[^a-z0-9]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
}

export function getCloudTagKeyKind(key: string): CloudTagKeyKind {
  const words: Array<string> = keyWords(key);

  if (
    words.some((word: string): boolean => {
      return ENVIRONMENT_KEY_WORDS.includes(word);
    })
  ) {
    return CloudTagKeyKind.Environment;
  }

  if (
    words.some((word: string): boolean => {
      return TEAM_KEY_WORDS.includes(word);
    })
  ) {
    return CloudTagKeyKind.Team;
  }

  return CloudTagKeyKind.Other;
}

// Where a suggested value comes from: a wire value, stored with each finding.
export enum CloudTagSuggestionSource {
  // The team that owns the resource (owner rules and teams).
  OwnerTeam = "owner-team",
  // The App Platforms environment the resource is part of.
  Environment = "environment",
  // The value the resources beside it agree on.
  Neighbours = "neighbours",
  // The only value the required tag allows.
  OnlyAllowedValue = "only-allowed-value",
}

export interface CloudTagSuggestion {
  key: string;
  value: string;
  source: CloudTagSuggestionSource;
  // What it was read from: the team's or environment's name, the stack, the name prefix.
  detail?: string | undefined;
  // How many resources beside it carry the value (Neighbours).
  count?: number | undefined;
}

// How resources beside one are beside it.
export enum CloudTagNeighbourRelation {
  // The same CloudFormation stack (its aws:cloudformation:stack-name tag).
  Stack = "stack",
  // The same Azure resource group.
  ResourceGroup = "resource-group",
  // The same name before its number ("web-1", "web-2").
  NamePrefix = "name-prefix",
}

export interface CloudTagNeighbourGroup {
  relation: CloudTagNeighbourRelation;
  // The stack's, the group's or the prefix's name.
  name: string;
  // The tags of each resource beside it (never its own).
  tags: Array<Record<string, unknown>>;
}

// At least this many resources beside one must agree on a value.
export const CLOUD_TAG_NEIGHBOURS_MIN_AGREEING: number = 2;

// A name the way a tag value often slugs it: lower case, words joined by dashes.
export function slugCloudTagValue(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/*
 * A name (a team's, an environment's) as the value a required tag would
 * take: one of its allowed values, matched whatever the case or as a slug
 * ("Payments Team" is payments-team), or - when it allows any value - the
 * name itself (as a slug on Google Cloud, whose labels hold only lower
 * case letters, digits, dashes and underscores). Null when none fits.
 */
export function fitCloudTagValue(data: {
  name: string;
  allowedValues: ReadonlyArray<string>;
  provider?: string | null | undefined;
}): string | null {
  const name: string = data.name.trim();

  if (!name) {
    return null;
  }

  const allowed: Array<string> = data.allowedValues.filter(
    (entry: string): boolean => {
      return entry.trim().length > 0;
    },
  );

  if (allowed.length === 0) {
    const value: string =
      (data.provider || "").toLowerCase() === CloudProvider.GCP
        ? slugCloudTagValue(name)
        : name;

    return value.slice(0, CLOUD_REQUIRED_TAG_VALUE_MAX_LENGTH) || null;
  }

  const lowered: string = name.toLowerCase();
  const slug: string = slugCloudTagValue(name);

  for (const entry of allowed) {
    if (isCloudTagValuePattern(entry)) {
      continue;
    }

    const folded: string = entry.trim().toLowerCase();

    if (folded === lowered || folded === slug) {
      return entry.trim();
    }
  }

  // A pattern the name or its slug matches is allowed as it is.
  for (const candidate of [name, slug]) {
    if (candidate && isCloudTagValueAllowed(candidate, allowed)) {
      return candidate;
    }
  }

  return null;
}

/*
 * The value the resources beside one agree on for a key: of each group in
 * turn (its stack, its resource group, its name), the allowed value most of
 * them carry, when at least two do and more than half of those that carry
 * the key do. Null when they don't agree.
 */
export function suggestFromCloudTagNeighbours(data: {
  rule: CloudRequiredTagRule;
  groups: ReadonlyArray<CloudTagNeighbourGroup>;
}): CloudTagSuggestion | null {
  const order: Array<CloudTagNeighbourRelation> = [
    CloudTagNeighbourRelation.Stack,
    CloudTagNeighbourRelation.ResourceGroup,
    CloudTagNeighbourRelation.NamePrefix,
  ];

  for (const relation of order) {
    for (const group of data.groups) {
      if (group.relation !== relation) {
        continue;
      }

      // Each value as carried, counted whatever its case.
      const counts: Map<string, { value: string; count: number }> = new Map();
      let carrying: number = 0;

      for (const tags of group.tags) {
        const found: { key: string; value: string } | null =
          findAllowedCloudTagValue(tags, data.rule);

        if (!found) {
          continue;
        }

        carrying++;

        const folded: string = found.value.toLowerCase();
        const entry: { value: string; count: number } = counts.get(folded) || {
          value: found.value,
          count: 0,
        };

        entry.count++;
        counts.set(folded, entry);
      }

      const best: { value: string; count: number } | undefined = Array.from(
        counts.values(),
      ).sort((a: { count: number }, b: { count: number }): number => {
        return b.count - a.count;
      })[0];

      if (
        best &&
        best.count >= CLOUD_TAG_NEIGHBOURS_MIN_AGREEING &&
        best.count * 2 > carrying
      ) {
        return {
          key: data.rule.key,
          value: best.value,
          source: CloudTagSuggestionSource.Neighbours,
          detail: group.name,
          count: best.count,
        };
      }
    }
  }

  return null;
}

/*
 * The value to suggest for a resource's missing or not allowed tag, from
 * what OneUptime knows of it, in this order:
 *
 *   - for a team-like key, the one team that owns it;
 *   - for an environment-like key, the App Platforms environment it is
 *     part of;
 *   - the value the resources beside it agree on;
 *   - the only value the tag allows.
 *
 * Each is offered only when it is one of the allowed values. Null when
 * nothing suggests one.
 */
export function suggestCloudTagValue(data: {
  rule: CloudRequiredTagRule;
  provider?: string | null | undefined;
  ownerTeamNames: ReadonlyArray<string>;
  environmentName?: string | null | undefined;
  neighbours: ReadonlyArray<CloudTagNeighbourGroup>;
}): CloudTagSuggestion | null {
  const kind: CloudTagKeyKind = getCloudTagKeyKind(data.rule.key);

  // One owner team: more than one says nothing of which it is.
  if (kind === CloudTagKeyKind.Team && data.ownerTeamNames.length === 1) {
    const team: string = data.ownerTeamNames[0]!;
    const value: string | null = fitCloudTagValue({
      name: team,
      allowedValues: data.rule.allowedValues,
      provider: data.provider,
    });

    if (value) {
      return {
        key: data.rule.key,
        value,
        source: CloudTagSuggestionSource.OwnerTeam,
        detail: team,
      };
    }
  }

  if (kind === CloudTagKeyKind.Environment && data.environmentName) {
    const value: string | null = fitCloudTagValue({
      name: data.environmentName,
      allowedValues: data.rule.allowedValues,
      provider: data.provider,
    });

    if (value) {
      return {
        key: data.rule.key,
        value,
        source: CloudTagSuggestionSource.Environment,
        detail: data.environmentName,
      };
    }
  }

  const fromNeighbours: CloudTagSuggestion | null =
    suggestFromCloudTagNeighbours({
      rule: data.rule,
      groups: data.neighbours,
    });

  if (fromNeighbours) {
    return fromNeighbours;
  }

  const exactValues: Array<string> = data.rule.allowedValues
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry.length > 0 && !isCloudTagValuePattern(entry);
    });

  if (
    exactValues.length === 1 &&
    data.rule.allowedValues.filter((entry: string): boolean => {
      return entry.trim().length > 0;
    }).length === 1
  ) {
    return {
      key: data.rule.key,
      value: exactValues[0]!,
      source: CloudTagSuggestionSource.OnlyAllowedValue,
    };
  }

  return null;
}

/*
 * A resource's name before its number - "web-1" and "web-12" are "web" -
 * what resources named alike are grouped by. Null for a name with no
 * number at its end, or too short a prefix to say anything.
 */
export function getCloudResourceNamePrefix(name: string): string | null {
  const match: RegExpMatchArray | null = name
    .trim()
    .toLowerCase()
    .match(/^(.*?[a-z][a-z0-9-_.]*?)[-_.]?\d+$/);

  if (!match) {
    return null;
  }

  const prefix: string = (match[1] || "").replace(/[-_.]+$/, "");

  return prefix.length >= 3 ? prefix : null;
}

/*
 * ---------------------------------------------------------------------------
 * Applying a tag in the cloud: the one command that does it
 * ---------------------------------------------------------------------------
 */

// A word a shell takes as it is, with nothing to quote.
const SHELL_SAFE_WORD: RegExp = /^[A-Za-z0-9_./:=@+-]+$/;

// A word for a shell, quoted: what is inside single quotes is taken as it is.
export function quoteForShell(text: string): string {
  if (SHELL_SAFE_WORD.test(text)) {
    return text;
  }

  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// The last part of an id: a name, after its last "/".
function lastPart(id: string): string {
  const slash: number = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

// The part of a Google Cloud full name after a word: "zones" -> "us-central1-a".
function partAfter(id: string, word: string): string | null {
  const parts: Array<string> = id.split("/");
  const index: number = parts.indexOf(word);
  return index >= 0 && parts[index + 1] ? parts[index + 1]! : null;
}

/*
 * The command that tags a resource in its cloud, with the tag a person
 * approved: one line to paste in the cloud's own shell (CloudShell, Azure
 * Cloud Shell, Cloud Shell). Null where no one command does it - a Google
 * Cloud resource of a kind OneUptime does not know the command of, which
 * is labelled in its console.
 *
 *   - AWS: the Resource Groups Tagging API takes any resource by its ARN;
 *   - Azure: `az tag update` merges into any resource's tags by its ID;
 *   - Google Cloud: each kind its own command - a VM's and a disk's labels,
 *     a bucket's, a Cloud SQL instance's.
 */
export function getCloudTagCommand(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  providerResourceId: string | null | undefined;
  accountId?: string | null | undefined;
  region?: string | null | undefined;
  key: string;
  value: string;
}): string | null {
  const id: string = (data.providerResourceId || "").trim();
  const key: string = data.key.trim();
  const value: string = data.value.trim();

  if (!id || !key || !value) {
    return null;
  }

  const tag: string = quoteForShell(`${key}=${value}`);

  switch ((data.provider || "").toLowerCase()) {
    case CloudProvider.AWS: {
      if (!id.startsWith("arn:")) {
        return null;
      }

      // An ARN names its Region; a global resource's ARN names none.
      const region: string = id.split(":")[3] || (data.region || "").trim();

      return [
        "aws resourcegroupstaggingapi tag-resources",
        ...(region ? [`--region ${quoteForShell(region)}`] : []),
        `--resource-arn-list ${quoteForShell(id)}`,
        `--tags ${tag}`,
      ].join(" ");
    }
    case CloudProvider.Azure: {
      if (!id.startsWith("/subscriptions/")) {
        return null;
      }

      return `az tag update --resource-id ${quoteForShell(id)} --operation Merge --tags ${tag}`;
    }
    case CloudProvider.GCP: {
      const project: string | null =
        partAfter(id, "projects") || (data.accountId || "").trim() || null;
      const name: string = lastPart(id);
      const projectFlag: string = project
        ? ` --project ${quoteForShell(project)}`
        : "";
      const type: string = (data.type || "").trim();

      if (type === "gce_instance" || id.includes("/instances/")) {
        if (
          id.includes("sqladmin.googleapis.com") ||
          type === "cloudsql_database"
        ) {
          return `gcloud sql instances patch ${quoteForShell(name)}${projectFlag} --update-labels ${tag}`;
        }

        const zone: string | null = partAfter(id, "zones");

        return zone
          ? `gcloud compute instances add-labels ${quoteForShell(name)}${projectFlag} --zone ${quoteForShell(zone)} --labels ${tag}`
          : null;
      }

      if (type === "gce_disk" || id.includes("/disks/")) {
        const zone: string | null = partAfter(id, "zones");

        return zone
          ? `gcloud compute disks add-labels ${quoteForShell(name)}${projectFlag} --zone ${quoteForShell(zone)} --labels ${tag}`
          : null;
      }

      if (type === "gcs_bucket" || id.startsWith("//storage.googleapis.com/")) {
        return `gcloud storage buckets update ${quoteForShell(`gs://${name}`)} --update-labels ${tag}`;
      }

      if (type === "cloudsql_database") {
        return `gcloud sql instances patch ${quoteForShell(name.split(":").pop() || name)}${projectFlag} --update-labels ${tag}`;
      }

      return null;
    }
    default:
      return null;
  }
}
