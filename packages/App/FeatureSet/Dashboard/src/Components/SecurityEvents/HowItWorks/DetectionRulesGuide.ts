import IconProp from "Common/Types/Icon/IconProp";
import {
  DETECTION_DISTINCT_COUNT_ATTRIBUTE,
  DETECTION_EVALUATION_DELAY_IN_SECONDS,
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
  DETECTION_MAX_GROUPS_PER_EVALUATION,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
  DETECTION_CORRELATION_TYPE_ATTRIBUTE,
  DETECTION_RULE_ID_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SIGMA_ID_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import {
  SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS,
  SIGMA_CORRELATION_MAX_TEMPORAL_RULES,
  SIGMA_CORRELATION_MIN_TEMPORAL_RULES,
  SIGMA_UNSUPPORTED_CORRELATION_TYPES,
} from "Common/Types/SecurityEvent/SigmaCorrelation";
import {
  SIGMA_DEFAULT_LEVEL,
  SIGMA_LEVEL_TO_OCSF_SEVERITY,
  SigmaLevel,
  isSevereSigmaLevel,
} from "Common/Types/SecurityEvent/SigmaRule";
import {
  SecurityEventsGuide,
  SecurityEventsGuideLevel,
  SecurityEventsGuideTemplate,
  fillGuideTemplate,
  markdownTable,
} from "./SecurityEventsGuide";

/*
 * What a customer needs to know to trust a detection rule: when it runs,
 * which events it sees, what it counts, what it opens, and at which
 * severity. Every claim here mirrors DetectionRuleEvaluator,
 * SigmaRuleParser and SigmaClickhouseCompiler — numbers come from the
 * constants those files run on, and the examples, modifier list and field
 * table are exported so tests can put them through the real parser and
 * compiler.
 */

// How far behind "now" each run's window ends, for events still on their way.
const DETECTION_EVALUATION_DELAY_IN_MINUTES: number =
  DETECTION_EVALUATION_DELAY_IN_SECONDS / 60;

// The product name DetectionRuleEvaluator stamps on its findings.
const DETECTIONS_PRODUCT_NAME: string = "OneUptime Detections";

const LOOKBACK_IN_HOURS: number = DETECTION_MAX_LOOKBACK_IN_MINUTES / 60;

const SIGMA_LEVELS_IN_ORDER: Array<SigmaLevel> = [
  SigmaLevel.Informational,
  SigmaLevel.Low,
  SigmaLevel.Medium,
  SigmaLevel.High,
  SigmaLevel.Critical,
];

const SEVERE_LEVELS: Array<SigmaLevel> =
  SIGMA_LEVELS_IN_ORDER.filter(isSevereSigmaLevel);

const OTHER_LEVELS: Array<SigmaLevel> = SIGMA_LEVELS_IN_ORDER.filter(
  (level: SigmaLevel): boolean => {
    return !isSevereSigmaLevel(level);
  },
);

function codeList(values: Array<string>): string {
  const quoted: Array<string> = values.map((value: string): string => {
    return `\`${value}\``;
  });

  if (quoted.length <= 1) {
    return quoted.join("");
  }

  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/*
 * The rule the guide walks through. Exported so a test can parse and
 * compile it — an example that the save-time validator would reject is
 * worse than no example.
 */
export const DETECTION_RULE_EXAMPLE_YAML: string = `title: Failed logon burst
description: Repeated authentication failures from one source.
level: high
tags:
  - attack.t1110
  - attack.ta0006
detection:
  selection:
    className: Authentication
    statusName: Failure
  filter_internal:
    principalIp|startswith: '10.'
  condition: selection and not filter_internal`;

// The selection shapes the guide explains, as one compilable block.
export const SIGMA_SELECTIONS_EXAMPLE_YAML: string = `detection:
  # Field map: every field must match (AND).
  # A list of values matches any one of them (OR).
  selection_logon:
    className: Authentication
    statusName:
      - Failure
      - Blocked
  # A list of maps matches when any one map matches (OR).
  selection_admin:
    - principalUser|startswith: 'adm'
    - principalUser: root
  # Keywords: plain strings matched anywhere in the event message.
  keywords:
    - 'password spray'
    - 'credential stuffing'
  condition: selection_logon and (selection_admin or keywords)`;

/*
 * The correlation the guide walks through: the Sigma correlation
 * specification's own example, in OneUptime's fields. Exported so a test
 * parses it the way a save does.
 */
export const CORRELATION_RULE_EXAMPLE_YAML: string = `title: Failed sign-ins, then a success
level: high
correlation:
  type: temporal_ordered
  rules:
    - failed_sign_ins
    - successful_sign_in
  group-by:
    - principalIp
  timespan: 10m
---
title: Five failed sign-ins
name: failed_sign_ins
correlation:
  type: event_count
  rules:
    - failed_sign_in
  group-by:
    - principalIp
  timespan: 10m
  condition:
    gte: 5
---
title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

// A first-seen rule: a sign-in from an address the account never used.
export const NEW_VALUE_RULE_EXAMPLE_YAML: string = `title: Sign-in from a new address
correlation:
  type: new_value
  rules:
    - successful_sign_in
  group-by:
    - principalUser
  timespan: 14d
  condition:
    field: principalIp
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

export interface SigmaModifierDoc {
  modifier: string;
  meaning: string;
  // A `field|modifier: value` line exactly as it would sit in a selection.
  example: string;
}

/*
 * One entry per modifier SigmaRuleParser accepts, pinned by a test in
 * both directions: nothing listed here may be refused at save, and
 * nothing the parser takes may be missing from the guide.
 */
export const SIGMA_MODIFIER_DOCS: Array<SigmaModifierDoc> = [
  {
    modifier: "contains",
    meaning: "The value appears anywhere in the field.",
    example: "CommandLine|contains: '-EncodedCommand'",
  },
  {
    modifier: "startswith",
    meaning: "The field starts with the value.",
    example: "principalIp|startswith: '10.'",
  },
  {
    modifier: "endswith",
    meaning: "The field ends with the value.",
    example: "targetResource|endswith: '.ps1'",
  },
  {
    modifier: "all",
    meaning:
      "Every listed value must match, instead of any one of them. Combine with contains, startswith or endswith.",
    example: "CommandLine|contains|all: ['-nop', '-w hidden']",
  },
  {
    modifier: "re",
    meaning: "The field matches a regular expression (RE2 syntax).",
    example: "principalUser|re: '^adm[0-9]+$'",
  },
  {
    modifier: "cased",
    meaning:
      "Match case-sensitively. Without it, text comparisons ignore case.",
    example: "message|contains|cased: 'Mimikatz'",
  },
  {
    modifier: "gt",
    meaning: "Numerically greater than the value.",
    example: "severityId|gt: 3",
  },
  {
    modifier: "gte",
    meaning: "Numerically greater than or equal to the value.",
    example: "threat.confidence|gte: 80",
  },
  {
    modifier: "lt",
    meaning: "Numerically less than the value.",
    example: "targetPort|lt: 1024",
  },
  {
    modifier: "lte",
    meaning: "Numerically less than or equal to the value.",
    example: "targetPort|lte: 1023",
  },
  {
    modifier: "cidr",
    meaning: "The IP address falls inside the CIDR range (IPv4 or IPv6).",
    example: "principalIp|cidr: '192.168.0.0/16'",
  },
  {
    modifier: "exists",
    meaning: "true: the field is set. false: it is not.",
    example: "threat.matched|exists: true",
  },
  {
    modifier: "windash",
    meaning:
      "Also match each value with its dashes swapped for slashes, so -flag and /flag both match.",
    example: "CommandLine|windash|contains: ' -exec '",
  },
];

export interface SigmaFieldDoc {
  column: string;
  aliases: Array<string>;
}

/*
 * Sigma spellings that land on a typed column. Pinned against
 * SigmaClickhouseCompiler's alias table, both ways.
 */
export const SIGMA_FIELD_ALIAS_DOCS: Array<SigmaFieldDoc> = [
  {
    column: "principalUser",
    aliases: ["User", "username", "user.name"],
  },
  { column: "targetUser", aliases: ["TargetUser", "target_user"] },
  {
    column: "principalHost",
    aliases: ["host", "Hostname", "Computer", "ComputerName", "host.name"],
  },
  { column: "targetHost", aliases: ["TargetHost", "target_host"] },
  {
    column: "principalIp",
    aliases: ["src_ip", "source_ip", "SourceIp", "SourceAddress", "source.ip"],
  },
  {
    column: "targetIp",
    aliases: [
      "dst_ip",
      "destination_ip",
      "DestinationIp",
      "DestinationAddress",
      "destination.ip",
      "target_ip",
    ],
  },
  {
    column: "targetPort",
    aliases: ["dst_port", "destination_port", "DestinationPort", "target_port"],
  },
  {
    column: "processCommandLine",
    aliases: [
      "CommandLine",
      "command_line",
      "cmdline",
      "ProcessCommandLine",
      "process.command_line",
    ],
  },
  { column: "processPath", aliases: ["Image", "process.executable"] },
  {
    column: "parentProcessCommandLine",
    aliases: ["ParentCommandLine", "process.parent.command_line"],
  },
  {
    column: "parentProcessPath",
    aliases: ["ParentImage", "process.parent.executable"],
  },
  { column: "message", aliases: ["msg"] },
  { column: "traceId", aliases: ["trace_id"] },
  { column: "spanId", aliases: ["span_id"] },
  { column: "sessionId", aliases: ["session_id"] },
  { column: "requestOutcome", aliases: ["request_outcome"] },
];

/*
 * Typed event columns a rule (or a Group By / Distinct Count field) can
 * name directly, grouped by what they describe.
 */
export const SIGMA_COLUMN_DOCS: Array<{
  group: string;
  columns: Array<string>;
}> = [
  {
    group: "Classification",
    columns: [
      "categoryName",
      "categoryUid",
      "className",
      "classUid",
      "activityName",
      "statusName",
    ],
  },
  { group: "Severity", columns: ["severityName", "severityId"] },
  {
    group: "Who did it",
    columns: [
      "principalUser",
      "principalHost",
      "principalIp",
      "principalProcess",
    ],
  },
  {
    group: "What it touched",
    columns: [
      "targetUser",
      "targetHost",
      "targetIp",
      "targetPort",
      "targetResource",
    ],
  },
  {
    group: "The process, and its parent",
    columns: [
      "processName",
      "processPath",
      "processCommandLine",
      "parentProcessName",
      "parentProcessPath",
      "parentProcessCommandLine",
    ],
  },
  {
    group: "Source",
    columns: ["productName", "vendorName", "ruleId", "ruleName", "eventUid"],
  },
  {
    group: "The request it was part of",
    columns: ["traceId", "spanId", "sessionId", "requestOutcome"],
  },
  {
    group: "Content",
    columns: ["message", "observables", "mitreTactics", "mitreTechniques"],
  },
];

export interface DetectionThresholdExample {
  goal: string;
  groupByField: string;
  distinctCountField: string;
  threshold: number;
}

export const DETECTION_THRESHOLD_EXAMPLES: Array<DetectionThresholdExample> = [
  {
    goal: "Alert on any match",
    groupByField: "",
    distinctCountField: "",
    threshold: 1,
  },
  {
    goal: "One alert per host",
    groupByField: "principalHost",
    distinctCountField: "",
    threshold: 1,
  },
  {
    goal: "Brute force: 5+ failed logons from one IP",
    groupByField: "principalIp",
    distinctCountField: "",
    threshold: 5,
  },
  {
    goal: "Password spraying: one IP failing against 5+ different accounts",
    groupByField: "principalIp",
    distinctCountField: "principalUser",
    threshold: 5,
  },
  {
    goal: "Port scan: one IP reaching 20+ different ports",
    groupByField: "principalIp",
    distinctCountField: "targetPort",
    threshold: 20,
  },
];

function emptyOr(value: string): string {
  return value ? `\`${value}\`` : "*(empty)*";
}

const overviewMarkdown: string = `
A detection rule is a [Sigma](https://sigmahq.io/) rule — an open, vendor-neutral YAML format for describing suspicious activity — that OneUptime runs against your security events on a schedule. It is how "tell me when this happens" becomes an alert.

#### From event to alert

1. **Events arrive.** Events sent to the ingest API or pulled by a connection are normalized onto the same columns (\`className\`, \`principalUser\`, \`principalIp\`, ...) whatever format they arrived in. The rest of each payload is kept as flattened attributes.
2. **The rule runs on its schedule.** Every *Evaluation Interval* minutes, the rule's \`detection\` block is turned into a query over the events since its previous run.
3. **Matches are counted.** Matching events are counted — separately for each value of the *Group By Field*, if you set one — and a group fires only when its count reaches the *Match Count Threshold*.
4. **Actions fire.** Each firing group opens an alert (one per group, deduplicated while it stays open), optionally an incident, and writes a **${DETECTION_FINDING_CLASS_NAME}** event back into the event stream.

#### A first rule

\`\`\`yaml
${DETECTION_RULE_EXAMPLE_YAML}
\`\`\`

This rule matches failed authentication events from any IP outside \`10.x.x.x\`. Saved with **Group By Field** \`principalIp\` and **Match Count Threshold** \`5\`, it opens one alert for each outside IP that fails five logons within one evaluation window. Its \`level\` is \`high\`, so the alert uses your project's alert severity named *High* if you have one — see **Severity Levels**.

#### Reading the table

| Column | What it tells you |
| --- | --- |
| **Type** | **Single event**, or a correlation's kind: **Event count**, **Distinct values**, **Events together**, **Sequence** or **First seen** (see **Correlation Rules**). |
| **Status** | Whether the rule works: **Enabled** when its last run came back clean, **Run failed** when it failed, **Needs attention** when a run left a note, **Waiting for first run** while a new rule waits for its first run, and **Disabled**. |
| **Last Match** | The last run in which at least one group fired. |
| **Last Evaluated** | When the rule last ran. *Never* means it has not run yet; an enabled rule runs within a minute. |

When a run fails or leaves a note, **View Error** in the rule's row shows its **Last Error** in full, e.g. a query that timed out. It clears on the next successful run. **Interval (Minutes)** and **Last Error** start hidden: turn them on under the table's **Columns**.

Disabled rules are not evaluated. Use the **Create Monitor** row action to watch a rule's findings over time — see **Alerts & Findings**.
`;

const writingRulesMarkdown: string = `
OneUptime runs the boolean core of the Sigma specification. A rule is parsed and compiled when you save it, so a mistake is reported in the form rather than hours later as a failed run.

#### Rule structure

| Key | Used for |
| --- | --- |
| \`detection\` | **Required.** Named selections plus a \`condition\` that combines them. |
| \`level\` | The rule's severity: ${codeList(SIGMA_LEVELS_IN_ORDER)}. Missing or unrecognized levels read as \`${SIGMA_DEFAULT_LEVEL}\`. See **Severity Levels**. |
| \`tags\` | ATT&CK tags become the finding's MITRE fields: \`attack.t1110\` (or \`attack.t1110.001\`) is a technique, and \`attack.ta0006\` or its name, \`attack.credential_access\`, is a tactic. They also place the rule on **ATT&CK Coverage**. |
| \`description\` | Used on alerts when the rule's own Description field is empty. |
| \`title\` | For your reference. Alerts and findings show the rule's Name field. |
| \`id\` | Stored on findings as \`${DETECTION_SIGMA_ID_ATTRIBUTE}\`. |
| \`logsource\` | Informational only — it does **not** narrow which events are searched. Put that filter in a selection instead, e.g. \`className: Authentication\`. |

#### Selections

A selection is either a **field map** or a **keyword list**:

\`\`\`yaml
${SIGMA_SELECTIONS_EXAMPLE_YAML}
\`\`\`

Text is compared **case-insensitively** unless you add \`|cased\`. Regular expressions (\`|re\`) are the exception: they are case-sensitive unless they start with \`(?i)\`. A plain value must equal the whole field; \`*\` matches any run of characters and \`?\` a single character, e.g. \`targetResource: '/tmp/*.sh'\`. A \`null\` value matches when the field is empty or missing.

#### Conditions

Combine selections with \`and\`, \`or\`, \`not\` and parentheses, or with quantifiers: \`1 of selection_*\`, \`all of selection_*\`, \`any of them\`, \`all of them\`. A \`timeframe\` under \`detection\` is ignored — the rule's Evaluation Interval sets the window.

Aggregations in the condition, such as \`| count() by principalIp > 5\` (Sigma's old syntax), are rejected at save. Count with the rule's **Group By Field** and **Match Count Threshold** — see **Evaluation** — or write a Sigma correlation — see **Correlation Rules**.

#### Field modifiers

${markdownTable(
  ["Modifier", "What it does", "Example"],
  SIGMA_MODIFIER_DOCS.map((doc: SigmaModifierDoc): Array<string> => {
    return [`\`${doc.modifier}\``, doc.meaning, `\`${doc.example}\``];
  }),
)}

Any other modifier is rejected at save.

#### Field names

A field can be a typed event column, a common Sigma spelling of one, or any key from the event's attributes.

**Typed columns** — names are case-insensitive:

${markdownTable(
  ["Group", "Columns"],
  SIGMA_COLUMN_DOCS.map(
    (entry: { group: string; columns: Array<string> }): Array<string> => {
      return [entry.group, codeList(entry.columns)];
    },
  ),
)}

\`observables\`, \`mitreTactics\` and \`mitreTechniques\` are lists: a plain value matches when the list contains exactly that value, and \`|contains\` when any item contains it (ignoring case).

The process columns are the process the event is about: in a process creation event, the process that started (\`processPath\` is its executable, Sigma's \`Image\`) and the process that started it (\`parentProcess*\`, Sigma's \`ParentImage\` and \`ParentCommandLine\`). In any other event they are the process that acted - the one that made the connection or wrote the file. \`principalProcess\` is the acting process as the source names it: in a process creation event, the parent.

**Common spellings** — also case-insensitive, so \`CommandLine\` and \`commandline\` are the same field:

${markdownTable(
  ["Write", "Matches column"],
  SIGMA_FIELD_ALIAS_DOCS.map((doc: SigmaFieldDoc): Array<string> => {
    return [codeList(doc.aliases), `\`${doc.column}\``];
  }),
)}

**Attributes** — any other name is looked up in the event's flattened attributes, spelled exactly as it appears there (case-sensitive), for example \`metadata.product.name\` or \`threat.matched\`. Do not add an \`attributes.\` prefix. Open an event in **Events** to see its attribute keys.
`;

const evaluationMarkdown: string = `
#### When a rule runs

OneUptime checks every minute for enabled rules that are due. A rule is due once its **Evaluation Interval** has passed since its last run — any whole number of minutes from ${DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES} to ${DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES}. A newly created or enabled rule runs within a minute.

#### Which events each run sees

Each run searches the events whose **event time** falls between where the previous run stopped and **${DETECTION_EVALUATION_DELAY_IN_MINUTES} minutes ago**, then moves its starting point forward. The ${DETECTION_EVALUATION_DELAY_IN_MINUTES} minutes leave time for events still on their way - a log line read a minute after it was written, a batch a source sends late - so they are counted in the run that covers their time instead of being missed:

- **Windows are back to back, not rolling.** With a 10-minute interval, events at 09:58 and 10:01 can land in different runs and are counted separately. Leave some headroom when you choose a threshold.
- **The first run** looks back one interval.
- **After a gap** — a worker outage, or a rule re-enabled after being disabled — the next run covers the whole gap, up to the last ${LOOKBACK_IN_HOURS} hours. For that one run, a "5 in 10 minutes" rule behaves like "5 since the last run".
- **Late events are not re-checked.** The window uses the time each event says it happened, not when it arrived. An event that reaches OneUptime more than ${DETECTION_EVALUATION_DELAY_IN_MINUTES} minutes after that time, once a run has covered it, is stored and searchable, but that rule will not evaluate it.

#### Group By Field

Without a Group By Field, all of a run's matches form **one group**: the rule opens at most one alert at a time. With one, matches are split by that field's value, and each value is counted, alerted and deduplicated on its own — one alert per attacking IP, per host, or per user.

#### Distinct Count Field

By default a group's count is the number of matching events. With a Distinct Count Field, it is the number of **different values** of that field instead. Empty values — and \`0\` in number columns such as \`targetPort\` — are not counted.

#### Match Count Threshold

A group fires only when its count reaches the threshold within one run's window. \`${DETECTION_MATCH_COUNT_THRESHOLD_MIN}\` (the default) fires on any match; the maximum is ${DETECTION_MATCH_COUNT_THRESHOLD_MAX.toLocaleString("en-US")}.

#### Worked examples

${markdownTable(
  ["Goal", "Group By Field", "Distinct Count Field", "Threshold"],
  DETECTION_THRESHOLD_EXAMPLES.map(
    (example: DetectionThresholdExample): Array<string> => {
      return [
        example.goal,
        emptyOr(example.groupByField),
        emptyOr(example.distinctCountField),
        String(example.threshold),
      ];
    },
  ),
)}

Group By and Distinct Count accept the same field names as the rule itself — typed columns, common spellings, or attribute keys.

#### Limits

At most ${DETECTION_MAX_GROUPS_PER_EVALUATION} groups fire per run — the ones with the highest counts. Groups beyond that are not alerted for that window, so if a rule regularly hits the limit, tighten its selections or group by a coarser field.
`;

const correlationsMarkdown: string = `
A correlation rule finds a pattern across several events rather than in one: a burst, a sequence, things that happen together, or a value seen for the first time. It is a [Sigma correlation](https://github.com/SigmaHQ/sigma-specification), written in the same YAML as the rules it reads, separated by \`---\`:

\`\`\`yaml
${CORRELATION_RULE_EXAMPLE_YAML}
\`\`\`

This rule fires when five failed sign-ins from one address are followed by a sign-in from it that worked, within ten minutes. The rule is named after the correlation's \`title\`, and its \`level\` and \`tags\` are the rule's.

#### Types

| Type | Fires when | Shown as |
| --- | --- | --- |
| \`event_count\` | One group reaches a number of events within the timespan | Event count |
| \`value_count\` | One group shows a number of different values of \`condition.field\` within the timespan | Distinct values |
| \`temporal\` | Every rule it reads matches for the same group within the timespan, in any order (or at least \`gte\` of them) | Events together |
| \`temporal_ordered\` | The rules match in the order listed, for the same group, within the timespan | Sequence |
| \`new_value\` | A group shows a value of \`condition.field\` it has not shown in the timespan before the run: OneUptime's own type | First seen |

\`value_sum\`, \`value_avg\` and \`value_percentile\` are refused when you save.

#### Writing one

- **\`rules\`** names the rules it reads, by their \`name\` or \`id\`: rules in the same YAML, or your other detection rules. A rule it reads can be turned off: it is then only a step, and fires nothing by itself.
- **\`group-by\`** takes up to ${SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS} fields, the same names a rule takes. Events whose field is empty are left out: a sequence "by the same user" of events naming no user is not one. **\`aliases\`** name the field each rule keeps a value in, so the source address of one rule can be grouped with the destination of another.
- **\`timespan\`** is a whole number and a unit: \`30s\`, \`10m\`, \`2h\`, \`1d\`. At most \`24h\`; for \`new_value\`, how far back "seen before" reaches, \`1d\` to \`30d\`.
- **\`condition\`**: a count to reach for \`event_count\` and \`value_count\` (\`gte: 10\`, or a range such as \`gt: 100\` and \`lte: 200\`), and the field counted or that must be new for \`value_count\` and \`new_value\`.
- A \`temporal\` or \`temporal_ordered\` correlation reads ${SIGMA_CORRELATION_MIN_TEMPORAL_RULES} to ${SIGMA_CORRELATION_MAX_TEMPORAL_RULES} rules, and a step can be an \`event_count\` correlation of the same file, as in the example above.

A first-seen rule, OneUptime's \`new_value\`:

\`\`\`yaml
${NEW_VALUE_RULE_EXAMPLE_YAML}
\`\`\`

#### When it fires

- **Counts are rolling.** Every timespan that ends in a run is counted, in steps of a sixtieth of the timespan, so a burst is counted whole whichever runs it straddles. A group fires only when it has events in the run.
- **Sequences fire once.** A chain whose last step happens in a run fires, even when its first step came in an earlier one; a chain an earlier run reported does not fire again.
- **First seen is first for someone known.** A run's events are compared with the timespan before the run, for groups seen before it: a user's first sign-in ever is not "a new address for them".
- Each finding carries \`${DETECTION_CORRELATION_TYPE_ATTRIBUTE}\` and \`${DETECTION_SUMMARY_ATTRIBUTE}\`, what happened in a sentence. The **Rule Library** has ready-made correlations: look for **Sequence** and **First seen**.
`;

const severityLevelsMarkdown: string = `
A rule's Sigma \`level\` is its severity. It decides two things.

#### 1. The severity of its findings

${markdownTable(
  ["Sigma level", "Detection Finding severity"],
  SIGMA_LEVELS_IN_ORDER.map((level: SigmaLevel): Array<string> => {
    return [`\`${level}\``, SIGMA_LEVEL_TO_OCSF_SEVERITY[level]];
  }),
)}

A rule without a \`level\`, or with one not listed here, is treated as \`${SIGMA_DEFAULT_LEVEL}\`. Findings are shown with these severities in **Events** and can be filtered on them.

#### 2. The severity of the alerts and incidents it opens

Alert severities are defined per project, so OneUptime picks one of *yours*, in this order:

1. **The severity set on the rule.** *Alert Severity* on the rule's On Match step always wins.
2. **A severity named after the level.** A \`high\` rule uses your alert severity named *High* (case-insensitive), if there is one.
3. **By rank.** Otherwise ${codeList(SEVERE_LEVELS)} rules use your **most severe** alert severity, and ${codeList(OTHER_LEVELS)} rules your **least severe**.

Incidents follow the same order with *Incident Severity* and your incident severities.

**Tip:** name your alert severities after the Sigma levels — *Critical*, *High*, *Medium*, *Low*, *Informational* — and every rule lands on the right severity without per-rule settings.
`;

const alertsAndFindingsMarkdown: string = `
#### Alerts

With **Create an alert** (the default) or **Both** under **Alerts and Incidents**, each firing group opens an alert titled \`[Detection] <rule name> — <group value>\`, or \`[Detection] <rule name>\` when the rule has no Group By Field. The alert describes the match count, the time window, a sample event message and the observables involved.

- **One open alert per group.** While an alert for a rule and group value is unresolved, further matches for that group do not open another one. Once you resolve it, the next match opens a fresh alert.
- **Alerts are not resolved automatically.** A rule only sees matches — it cannot tell that an attack has stopped — so its alerts stay open until someone resolves them. For a status that recovers on its own, use a monitor (below).

#### Incidents

**Declare an incident** and **Both** under **Alerts and Incidents** open incidents: they drive on-call escalation, SLAs and status pages, and alerts are usually enough for detections. Incidents are deduplicated per group exactly like alerts.

#### Detection Findings

With **Write Detection Finding on Match** on (the default, under **More fields**), every firing group also writes a security event back into the event stream: class \`${DETECTION_FINDING_CLASS_NAME}\` (OCSF ${DETECTION_FINDING_CLASS_UID}), product \`${DETECTIONS_PRODUCT_NAME}\`, the severity from the rule's level, the rule's MITRE ATT&CK tags, and the group value first in \`observables\`. Each finding carries these attributes:

${markdownTable(
  ["Attribute", "Value"],
  [
    [`\`${DETECTION_RULE_ID_ATTRIBUTE}\``, "Id of the rule that fired."],
    [`\`${DETECTION_RULE_NAME_ATTRIBUTE}\``, "The rule's name."],
    [
      `\`${DETECTION_MATCH_COUNT_ATTRIBUTE}\``,
      "How many events are behind this finding.",
    ],
    [
      `\`${DETECTION_DISTINCT_COUNT_ATTRIBUTE}\``,
      "How many distinct values are behind it (rules with a Distinct Count Field only).",
    ],
    [
      `\`${DETECTION_GROUP_VALUE_ATTRIBUTE}\``,
      "The Group By value (rules with a Group By Field only).",
    ],
    [
      `\`${DETECTION_SIGMA_ID_ATTRIBUTE}\``,
      "The Sigma rule's own `id` (when it has one).",
    ],
  ],
)}

Findings are ordinary security events: search them in **Events** and pivot on their observables in **Correlate**. To trial a new rule quietly before it pages anyone, pick **Neither** under **Alerts and Incidents** and turn **Open a Case on Match** off: it only writes findings.

#### Monitors on top of rules

The **Create Monitor** row action opens a Security Events monitor that counts this rule's findings, filtered by rule id so renaming the rule does not break it. Use it for what a rule cannot express on its own:

- **Rate changes** — a rule that fires weekly suddenly firing fifty times an hour.
- **Silence** — findings dropping to zero usually means a source stopped sending, not that the network got quiet.
- **Status that recovers** — a monitor's status returns to normal when the count drops back under its criteria.

A monitor counts **findings**, not the events behind them — one finding per group per run. To require a number of events before anything fires, use the rule's Match Count Threshold.
`;

const troubleshootingMarkdown: string = `
#### The rule will not save

The form shows the parser's reason. The usual causes:

- A modifier that is not in the list under **Writing Rules**.
- An aggregation in the condition (\`| count() ...\`) — use Group By Field and Match Count Threshold, or a correlation.
- A correlation that names a rule neither its YAML nor your detection rules hold, a type OneUptime does not run (${SIGMA_UNSUPPORTED_CORRELATION_TYPES.map(
  (type: string): string => {
    return `\`${type}\``;
  },
).join(", ")}), or a timespan out of bounds.
- A condition that names a selection that does not exist, or a \`1 of x*\` pattern that matches none.
- A nested map as a field value — values must be text, numbers, booleans, \`null\`, or lists of those.

#### The rule never matches

- **Last Evaluated** is *Never* or old: check the rule is **Enabled**.
- **Status** reads **Run failed**: the last run failed; **View Error** in its row says why.
- Find an event you expected to match in **Events** and compare it with your rule, field by field. Plain values must equal the whole field — use \`|contains\` or \`*\` for partial matches.
- Fields that are not typed columns or common spellings are read from the event's attributes, spelled exactly as they appear there — \`threat.matched\`, not \`attributes.threat.matched\`.
- \`logsource\` does not filter anything; a rule that relies on it matches more than you expect, not less.
- With a threshold above 1, that many matches must land in **one** window. Try a longer interval or a lower threshold.
- Events that arrive with a timestamp from before the rule's last run are never evaluated by it.

#### It matched, but no alert opened

- **Alerts and Incidents** is set to **Declare an incident** or **Neither**.
- An alert for the same rule and group value is still open — matches for that group are deduplicated into it.
- The project has no alert severities. Rules need at least one to open alerts.

#### Too many alerts

- The Group By Field has too many values — every value gets its own alert. Group by a coarser field, or remove it for one alert per rule.
- The threshold is too low for the traffic. Raise it, or add a Distinct Count Field.
- Known-good activity matches. Exclude it with a filter selection: \`condition: selection and not filter_known_good\`.
- You care about the rate, not each match. Set **Alerts and Incidents** to **Neither** and put a monitor on the rule's findings instead.
`;

const detectionRuleLevels: Array<SecurityEventsGuideLevel> =
  SIGMA_LEVELS_IN_ORDER.map((level: SigmaLevel): SecurityEventsGuideLevel => {
    return {
      label: level,
      // As a rule's YAML writes it: `level: high`.
      isLabelAValue: true,
      severity: SIGMA_LEVEL_TO_OCSF_SEVERITY[level],
    };
  });

// The second step's sentence, as the card looks it up in the reader's language.
const RULE_RUNS: SecurityEventsGuideTemplate = {
  sentence:
    "Every {{min}}–{{max}} minutes (you choose), the rule's Sigma detection is checked against the events since its last run.",
  values: {
    min: DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
    max: DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  },
};

const DetectionRulesGuide: SecurityEventsGuide = {
  id: "detection-rules",
  title: "How detection rules work",
  summary:
    "Detection rules are Sigma rules that OneUptime runs on a schedule against your security events. When a rule matches, it can open an alert, open an incident, and record a Detection Finding.",
  steps: [
    {
      title: "Events arrive",
      icon: IconProp.InboxArrowDown,
      description:
        "Events from the ingest API and your connections are normalized onto the same columns — className, principalUser, principalIp and more.",
    },
    {
      title: "The rule runs on a schedule",
      icon: IconProp.Clock,
      description: fillGuideTemplate(RULE_RUNS),
      descriptionTemplate: RULE_RUNS,
    },
    {
      title: "Matches are counted",
      icon: IconProp.Funnel,
      description:
        "A single rule's matches are split by the Group By Field, and a group fires once it reaches the Match Count Threshold. A correlation fires when its events line up within its timespan.",
    },
    {
      title: "Alerts and findings",
      icon: IconProp.BellAlert,
      description:
        "Each firing group opens one alert (deduplicated while it is open), optionally an incident, and records a Detection Finding event.",
    },
  ],
  levels: {
    title: "Severity levels",
    linkText: "How severity levels are chosen",
    description:
      "A rule's Sigma level sets the severity of its findings, and picks the alert severity when the rule does not set one.",
    items: detectionRuleLevels,
    sectionId: "severity-levels",
  },
  // Keys in SecurityEventsGuideCopy, which the card looks up when it opens.
  guideTitle: "Detection Rules Guide",
  guideDescription:
    "How Sigma rules are evaluated, counted and turned into alerts — and how to write them.",
  sections: [
    { id: "overview", title: "Overview", markdown: overviewMarkdown },
    {
      id: "writing-rules",
      title: "Writing Rules",
      markdown: writingRulesMarkdown,
    },
    { id: "evaluation", title: "Evaluation", markdown: evaluationMarkdown },
    {
      id: "correlations",
      title: "Correlation Rules",
      markdown: correlationsMarkdown,
    },
    {
      id: "severity-levels",
      title: "Severity Levels",
      markdown: severityLevelsMarkdown,
    },
    {
      id: "alerts-and-findings",
      title: "Alerts & Findings",
      markdown: alertsAndFindingsMarkdown,
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      markdown: troubleshootingMarkdown,
    },
  ],
  documentationPath: "/telemetry/security-events",
};

export default DetectionRulesGuide;
